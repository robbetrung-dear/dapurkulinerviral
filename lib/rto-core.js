/**
 * lib/rto-core.js
 * Logika inti Realtime Order (RTO): landing page → POS kasir.
 *
 * Dipakai oleh Cloudflare Pages Functions:
 *   - functions/payment/create.js         POST /payment/create
 *   - functions/payment/webhook.js        POST /payment/webhook
 *   - functions/online-orders/[[path]].js GET|POST|PATCH /online-orders/*
 *
 * SENGAJA ditaruh di luar folder /functions supaya TIDAK ikut jadi route.
 *
 * Prinsip:
 * 1. Harga & total SELALU dihitung di server dari /menu_items (anti tamper harga).
 * 2. Reserve stok atomik: Firebase REST ETag + `if-match` (412 kalau ada perubahan
 *    bersamaan) → retry loop. Ini "transaction" yang tersedia di Edge.
 * 3. Idempotency: /rto_processed/{orderId}/{action} — satu aksi hanya sekali.
 * 4. Tidak mengubah schema inventory existing, hanya MENAMBAH field `reserved`.
 * 5. Semua efek samping (jurnal, /pos/transactions) non-fatal: gagal di satu
 *    langkah tidak membatalkan order yang sudah paid (backward compatible).
 */

export const DEFAULT_DB_URL = "https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app";
export const RTO_TTL_MINUTES = 5;
export const PAYMENT_PATH = "site_config/paymentConfig";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, x-callback-token",
};

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

export function methodNotAllowed(msg = "Method not allowed") {
  return json({ success: false, error: msg }, 405);
}

export const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function dbCtx(env = {}) {
  const dbUrl = String(env.FIREBASE_DATABASE_URL || DEFAULT_DB_URL).replace(/\/+$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
  return { dbUrl, authParam, apiKey };
}

async function readJson(res) {
  try {
    return await res.json();
  } catch (e) {
    return null;
  }
}

/* ==========================================================================
 * Firebase REST primitives
 * ========================================================================== */

export async function fbGet(ctx, path) {
  const res = await fetch(`${ctx.dbUrl}/${path}.json${ctx.authParam}`, { method: "GET" });
  if (!res.ok && res.status !== 404) throw new Error(`FB GET ${path} gagal (HTTP ${res.status})`);
  return await readJson(res);
}

export async function fbPut(ctx, path, data) {
  const res = await fetch(`${ctx.dbUrl}/${path}.json${ctx.authParam}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.ok;
}

export async function fbPatch(ctx, path, data) {
  const res = await fetch(`${ctx.dbUrl}/${path}.json${ctx.authParam}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.ok;
}

/**
 * Atomic read-modify-write ke satu node Firebase lewat ETag + if-match.
 * `mutate(current)` harus mengembalikan objek BARU (full node) atau
 * `undefined` untuk no-op (tidak menulis apa pun).
 * Kalau data berubah di tengah proses (HTTP 412), baca ulang lalu ulangi.
 */
export async function casWrite(ctx, path, mutate, { maxAttempts = 10 } = {}) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = `${ctx.dbUrl}/${path}.json${ctx.authParam}`;
    let current = null;
    let etag = null;
    try {
      const res = await fetch(url, { method: "GET", headers: { "X-Firebase-ETag": "true" } });
      etag = res.headers.get("etag") || res.headers.get("ETag");
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      current = await readJson(res);
    } catch (e) {
      lastErr = e;
      await sleep(60 * attempt);
      continue;
    }

    const next = mutate(current);
    if (next === undefined) return { ok: true, noop: true, data: current };

    const headers = { "Content-Type": "application/json" };
    if (etag) headers["if-match"] = etag;

    const putRes = await fetch(url, { method: "PUT", headers, body: JSON.stringify(next) });
    if (putRes.status === 412) {
      // Ada penulis lain — baca ulang lalu coba lagi.
      lastErr = new Error("412 precondition failed");
      await sleep(40 + attempt * 60);
      continue;
    }
    if (!putRes.ok) {
      lastErr = new Error(`FB PUT ${path} gagal (HTTP ${putRes.status})`);
      await sleep(60 * attempt);
      continue;
    }
    return { ok: true, data: next, attempts: attempt };
  }
  throw lastErr || new Error(`CAS ${path} gagal`);
}

