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

/**
 * Kumpulkan log inventory jadi SATU request (Cloudflare membatasi jumlah
 * subrequest per invocation; 1 log = 1 subrequest cepat bikin limit tembus).
 */
function makeLogEntry(itemId, data) {
  return {
    itemId,
    logId: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    data,
  };
}

async function flushInventoryLogs(ctx, entries) {
  if (!entries || entries.length === 0) return;
  const payload = {};
  for (const e of entries) {
    if (!payload[e.itemId]) payload[e.itemId] = {};
    payload[e.itemId][e.logId] = e.data;
  }
  try {
    await fbPatch(ctx, "inventory_logs", payload);
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
  const logs = [];

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
      logs.push(makeLogEntry(res.itemId, {
        t: Date.now(),
        old: round3(toNum(result.data.stock) + res.qty),
        new: toNum(result.data.stock),
        diff: -res.qty,
        by: `landing-page (${order.orderId})`,
        reason: `Reserve stok order online ${order.orderId}`,
        changeType: "rto-reserve",
      }));
    } catch (e) {
      failures.push({ itemId: res.itemId, reason: `error: ${e.message}`, unit: res.unit });
    }
  }

  if (failures.length > 0) {
    await rollbackReserved(ctx, order, reserved);
    return { ok: false, reserved: [], failures };
  }

  await flushInventoryLogs(ctx, logs);
  return { ok: true, reserved, failures: [] };
}

/**
 * Paid: reserved dilepas (stok SUDAH dipotong saat reserve) → permanent deduct.
 */
export async function releaseReserved(ctx, order, reservedItems) {
  const released = [];
  const logs = [];
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
        logs.push(makeLogEntry(res.itemId, {
          t: Date.now(),
          old: toNum(result.data.stock),
          new: toNum(result.data.stock),
          diff: 0,
          reservedReleased: res.qty,
          by: `rto-paid (${order.orderId})`,
          reason: `Reserved → permanent deduct order ${order.orderId}`,
          changeType: "rto-paid-release",
        }));
      }
    } catch (e) {
      // lanjut item berikutnya
    }
  }
  await flushInventoryLogs(ctx, logs);
  return released;
}

/**
 * Expired / gagal bayar: stok dikembalikan, reserved dilepas.
 */
export async function rollbackReserved(ctx, order, reservedItems) {
  const rolled = [];
  const logs = [];
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
        logs.push(makeLogEntry(res.itemId, {
          t: Date.now(),
          old: round3(toNum(result.data.stock) - res.qty),
          new: toNum(result.data.stock),
          diff: res.qty,
          by: `rto-rollback (${order.orderId || ""})`,
          reason: `Rollback stok order online ${order.orderId || ""}`,
          changeType: "rto-expire-rollback",
        }));
      }
    } catch (e) {
      // lanjut item berikutnya
    }
  }
  await flushInventoryLogs(ctx, logs);
  return rolled;
}

/* ==========================================================================
 * FASE 4 — VOID / REFUND order online (kasir + PIN supervisor)
 * ========================================================================== */

/**
 * Refund lewat gateway (iFortePay) kalau env-nya tersedia.
 * QRIS statis tidak punya API refund → mode "manual" (kasir refund tunai/transfer).
 */
export async function refundViaGateway(env, order, { amount = 0, reason = "", kasir = "kasir" } = {}) {
  const url = (env && env.IFORTEPAY_REFUND_URL) || "";
  const apiKey = (env && env.IFORTEPAY_API_KEY) || "";
  const amountNum = toNum(amount);

  if (!url || !apiKey || !(amountNum > 0)) {
    return {
      mode: "manual",
      ok: true,
      amount: amountNum,
      reference: "",
      note: "Gateway refund tidak tersedia (QRIS statis) — kasir refund manual ke customer",
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        merchant_id: (env && env.IFORTEPAY_MERCHANT_ID) || "",
        order_id: order.orderId,
        transaction_id: (order.payment && order.payment.transaction_id) || order.orderId,
        amount: amountNum,
        reason: reason || "void_order_online",
        requested_by: kasir,
      }),
    });
    const data = await readJson(res);
    if (res.ok && data && data.success !== false) {
      return {
        mode: "gateway",
        ok: true,
        amount: amountNum,
        reference: data.refund_id || data.id || data.transaction_id || "",
        note: "Refund diproses gateway",
      };
    }
    return {
      mode: "gateway",
      ok: false,
      amount: amountNum,
      reference: "",
      note: (data && data.error) || `HTTP ${res.status}`,
    };
  } catch (e) {
    return { mode: "gateway", ok: false, amount: amountNum, reference: "", note: `error: ${e.message}` };
  }
}