/* ==========================================================================
 * Helper umum
 * ========================================================================== */

export function formatOrderId(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `ORD-${y}${m}${d}-${rand}`;
}

export function normalizePhone(raw) {
  let s = String(raw || "").replace(/[^0-9+]/g, "");
  s = s.replace(/^\+/, "");
  if (s.startsWith("62")) s = "0" + s.slice(2);
  if (s.startsWith("8")) s = "0" + s;
  return s;
}

export function isValidPhone(raw) {
  const s = normalizePhone(raw);
  return /^0[0-9]{8,14}$/.test(s);
}

export function dateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Konversi satuan (kg↔gram, liter↔ml) — sama dengan functions/inventory/deduct.js */
export function convertUsage(amt, ingUnit, invUnit) {
  const uIng = String(ingUnit || "").toLowerCase().trim();
  const uInv = String(invUnit || "").toLowerCase().trim();
  if (uInv === "kg" && uIng === "gram") return amt / 1000;
  if (uInv === "gram" && uIng === "kg") return amt * 1000;
  if (uInv === "liter" && (uIng === "ml" || uIng === "mili")) return amt / 1000;
  if ((uInv === "ml" || uInv === "mili") && uIng === "liter") return amt * 1000;
  return amt;
}

function round3(n) {
  return Math.round(toNum(n) * 1000) / 1000;
}

/* ==========================================================================
 * Validasi & harga otoritatif
 * ========================================================================== */

/**
 * Ambil menu dari /menu_items (bentuknya ARRAY di database).
 * Return Map(id → menu).
 */
export async function loadMenuMap(ctx) {
  const raw = await fbGet(ctx, "menu_items");
  const map = new Map();
  if (!raw) return map;
  const list = Array.isArray(raw) ? raw : Object.values(raw);
  for (const it of list) {
    if (it && typeof it === "object" && it.id) map.set(String(it.id), it);
  }
  return map;
}

/**
 * Validasi payload checkout + hitung total dari harga server.
 * Return { ok, error?, order: {customer, items[], subtotal, total} }
 */
export function buildOrderDraft(payload, menuMap) {
  const customer = payload.customer || {};
  const name = String(customer.name || "").trim();
  const phoneRaw = customer.phone || customer.wa || customer.whatsapp || "";

  if (name.length < 2) return { ok: false, error: "Nama pemesan minimal 2 karakter" };
  if (!isValidPhone(phoneRaw)) {
    return { ok: false, error: "Nomor WhatsApp tidak valid (contoh: 081234567890)" };
  }

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  if (rawItems.length === 0) return { ok: false, error: "Keranjang kosong" };

  const items = [];
  let subtotal = 0;

  for (const raw of rawItems) {
    const id = String(raw.id || raw.menuId || "").trim();
    const qty = Math.floor(toNum(raw.qty || raw.quantity));
    if (!id) return { ok: false, error: "Ada item tanpa ID menu" };
    if (qty <= 0) return { ok: false, error: `Qty tidak valid untuk menu ${id}` };
    if (qty > 200) return { ok: false, error: `Qty terlalu besar untuk menu ${id}` };

    const menu = menuMap.get(id);
    if (!menu) return { ok: false, error: `Menu ${id} tidak ditemukan di katalog` };
    if (menu.active === false) return { ok: false, error: `Menu ${menu.name || id} sedang tidak aktif` };

    const price = Math.round(toNum(menu.price));
    if (price <= 0) return { ok: false, error: `Harga menu ${menu.name || id} belum diisi` };

    const sub = price * qty;
    subtotal += sub;
    items.push({
      id,
      name: String(menu.name || raw.name || id),
      qty,
      price,
      subtotal: sub,
    });
  }

  return {
    ok: true,
    order: {
      customer: { name, phone: normalizePhone(phoneRaw) },
      items,
      subtotal,
      total: subtotal, // pickup only: tanpa ongkir / service charge
    },
  };
}

/* ==========================================================================
 * Reserved stock (recipe-based, konsisten dengan stok yang dilihat customer)
 * ========================================================================== */

/**
 * Hitung kebutuhan bahan per item inventory untuk 1 order.
 * Sumber: /recipes/{menuId}.ingredients[{itemId, amount, unit}] × qty.
 * Fallback (kalau menu belum punya resep): menu.inventoryId / linkedInventory
 * → 1 unit inventory per porsi (sama dengan logika tampilan stok di landing page).
 * Return [{ itemId, qty, unit }]
 */
export async function resolveReservation(ctx, items, menuMap) {
  const recipes = (await fbGet(ctx, "recipes")) || {};
  const inventory = (await fbGet(ctx, "inventory")) || {};
  const usage = new Map();

  const add = (itemId, amount) => {
    if (!itemId || !(amount > 0)) return;
    usage.set(itemId, round3((usage.get(itemId) || 0) + amount));
  };

  for (const item of items) {
    const recipe = recipes[item.id];
    const ingArr = recipe && recipe.ingredients
      ? (Array.isArray(recipe.ingredients) ? recipe.ingredients : Object.values(recipe.ingredients))
      : [];

    if (ingArr.length > 0) {
      for (const ing of ingArr) {
        const invId = ing.itemId || ing.invId || ing.id;
        const amount = toNum(ing.amount || ing.qtyPerPortion);
        if (!invId || amount <= 0) continue;
        const inv = inventory[invId];
        const converted = inv ? convertUsage(amount, ing.unit, inv.unit) : amount;
        add(invId, converted * item.qty);
      }
      continue;
    }

    const menu = menuMap.get(item.id) || {};
    const invId = menu.inventoryId || menu.linkedInventory || menu.bahanId;
    if (invId && String(invId).trim() !== "") {
      add(String(invId), item.qty);
    }
  }

  return Array.from(usage.entries()).map(([itemId, qty]) => ({
    itemId,
    qty,
    unit: (inventory[itemId] && inventory[itemId].unit) || "",
  }));
}

async function writeInventoryLog(ctx, itemId, payload) {
  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await fbPut(ctx, `inventory_logs/${encodeURIComponent(itemId)}/${logId}`, payload);
  } catch (e) {
    // log tidak boleh menggagalkan transaksi
  }
}

/**
 * Reserve stok untuk sebuah order (dipanggil dari /payment/create).
 * stok -= qty ; reserved += qty  — atomik per item lewat casWrite.
 * Gagal (stok kurang / race) → rollback item yang sudah ke-reserve.
 */
export async function reserveStock(ctx, order, reservations) {
  const reserved = [];
  const failures = [];

  for (const res of reservations) {
    try {
      const result = await casWrite(ctx, `inventory/${encodeURIComponent(res.itemId)}`, (cur) => {
        if (!cur) return null; // item hilang → biarkan, ditandai gagal di bawah
        const stock = toNum(cur.stock !== undefined ? cur.stock : cur.stok);
        const held = toNum(cur.reserved);
        if (stock - res.qty < 0) {
          return undefined; // no-op: stok kurang, ditandai gagal
        }
        return {
          ...cur,
          stock: round3(stock - res.qty),
          stok: round3(stock - res.qty),
          reserved: round3(held + res.qty),
          lastUpdate: Date.now(),
          lastReservedAt: Date.now(),
          lastReservedBy: order.orderId,
        };
      });

      if (result.noop || !result.data) {
        failures.push({ itemId: res.itemId, reason: "stok_tidak_cukup", unit: res.unit });
        continue;
      }

      reserved.push({ itemId: res.itemId, qty: res.qty, unit: res.unit });
      await writeInventoryLog(ctx, res.itemId, {
        t: Date.now(),
        old: toNum(result.data.stock) + res.qty,
        new: toNum(result.data.stock),
        diff: -res.qty,
        by: `landing-page (${order.orderId})`,
        reason: `Reserve stok order online ${order.orderId}`,
        changeType: "rto-reserve",
      });
    } catch (e) {
      failures.push({ itemId: res.itemId, reason: `error: ${e.message}`, unit: res.unit });
    }
  }

  if (failures.length > 0) {
    await rollbackReserved(ctx, order, reserved);
    return { ok: false, reserved: [], failures };
  }
  return { ok: true, reserved, failures: [] };
}