/**
 * Void order paid: stok yang sudah dipotong permanen dikembalikan.
 * reserved_items menyimpan qty bahan (satuan inventory) per item — sama dengan yang
 * dipotong saat reserve, jadi reversal-nya presisi tanpa hitung ulang resep.
 * Kalau counter `reserved` ternyata masih menggantung (release saat paid gagal),
 * sekaligus dilepas supaya angkanya konvergen.
 */
export async function reverseStockForVoid(ctx, order, reservedItems, { kasir = "kasir", reason = "" } = {}) {
  const items = Array.isArray(reservedItems) ? reservedItems : [];
  const reversed = [];
  const logs = [];

  for (const res of items) {
    try {
      const result = await casWrite(ctx, `inventory/${encodeURIComponent(res.itemId)}`, (cur) => {
        if (!cur) return undefined;
        if (!(toNum(res.qty) > 0)) return undefined;
        const stock = toNum(cur.stock !== undefined ? cur.stock : cur.stok);
        const held = toNum(cur.reserved);
        const nextHeld = held >= res.qty ? round3(held - res.qty) : held;
        return {
          ...cur,
          stock: round3(stock + res.qty),
          stok: round3(stock + res.qty),
          reserved: nextHeld,
          lastUpdate: Date.now(),
          lastVoidAt: Date.now(),
          lastVoidBy: order.orderId,
        };
      });

      if (!result.noop) {
        reversed.push(res);
        logs.push(makeLogEntry(res.itemId, {
          t: Date.now(),
          old: round3(toNum(result.data.stock) - res.qty),
          new: toNum(result.data.stock),
          diff: res.qty,
          by: `rto-void (${order.orderId})`,
          reason: `Void order online ${order.orderId}${reason ? " — " + reason : ""}`,
          changeType: "rto-void-reverse",
          kasir,
        }));
      }
    } catch (e) {
      // lanjut item berikutnya; order tetap di-void
    }
  }

  await flushInventoryLogs(ctx, logs);
  return reversed;
}

/**
 * Counter-entry jurnal void: D Pendapatan 4001 / K Kas-Bank (1002 QRIS, 1001 tunai).
 * Idempotent lewat `ref = VOID-{orderId}` (dicek dulu, tidak dobel kalau di-retry).
 */