/**
 * Paid: reserved dilepas (stok SUDAH dipotong saat reserve) → permanent deduct.
 */
export async function releaseReserved(ctx, order, reservedItems) {
  const released = [];
  for (const res of reservedItems) {
    try {
      const result = await casWrite(ctx, `inventory/${encodeURIComponent(res.itemId)}`, (cur) => {
        if (!cur) return undefined;
        const held = toNum(cur.reserved);
        return {
          ...cur,
          reserved: round3(Math.max(0, held - res.qty)),
          lastUpdate: Date.now(),
        };
      });
      if (!result.noop) {
        released.push(res);
        await writeInventoryLog(ctx, res.itemId, {
          t: Date.now(),
          old: toNum(result.data.stock),
          new: toNum(result.data.stock),
          diff: 0,
          reservedReleased: res.qty,
          by: `rto-paid (${order.orderId})`,
          reason: `Reserved → permanent deduct order ${order.orderId}`,
          changeType: "rto-paid-release",
        });
      }
    } catch (e) {
      // lanjut item berikutnya
    }
  }
  return released;
}

/**
 * Expired / gagal bayar: stok dikembalikan, reserved dilepas.
 */
export async function rollbackReserved(ctx, order, reservedItems) {
  const rolled = [];
  for (const res of reservedItems) {
    try {
      const result = await casWrite(ctx, `inventory/${encodeURIComponent(res.itemId)}`, (cur) => {
        if (!cur) return undefined;
        const stock = toNum(cur.stock !== undefined ? cur.stock : cur.stok);
        const held = toNum(cur.reserved);
        return {
          ...cur,
          stock: round3(stock + res.qty),
          stok: round3(stock + res.qty),
          reserved: round3(Math.max(0, held - res.qty)),
          lastUpdate: Date.now(),
        };
      });
      if (!result.noop) {
        rolled.push(res);
        await writeInventoryLog(ctx, res.itemId, {
          t: Date.now(),
          old: toNum(result.data.stock) - res.qty,
          new: toNum(result.data.stock),
          diff: res.qty,
          by: `rto-rollback (${order.orderId || ""})`,
          reason: `Rollback stok order online ${order.orderId || ""}`,
          changeType: "rto-expire-rollback",
        });
      }
    } catch (e) {
      // lanjut item berikutnya
    }
  }
  return rolled;
}

/* ==========================================================================
 * Idempotency helper
 * ========================================================================== */

export async function alreadyProcessed(ctx, orderId, action) {
  const v = await fbGet(ctx, `rto_processed/${encodeURIComponent(orderId)}/${action}`);
  return !!v;
}

export async function markProcessed(ctx, orderId, action, extra = {}) {
  await fbPut(ctx, `rto_processed/${encodeURIComponent(orderId)}/${action}`, {
    at: Date.now(),
    ...extra,
  });
}

/* ==========================================================================
 * QRIS
 * ========================================================================== */

export async function loadPaymentConfig(ctx) {
  const cfg = (await fbGet(ctx, PAYMENT_PATH)) || {};
  return {
    qrisType: cfg.qrisType || "both",
    qrisImage: cfg.qrisImage || "",
    qrisMerchantName: cfg.qrisMerchantName || "",
    qrisNmid: cfg.qrisNmid || "",
    qrisInstructions: cfg.qrisInstructions || "",
    enableQris: cfg.enableQris !== false,
    enableMidtrans: cfg.enableMidtrans === true,
  };
}

/**
 * QRIS dinamis.
 * Urutan: iFortePay (kalau env diset) → Midtrans QRIS (kalau enableMidtrans +
 * MIDTRANS_SERVER_KEY) → null (pakai QRIS statis admin).
 *
 * CATATAN iFortePay: kontrak API pastinya WAJIB dikonfirmasi saat kredensial
 * turun. Karena itu endpoint + field dipasok lewat env (tidak di-hardcode):
 *   IFORTEPAY_CREATE_URL, IFORTEPAY_API_KEY, IFORTEPAY_MERCHANT_ID,
 *   IFORTEPAY_QR_FIELD (opsional, default auto-detect).
 */
export async function createDynamicQris(ctx, env, order) {
  const iforteUrl = env && env.IFORTEPAY_CREATE_URL;
  if (iforteUrl && env.IFORTEPAY_API_KEY) {
    try {
      const body = {
        merchant_id: env.IFORTEPAY_MERCHANT_ID || "",
        amount: order.total,
        order_id: order.orderId,
        ref_id: order.orderId,
        customer_name: order.customer.name,
        customer_phone: order.customer.phone,
        expiry_minutes: RTO_TTL_MINUTES,
        callback_url: env.IFORTEPAY_CALLBACK_URL || "",
      };
      const res = await fetch(iforteUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.IFORTEPAY_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      const data = await readJson(res);
      if (res.ok && data) {
        const pick = (obj, keys) => {
          for (const k of keys) {
            const segs = k.split(".");
            let v = obj;
            for (const s of segs) v = v == null ? v : v[s];
            if (typeof v === "string" && v.length > 0) return v;
          }
          return "";
        };
        const qrString = pick(data, ["qr_string", "qris_string", "data.qr_string", "data.qris_string", "qr_content"]);
        const qrUrl = pick(data, ["qr_url", "qr_code_url", "data.qr_url", "data.qr_code_url", "url"]);
        const trxId = pick(data, ["transaction_id", "trx_id", "data.transaction_id", "reference_id"]);
        if (qrString || qrUrl) {
          return {
            method: "qris_dynamic",
            gateway: "ifortepay",
            qr_string: qrString,
            qr_image:
              qrUrl ||
              `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrString)}`,
            transaction_id: trxId,
          };
        }
      }
    } catch (e) {
      // fallback ke statis
    }
  }

  // Midtrans QRIS (opsional, hanya kalau admin mengaktifkan enableMidtrans)
  if (env && env.MIDTRANS_SERVER_KEY && env.MIDTRANS_SERVER_KEY.indexOf("YOUR_MIDTRANS") === -1) {
    const cfg = await loadPaymentConfig(ctx);
    if (cfg.enableMidtrans) {
      try {
        const isProd = env.MIDTRANS_IS_PRODUCTION === "true";
        const url = isProd
          ? "https://api.midtrans.com/v2/charge"
          : "https://sandbox.midtrans.com/v2/charge";
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Basic ${btoa(env.MIDTRANS_SERVER_KEY + ":")}`,
          },
          body: JSON.stringify({
            payment_type: "qris",
            transaction_details: { order_id: order.orderId, gross_amount: Math.round(order.total) },
            customer_details: { first_name: order.customer.name, phone: order.customer.phone },
            qris: { acquirer: "gopay" },
            custom_expiry: { expiry_duration: RTO_TTL_MINUTES, unit: "minute" },
          }),
        });
        const data = await readJson(res);
        if (res.ok && data) {
          const action = Array.isArray(data.actions)
            ? data.actions.find((a) => a.name === "generate-qr-code")
            : null;
          const qrString = data.qr_string || "";
          const qrUrl = (action && action.url) || "";
          if (qrString || qrUrl) {
            return {
              method: "qris_dynamic",
              gateway: "midtrans",
              qr_string: qrString,
              qr_image:
                qrUrl ||
                `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrString)}`,
              transaction_id: data.transaction_id || "",
            };
          }
        }
      } catch (e) {
        // fallback ke statis
      }
    }
  }

  return null;
}

export function staticQrisPayment(cfg, order) {
  return {
    method: "qris_static",
    gateway: "admin",
    qr_string: "",
    qr_image: cfg.qrisImage,
    transaction_id: "",
    merchant_name: cfg.qrisMerchantName,
    nmid: cfg.qrisNmid,
    instructions: cfg.qrisInstructions,
  };
}

/* ==========================================================================
 * Insert ke /pos/transactions (WAJIB: satu jalur dengan kasir)
 * ========================================================================== */

export async function insertPosTransaction(ctx, order, payment, { kasir = "online", shiftId = "" } = {}) {
  const dateStr = dateKey(Date.now());
  const txId = order.orderId;
  const existing = await fbGet(ctx, `pos/transactions/${dateStr}/${encodeURIComponent(txId)}`);
  if (existing) return { ok: true, alreadyExists: true, date: dateStr, txId };

  const txRecord = {
    t: Date.now(),
    items: order.items.map((i) => [i.id, i.qty, i.price]),
    sub: order.subtotal,
    tax: 0,
    taxIncluded: false,
    serviceCharge: 0,
    disc: 0,
    tot: order.total,
    pm: "qris",
    ksr: kasir,
    shf: shiftId, // diisi saat kasir klik Done (bukan saat create)
    orderId: order.orderId,
    reconciled: false,
    source: "landing-page",
    online_order_id: order.orderId,
    payDetail: {
      orderId: order.orderId,
      method: payment.method,
      gateway: payment.gateway,
      transaction_id: payment.transaction_id || "",
      paid_at: payment.paid_at || new Date().toISOString(),
      paid_by: kasir,
    },
  };

  const ok = await fbPut(ctx, `pos/transactions/${dateStr}/${encodeURIComponent(txId)}`, txRecord);
  return { ok, date: dateStr, txId };
}

/* ==========================================================================
 * Auto-jurnal akuntansi (pakai handler resmi /accounting/journal/pos)
 * ========================================================================== */

export async function autoJournal(env, order, pm = "qris") {
  try {
    const mod = await import("../functions/accounting/[[path]].js");
    const req = new Request("https://rto.internal/accounting/journal/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.orderId,
        date: dateKey(Date.now()),
        pm,
        total: order.total,
        items: order.items.map((i) => ({ id: i.id, qty: i.qty, price: i.price })),
      }),
    });
    const res = await mod.onRequest({ request: req, env });
    const data = await readJson(res);
    return { ok: !!(data && data.success), data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ==========================================================================
 * Finalisasi pembayaran (paid) — dipakai webhook & verifikasi kasir
 * ========================================================================== */

export async function finalizePaid(ctx, env, order, {
  transactionId = "",
  gateway = "",
  kasir = "gateway",
  method = "",
} = {}) {
  const result = { orderId: order.orderId, steps: {} };

  if (await alreadyProcessed(ctx, order.orderId, "paid")) {
    return { ...result, alreadyProcessed: true };
  }

  const paidAt = new Date().toISOString();

  // 1. Order → paid
  const casRes = await casWrite(ctx, `online_orders/${encodeURIComponent(order.orderId)}`, (cur) => {
    if (!cur) return undefined;
    if (cur.status === "paid" || cur.status === "done") return undefined;
    return {
      ...cur,
      status: "paid",
      payment: {
        ...(cur.payment || {}),
        method: method || (cur.payment && cur.payment.method) || "qris_static",
        gateway: gateway || (cur.payment && cur.payment.gateway) || "admin",
        transaction_id: transactionId || (cur.payment && cur.payment.transaction_id) || "",
        paid_at: paidAt,
        confirmed_by: kasir,
      },
      updated_at: paidAt,
    };
  });
  result.steps.order = casRes.noop ? "skipped" : "paid";

  // 2. Release reserved (stok sudah dipotong saat reserve)
  const reservedItems = Array.isArray(order.reserved_items) ? order.reserved_items : [];
  const released = await releaseReserved(ctx, order, reservedItems);
  result.steps.reservedReleased = released.length;

  // 3. Masuk ke /pos/transactions (WAJIB)
  const payment = { ...(order.payment || {}), method: method || (order.payment && order.payment.method), gateway, transaction_id: transactionId, paid_at: paidAt };
  const pos = await insertPosTransaction(ctx, order, payment, { kasir, shiftId: "" });
  result.steps.posTransaction = pos.ok ? (pos.alreadyExists ? "exists" : "inserted") : "failed";
  result.posDate = pos.date;
  if (pos.ok && pos.date) {
    await fbPut(ctx, `online_orders/${encodeURIComponent(order.orderId)}/pos_date`, pos.date).catch(() => {});
  }

  // 4. Auto-jurnal (non-fatal)
  const journal = await autoJournal(env, order, "qris");
  result.steps.journal = journal.ok ? "posted" : `failed: ${journal.error || "unknown"}`;

  await markProcessed(ctx, order.orderId, "paid", {
    gateway,
    transaction_id: transactionId,
    kasir,
  });

  return result;
}

/* ==========================================================================
 * Expired / rollback
 * ========================================================================== */

export async function expireOrder(ctx, order, reason = "timeout_5_menit") {
  if (!order) return { ok: false, error: "Order tidak ditemukan" };
  if (order.status === "paid" || order.status === "done") {
    return { ok: false, error: `Order sudah ${order.status}, tidak bisa di-expire` };
  }
  if (await alreadyProcessed(ctx, order.orderId, "expired")) {
    return { ok: true, alreadyProcessed: true, orderId: order.orderId };
  }

  const reservedItems = Array.isArray(order.reserved_items) ? order.reserved_items : [];
  const rolled = await rollbackReserved(ctx, order, reservedItems);

  await casWrite(ctx, `online_orders/${encodeURIComponent(order.orderId)}`, (cur) => {
    if (!cur) return undefined;
    if (cur.status === "paid" || cur.status === "done" || cur.status === "expired") return undefined;
    return {
      ...cur,
      status: "expired",
      expired_at: new Date().toISOString(),
      expired_reason: reason,
      updated_at: new Date().toISOString(),
    };
  });

  await markProcessed(ctx, order.orderId, "expired", { reason, released: rolled.length });
  return { ok: true, orderId: order.orderId, rolledBack: rolled.length, reason };
}

/**
 * Sweep order pending_payment yang sudah lewat expires_at.
 * Dipanggil lazy di /payment/create & /online-orders/list (tanpa cron).
 */
export async function expireStaleOrders(ctx, { limit = 25 } = {}) {
  const all = (await fbGet(ctx, "online_orders")) || {};
  const now = Date.now();
  const stale = [];

  for (const [key, o] of Object.entries(all)) {
    if (!o || typeof o !== "object") continue;
    if (o.status !== "pending_payment") continue;
    const exp = o.payment && o.payment.expires_at ? Date.parse(o.payment.expires_at) : 0;
    if (exp && exp < now) stale.push({ orderId: o.orderId || key, order: o });
    if (stale.length >= limit) break;
  }

  const results = [];
  for (const s of stale) {
    try {
      results.push(await expireOrder(ctx, s.order, "timeout_5_menit"));
    } catch (e) {
      results.push({ ok: false, orderId: s.orderId, error: e.message });
    }
  }
  return results;
}