export async function postVoidJournal(ctx, env, order, { reason = "", kasir = "kasir", origin = "", dateStr = "" } = {}) {
  const orderId = order.orderId;
  const total = toNum(order.total);
  if (!(total > 0)) return { ok: true, skipped: true, via: "zero" };

  const date = dateStr || dateKey(Date.now());
  const bulan = date.slice(0, 7);
  const ref = `VOID-${orderId}`;

  try {
    const jr = await fbGet(ctx, `accounting/journal/${bulan}`);
    if (jr && typeof jr === "object" && Object.values(jr).some((v) => v && v.ref === ref)) {
      return { ok: true, skipped: true, via: "exists" };
    }
  } catch (e) {
    // gagal baca → lanjut coba posting
  }

  const pm = String((order.payment && order.payment.method) || "qris_static").toLowerCase();
  const isBank = pm.includes("qris") || pm.includes("transfer") || pm.includes("bank")
    || pm.includes("ewallet") || pm.includes("gopay") || pm.includes("ovo") || pm.includes("dana");
  const kasAcc = isBank ? "1002" : "1001";

  const body = JSON.stringify({
    noEntry: `VOID-${orderId.slice(-6)}`,
    date,
    category: "penyesuaian",
    desc: `VOID Order Online #${orderId} — ${reason || "dibatalkan kasir"}`,
    ref,
    status: "approved",
    createdBy: kasir,
    lines: [
      { acc: "4001", debit: total, credit: 0 },
      { acc: kasAcc, debit: 0, credit: total },
    ],
  });

  // Prioritas HTTP self-call: kerja akuntansi (ledger + summary) dapat budget sendiri.
  if (origin) {
    try {
      const res = await fetch(`${origin}/accounting/journal/${bulan}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await readJson(res);
      if (res.ok && data && data.success) return { ok: true, via: "http", id: data.id, total };
      return { ok: false, via: "http", error: (data && data.error) || `HTTP ${res.status}` };
    } catch (e) {
      // fallback in-process (mis. harness Node tanpa server)
    }
  }

  try {
    const mod = await import("../functions/accounting/[[path]].js");
    const req = new Request(`https://rto.internal/accounting/journal/${bulan}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const res = await mod.onRequest({ request: req, env });
    const data = await readJson(res);
    if (res.ok && data && data.success) return { ok: true, via: "import", id: data.id, total };
    return { ok: false, via: "import", error: (data && data.error) || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, via: "import", error: e.message };
  }
}

/**
 * Audit log void/refund — field lengkap sesuai spesifikasi RTO
 * (orderId, action void|refund, kasirUsername, supervisorVerified, refundAmount,
 *  timestamp, reason) + field lama (at/user/status) supaya viewer audit kasir
 * yang sudah ada tetap menampilkannya.
 */
export async function writeVoidAuditLog(ctx, {
  orderId = "", action = "void", kasir = "kasir", kasirName = "", shiftId = "",
  refundAmount = 0, refundMode = "", reason = "", supervisorVerified = true, status = "executed",
} = {}) {
  try {
    const key = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await fbPatch(ctx, `audit_logs/${key}`, {
      at: Date.now(),
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      user: kasir,
      userName: kasirName || kasir,
      shiftId,
      action: String(action || "void"),
      target: orderId,
      status,
      note: `${String(action || "void").toUpperCase()} ${orderId}${reason ? " — " + reason : ""}`,
      orderId,
      actionType: String(action || "void"),
      kasirUsername: kasir,
      supervisorVerified: !!supervisorVerified,
      refundAmount: toNum(refundAmount),
      refundMode,
      reason: reason || "",
      source: "rto-online-orders",
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Void / refund order online (kasir). Aturan:
 *   pending_payment → cancel, lepas reserved stok, tanpa refund
 *   pending         → refund (gateway kalau ada, kalau QRIS statis manual), lepas reserved stok
 *   paid            → refund, reverse stok, reverse jurnal, void transaksi POS, cancel
 *   expired         → cancel (stok sudah dikembalikan saat expire), tanpa refund
 *   done            → DIBLOKIR
 */
export async function voidOrder(ctx, env, order, { kasir = "kasir", kasirName = "", shiftId = "", reason = "", origin = "" } = {}) {
  const orderId = order.orderId;
  const status = String(order.status || "");
  const total = toNum(order.total);
  const reservedItems = Array.isArray(order.reserved_items) ? order.reserved_items : [];
  const steps = {};

  if (status === "done") {
    return {
      ok: false, orderId, status, code: "STATUS_DONE",
      error: "Order sudah DONE (pesanan sudah diambil customer) — tidak bisa di-void",
      steps,
    };
  }
  if (status === "cancelled") {
    return {
      ok: true, orderId, status, alreadyCancelled: true, steps,
      refundAmount: toNum(order.void && order.void.refund_amount),
    };
  }

  const refundApplies = status === "paid" || status === "pending";
  const refundAmount = refundApplies ? total : 0;

  // 1. Refund (paid & pending) atau bebas reserved stok (pending_payment)
  let refund = { mode: "none", ok: true, amount: 0, reference: "", note: "Tidak ada pembayaran — void tanpa refund" };
  let reversed = [];
  let rolled = [];

  if (refundApplies) {
    try {
      refund = await refundViaGateway(env, order, { amount: total, reason, kasir });
    } catch (e) {
      refund = { mode: "manual", ok: false, amount: total, reference: "", note: e.message };
    }
    steps.refund = `${refund.mode}:${refund.ok ? "ok" : "failed"}`;
  } else {
    steps.refund = "skipped";
  }

  if (status === "paid") {
    try {
      reversed = await reverseStockForVoid(ctx, order, reservedItems, { kasir, reason });
      steps.stockReverse = reversed.length;
    } catch (e) {
      steps.stockReverse = `failed: ${e.message}`;
    }
  } else if (status === "pending_payment" || status === "pending") {
    try {
      rolled = await rollbackReserved(ctx, order, reservedItems);
      steps.reservedReleased = rolled.length;
    } catch (e) {
      steps.reservedReleased = `failed: ${e.message}`;
    }
  }

  // 2. Transaksi POS → voided (hanya order yang sudah pernah masuk POS)
  if (status === "paid") {
    try {
      const posDate = order.pos_date || dateKey(Date.now());
      const existing = await fbGet(ctx, `pos/transactions/${posDate}/${encodeURIComponent(orderId)}`);
      if (!existing) {
        steps.posVoid = "skipped: transaksi POS tidak ditemukan";
      } else {
        await fbPatch(ctx, `pos/transactions/${posDate}/${encodeURIComponent(orderId)}`, {
          voided: true,
          voidedAt: Date.now(),
          voidedBy: kasir,
          voidReason: reason,
          voidSource: "rto-void-online",
          refundMode: refund.mode,
          refundAmount: total,
        });
        steps.posVoid = `voided:${posDate}`;
      }
    } catch (e) {
      steps.posVoid = `failed: ${e.message}`;
    }
  }

  // 3. Counter-entry jurnal (D Pendapatan / K Kas-Bank)
  if (status === "paid" && total > 0) {
    try {
      const j = await postVoidJournal(ctx, env, order, { reason, kasir, origin });
      steps.journal = j.ok ? `reversed:${j.via}` : `failed: ${j.error || "unknown"}`;
    } catch (e) {
      steps.journal = `failed: ${e.message}`;
    }
  }

  // 4. Order → cancelled (idempotent, 'done' tidak pernah ditimpa)
  const nowIso = new Date().toISOString();
  const voidInfo = {
    voided: true,
    voided_at: nowIso,
    voided_by: kasir,
    supervisor_verified: true,
    refund_amount: refundAmount,
    refund_mode: refund.mode,
    refund_reference: refund.reference || "",
    refund_note: refund.note || "",
    reversed_items: reversed.length,
    released_items: rolled.length,
  };
  try {
    const cas = await casWrite(ctx, `online_orders/${encodeURIComponent(orderId)}`, (cur) => {
      if (!cur) return undefined;
      if (cur.status === "done" || cur.status === "cancelled") return undefined;
      return {
        ...cur,
        status: "cancelled",
        cancelled_at: nowIso,
        cancelled_by: kasir,
        cancel_reason: reason,
        void: voidInfo,
        updated_at: nowIso,
      };
    });
    steps.order = cas.noop ? "skipped" : "cancelled";
  } catch (e) {
    steps.order = `failed: ${e.message}`;
  }

  try {
    await markProcessed(ctx, orderId, "cancelled", {
      by: kasir, reason, refund_mode: refund.mode, refund_amount: refundAmount,
    });
  } catch (e) {
    // marker hanya untuk audit
  }

  // 5. Notifikasi WA pembatalan + info refund (Fase 4 item 3)
  try {
    const wa = await sendOrderWa(ctx, env, { ...order, void: voidInfo }, "cancelled", {
      origin, refund: { amount: refundAmount, mode: refund.mode }, reason,
    });
    steps.wa = wa.skipped
      ? `skipped:${wa.reason || wa.status}`
      : (wa.ok ? `sent:${wa.via}:${wa.gateway_status || "-"}` : `failed:${wa.reason || wa.via}`);
  } catch (e) {
    steps.wa = `failed: ${e.message}`;
  }

  return {
    ok: true, orderId, status: "cancelled", refundAmount, refund,
    reversed: reversed.length, released: rolled.length, steps,
  };
}

/* ==========================================================================
 * FASE 4 — NOTIFIKASI WHATSAPP KE CUSTOMER (/api/send-wa)
 * ========================================================================== */

/** Format rupiah tanpa bergantung pada ICU (Worker-safe). */
function rupiah(n) {
  const s = String(Math.round(toNum(n)));
  return "Rp " + s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Waktu WIB (UTC+7) yang deterministik — Worker berjalan di UTC. */
function waTimeWib(iso) {
  const t = iso ? Date.parse(iso) : Date.now();
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + 7 * 3600 * 1000);
  const pad = (v) => String(v).padStart(2, "0");
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} WIB`;
}

/**
 * Susun isi WA per status:
 *   paid      → orderId, status, total, instruksi pickup, jam operasional, alamat outlet
 *   done      → ucapan terima kasih + struk text
 *   cancelled → info pembatalan + info refund
 */
export function buildOrderWaMessage(order, status, { outlet = {}, refund = null, reason = "" } = {}) {
  const brand = outlet.brandName || "Dapur Kuliner Viral";
  const address = outlet.address || "";
  const hours = outlet.operationalHours || "";
  const outletPhone = outlet.phone || "";
  const name = (order && order.customer && order.customer.name) || "Pelanggan";
  const orderId = (order && order.orderId) || "";
  const total = toNum(order && order.total);
  const items = Array.isArray(order && order.items) ? order.items : [];
  const pm = String((order && order.payment && order.payment.method) || "qris").toUpperCase();
  const itemLines = items
    .map((i) => `• ${i.qty || 1}x ${i.name || i.id} = ${rupiah((Number(i.price) || 0) * (Number(i.qty) || 1))}`)
    .join("\n");
  const join = (lines) => lines.filter((l) => l !== undefined && l !== null && l !== "").join("\n");

  if (status === "paid") {
    return join([
      `Halo ${name}, pembayaran pesanan Anda sudah kami terima ✅`,
      "",
      `No. Order: ${orderId}`,
      `Status: PAID — pesanan siap disiapkan`,
      `Total: ${rupiah(total)}`,
      `Metode: ${pm}`,
      itemLines ? "" : null,
      itemLines,
      "",
      "Ambil pesanan Anda (PICKUP) di outlet kami:",
      `📍 ${brand}${address ? " — " + address : ""}`,
      hours ? `🕒 Jam operasional: ${hours}` : null,
      "",
      "Tunjukkan nomor order di atas ke kasir saat pengambilan. Terima kasih! 🙏",
    ]);
  }

  if (status === "done") {
    return join([
      `Terima kasih ${name}! Pesanan ${orderId} sudah diserahkan ✅`,
      "",
      `*${String(brand).toUpperCase()} — STRUK PICKUP*`,
      address,
      outletPhone ? `Telp/WA: ${outletPhone}` : null,
      "--------------------------------",
      `No. Order : ${orderId}`,
      `Tanggal   : ${waTimeWib((order && order.done_at) || "")}`,
      `Kasir     : ${(order && order.done_by) || "kasir"}`,
      `Metode    : ${pm}`,
      "--------------------------------",
      itemLines,
      "--------------------------------",
      `TOTAL     : ${rupiah(total)}`,
      "",
      `Terima kasih sudah memesan di ${brand} 🙏 Sampai jumpa lagi!`,
    ]);
  }

  // cancelled / void
  const refundAmount = refund && refund.amount !== undefined
    ? toNum(refund.amount)
    : toNum(order && order.void && order.void.refund_amount);
  const refundMode = (refund && refund.mode) || (order && order.void && order.void.refund_mode) || "none";
  const refundLine = refundAmount > 0
    ? (refundMode === "gateway"
      ? `Refund ${rupiah(refundAmount)} diproses kembali ke metode pembayaran Anda oleh gateway.`
      : `Refund ${rupiah(refundAmount)} dilakukan MANUAL oleh kasir kami (tunai/transfer) — silakan hubungi ${outletPhone || "kasir outlet"}.`)
    : "Tidak ada dana yang ditarik, jadi tidak ada refund yang perlu diproses.";

  return join([
    `Halo ${name}, pesanan ${orderId} telah DIBATALKAN ❌`,
    "",
    `Total order: ${rupiah(total)}`,
    `Refund: ${refundAmount > 0 ? rupiah(refundAmount) : "tidak ada"}`,
    reason ? `Alasan: ${reason}` : null,
    "",
    refundLine,
    "",
    `Kalau ada pertanyaan, hubungi kami di ${outletPhone || brand}. Terima kasih. 🙏`,
  ]);
}

/**
 * Kirim notifikasi WA order online ke customer (1x per status per order).
 * Pakai HTTP self-call ke /api/send-wa supaya handler WA memakai budget subrequest sendiri.
 */
export async function sendOrderWa(ctx, env, order, status, { origin = "", refund = null, reason = "" } = {}) {
  const orderId = (order && order.orderId) || "";
  const phone = String((order && order.customer && order.customer.phone) || "").trim();

  // FASE 5: status paid TIDAK mengirim WA — notifikasi paid hanya tampil di landing page customer
  if (status === "paid") {
    return { ok: false, skipped: true, status, reason: "paid_tidak_kirim_wa" };
  }

  if (!orderId || !phone) {
    return { ok: false, skipped: true, status, reason: "nomor WA customer belum ada" };
  }

  // Guard anti dobel: marker status di order + log /notifications_log/{orderId}_wa_{status}
  const waLogId = `${orderId}_wa_${status}`;
  try {
    const sent = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}/wa_notifications/${status}`);
    if (sent) return { ok: true, skipped: true, status, reason: "notifikasi sudah pernah dikirim" };
  } catch (e) {
    // lanjut kirim
  }
  try {
    const logged = await fbGet(ctx, `notifications_log/${encodeURIComponent(waLogId)}`);
    if (logged) return { ok: true, skipped: true, status, reason: "log notifikasi sudah ada" };
  } catch (e) {
    // lanjut kirim
  }

  let outlet = {};
  try {
    outlet = (await fbGet(ctx, "site_config")) || {};
  } catch (e) {
    outlet = {};
  }

  const message = buildOrderWaMessage(order, status, { outlet, refund, reason });
  const payload = JSON.stringify({ phone, message, template: `rto_${status}`, logId: waLogId });
  const headers = { "Content-Type": "application/json" };

  let detail = null;
  let ok = false;
  let via = "http";

  if (origin) {
    try {
      const res = await fetch(`${origin}/api/send-wa`, { method: "POST", headers, body: payload });
      detail = await readJson(res);
      ok = !!(res.ok && detail && detail.success);
      if (!ok) via = "http";
    } catch (e) {
      via = "http-error";
    }
  } else {
    via = "import";
  }

  if (!ok) {
    try {
      const mod = await import("../functions/api/send-wa.js");
      const req = new Request("https://rto.internal/api/send-wa", { method: "POST", headers, body: payload });
      const res = await mod.onRequest({ request: req, env });
      detail = await readJson(res);
      ok = !!(res.ok && detail && detail.success);
      via = ok ? "import" : "import-error";
    } catch (e) {
      via = "import-error";
    }
  }

  if (ok) {
    try {
      await fbPatch(ctx, `online_orders/${encodeURIComponent(orderId)}/wa_notifications`, {
        [status]: {
          at: Date.now(),
          iso: new Date().toISOString(),
          phone,
          via,
          gateway_status: (detail && detail.status) || "",
          message_id: (detail && detail.messageId) || "",
        },
      });
    } catch (e) {
      // marker notifikasi bukan hal kritis
    }
  }

  return {
    ok,
    status,
    via,
    phone,
    log_id: waLogId,
    provider: (detail && detail.provider) || "",
    gateway_status: (detail && detail.status) || "",
    gateway_configured: !!(detail && detail.gatewayConfigured),
    wa_link: (detail && detail.waLink) || "",
    message_preview: message.slice(0, 120),
  };
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

export async function autoJournal(env, order, pm = "qris", origin = "") {
  const body = JSON.stringify({
    orderId: order.orderId,
    date: dateKey(Date.now()),
    pm,
    total: order.total,
    items: (order.items || []).map((i) => ({ id: i.id, qty: i.qty, price: i.price })),
  });

  // Prioritas HTTP self-call: kerja akuntansi (ledger + summary) punya budget
  // subrequest milik invocation sendiri. Kalau dipanggil in-process, seluruh
  // kerja itu makan jatah 50 subrequest milik invocation ini dan limit tembus.
  if (origin) {
    try {
      const res = await fetch(`${origin}/accounting/journal/pos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const data = await readJson(res);
      if (res.ok && data && (data.success || data.totalRev !== undefined)) {
        return { ok: true, via: "http", data };
      }
      return { ok: false, via: "http", error: (data && data.error) || `HTTP ${res.status}` };
    } catch (e) {
      // fallback in-process (mis. harness Node tanpa server)
    }
  }

  try {
    const mod = await import("../functions/accounting/[[path]].js");
    const req = new Request("https://rto.internal/accounting/journal/pos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const res = await mod.onRequest({ request: req, env });
    const data = await readJson(res);
    return { ok: !!(data && data.success), via: "import", data };
  } catch (e) {
    return { ok: false, via: "import", error: e.message };
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
  origin = "",
} = {}) {
  const orderId = order.orderId;
  const paidAt = new Date().toISOString();
  const replayed = await alreadyProcessed(ctx, orderId, "paid").catch(() => false);
  const result = {
    orderId,
    replayed,
    alreadyProcessed: replayed,
    steps: {},
  };

  // 1. Order → paid (idempotent: status akhir tidak akan ditimpa)
  try {
    const casRes = await casWrite(ctx, `online_orders/${encodeURIComponent(orderId)}`, (cur) => {
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
  } catch (e) {
    result.steps.order = `failed: ${e.message}`;
  }

  // 2. Reserved stok → permanent deduct (sekali saja per order)
  try {
    if (order.reserved_released_at) {
      result.steps.reservedReleased = "skipped";
    } else {
      const reservedItems = Array.isArray(order.reserved_items) ? order.reserved_items : [];
      const released = await releaseReserved(ctx, order, reservedItems);
      await fbPut(ctx, `online_orders/${encodeURIComponent(orderId)}/reserved_released_at`, paidAt).catch(() => {});
      result.steps.reservedReleased = released.length;
    }
  } catch (e) {
    result.steps.reservedReleased = `failed: ${e.message}`;
  }

  // 3. WAJIB: masuk /pos/transactions (ksr/shf diisi saat kasir klik Done)
  try {
    const payment = {
      ...(order.payment || {}),
      method: method || (order.payment && order.payment.method),
      gateway,
      transaction_id: transactionId,
      paid_at: paidAt,
    };
    const pos = await insertPosTransaction(ctx, order, payment, { kasir, shiftId: "" });
    result.steps.posTransaction = pos.ok ? (pos.alreadyExists ? "exists" : "inserted") : "failed";
    result.posDate = pos.date;
    if (pos.ok && pos.date) {
      await fbPut(ctx, `online_orders/${encodeURIComponent(orderId)}/pos_date`, pos.date).catch(() => {});
    }
  } catch (e) {
    result.steps.posTransaction = `failed: ${e.message}`;
  }

  // 4. Auto-jurnal akuntansi — guard anti dobel (cek entri dengan ref order ini)
  try {
    const bulan = dateKey(Date.now()).slice(0, 7);
    let journalExists = false;
    try {
      const jr = await fbGet(ctx, `accounting/journal/${bulan}`);
      journalExists = !!(jr && typeof jr === "object" &&
        Object.values(jr).some((v) => v && v.ref === orderId && v.category === "pendapatan"));
    } catch (e) {
      // kalau gagal baca, lanjut coba posting (akuntansi idempotent lewat ref check berikutnya)
    }
    if (journalExists) {
      result.steps.journal = "exists";
    } else {
      const j = await autoJournal(env, order, "qris", origin);
      result.steps.journal = j.ok ? `posted:${j.via}` : `failed: ${j.error || "unknown"}`;
    }
  } catch (e) {
    result.steps.journal = `failed: ${e.message}`;
  }

  // 5. Notifikasi WA customer (paid) — 1x per order per status (Fase 4 item 3)
  try {
    const wa = await sendOrderWa(ctx, env, order, "paid", { origin });
    result.steps.wa = wa.skipped
      ? `skipped:${wa.reason || wa.status}`
      : (wa.ok ? `sent:${wa.via}:${wa.gateway_status || "-"}` : `failed:${wa.reason || wa.via}`);
  } catch (e) {
    result.steps.wa = `failed: ${e.message}`;
  }

  try {
    await markProcessed(ctx, orderId, "paid", { gateway, transaction_id: transactionId, kasir });
  } catch (e) {
    // marker hanya untuk audit
  }

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
export async function expireStaleOrders(ctx, { limit = 3 } = {}) {
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
