/**
 * functions/online-orders/[[path]].js
 * Cloudflare Pages Function — API Order Online (RTO) untuk kasir & customer.
 *
 * ROUTES:
 *   GET    /online-orders/list                     → queue kasir (+ statistik + sweep expire)
 *   GET    /online-orders/{orderId}                → detail 1 order
 *   POST   /online-orders/verify                   → kasir verifikasi pembayaran (QRIS statis)
 *   POST   /online-orders/expire                   → expire 1 order ({orderId}) atau sweep semua
 *   PATCH  /online-orders/{orderId}                → action: customer_paid | done | expire | cancel | void
 *                                                    (void = void/refund + PIN supervisor)
 *
 * Query /online-orders/list:
 *   ?status=paid,done    (default: semua kecuali expired)
 *   ?date=YYYY-MM-DD     (default: semua tanggal)
 *   ?q=ORD-xxx|nama      (search)
 *   ?limit=100
 */

import {
  json, preflight, methodNotAllowed, dbCtx, toNum, fbGet, fbPatch, casWrite,
  finalizePaid, expireOrder, expireStaleOrders, dateKey,
  voidOrder, writeVoidAuditLog, sendOrderWa,
} from "../../lib/rto-core.js";

const ACTIVE_STATUSES = ["pending_payment", "pending", "paid", "done"];

function sortNewestFirst(list) {
  return list.sort((a, b) => (Date.parse(b.created_at || 0) || 0) - (Date.parse(a.created_at || 0) || 0));
}

function orderSummary(o) {
  return {
    orderId: o.orderId,
    status: o.status,
    customer: o.customer || {},
    items: o.items || [],
    itemsCount: Array.isArray(o.items) ? o.items.reduce((a, i) => a + toNum(i.qty), 0) : 0,
    subtotal: toNum(o.subtotal),
    total: toNum(o.total),
    created_at: o.created_at,
    done_at: o.done_at || "",
    done_by: o.done_by || "",
    payment: {
      method: (o.payment && o.payment.method) || "",
      gateway: (o.payment && o.payment.gateway) || "",
      transaction_id: (o.payment && o.payment.transaction_id) || "",
      paid_at: (o.payment && o.payment.paid_at) || "",
      expires_at: (o.payment && o.payment.expires_at) || "",
    },
    pos_date: o.pos_date || "",
    cancelled_at: o.cancelled_at || "",
    cancelled_by: o.cancelled_by || "",
    cancel_reason: o.cancel_reason || "",
    voided: !!(o.void && o.void.voided),
    void_info: o.void || null,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") return preflight();

  const ctx = dbCtx(env);
  const parts = url.pathname.replace(/^\/online-orders\/?/, "").split("/").filter(Boolean);

  try {
    /* ---------------------------------------------------------------- */
    /* GET /online-orders/list                                          */
    /* ---------------------------------------------------------------- */
    if (method === "GET" && parts[0] === "list") {
      await expireStaleOrders(ctx).catch(() => {});

      const statusParam = (url.searchParams.get("status") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const dateParam = url.searchParams.get("date") || "";
      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const limit = Math.min(500, Math.max(1, toNum(url.searchParams.get("limit")) || 200));
      const includeExpired = statusParam.includes("expired");

      const raw = (await fbGet(ctx, "online_orders")) || {};
      let list = Object.entries(raw)
        .map(([key, o]) => (o && typeof o === "object" ? { ...o, orderId: o.orderId || key } : null))
        .filter(Boolean);

      if (!includeExpired) list = list.filter((o) => o.status !== "expired");
      if (statusParam.length > 0 && !statusParam.includes("all")) {
        list = list.filter((o) => statusParam.includes(o.status));
      }
      if (dateParam) {
        list = list.filter((o) => String(o.created_at || "").slice(0, 10) === dateParam);
      }
      if (q) {
        list = list.filter((o) =>
          String(o.orderId || "").toLowerCase().includes(q) ||
          String((o.customer && o.customer.name) || "").toLowerCase().includes(q) ||
          String((o.customer && o.customer.phone) || "").includes(q)
        );
      }

      sortNewestFirst(list);

      const today = dateKey(Date.now());
      const stats = {
        date: today,
        pending_payment: 0,
        pending: 0,
        paid: 0,
        done: 0,
        cancelled: 0,
        totalOrdersToday: 0,
        revenueToday: 0,
      };
      for (const o of list) {
        if (stats[o.status] !== undefined) stats[o.status] += 1;
        const isToday = String(o.created_at || "").slice(0, 10) === today;
        if (isToday) {
          stats.totalOrdersToday += 1;
          if (o.status === "paid" || o.status === "done") stats.revenueToday += toNum(o.total);
        }
      }
      stats.queue = stats.paid; // badge kasir: order paid yang belum done

      return json({
        success: true,
        count: list.length,
        stats,
        orders: list.slice(0, limit).map(orderSummary),
      });
    }

    /* ---------------------------------------------------------------- */
    /* POST /online-orders/verify  (kasir — QRIS statis)                */
    /* ---------------------------------------------------------------- */
    if (method === "POST" && parts[0] === "verify") {
      const body = await request.json().catch(() => ({}));
      const orderId = String(body.orderId || "").trim();
      const kasir = String(body.kasir || "kasir").trim();
      const shiftId = String(body.shiftId || "").trim();
      if (!orderId) return json({ success: false, error: "orderId wajib diisi" }, 400);

      const order = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`);
      if (!order) return json({ success: false, error: "Order tidak ditemukan" }, 404);
      if (order.status === "expired") {
        return json({ success: false, error: "Order sudah expired, tidak bisa diverifikasi" }, 409);
      }

      const result = await finalizePaid(ctx, env, order, {
        transactionId: String(body.transaction_id || "").trim(),
        gateway: (order.payment && order.payment.gateway) || "admin",
        kasir,
        method: (order.payment && order.payment.method) || "qris_static",
        origin: url.origin,
      });

      // Shift kasir yang memverifikasi (kalau dikirim) langsung dicatat di transaksi POS.
      if (shiftId) {
        try {
          await applyKasirShift(ctx, orderId, kasir, shiftId, order.pos_date || dateKey(Date.now()));
        } catch (e) {
          result.steps.shift = `failed: ${e.message}`;
        }
      }

      // Kirim ulang data order terbaru (untuk UI kasir & halaman customer)
      const fresh = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`);
      return json({ success: true, orderId, status: (fresh && fresh.status) || "paid", result });
    }

    /* ---------------------------------------------------------------- */
    /* POST /online-orders/expire                                       */
    /* ---------------------------------------------------------------- */
    if (method === "POST" && parts[0] === "expire") {
      const body = await request.json().catch(() => ({}));
      const orderId = String(body.orderId || "").trim();
      if (!orderId) {
        const results = await expireStaleOrders(ctx, { limit: 50 });
        return json({ success: true, swept: results.length, results });
      }
      const order = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`);
      if (!order) return json({ success: false, error: "Order tidak ditemukan" }, 404);
      const result = await expireOrder(ctx, order, String(body.reason || "manual"));
      return json({ success: result.ok, orderId, result });
    }

    /* ---------------------------------------------------------------- */
    /* GET /online-orders/{orderId}                                     */
    /* ---------------------------------------------------------------- */
    if (method === "GET" && parts.length === 1 && parts[0] !== "list") {
      const orderId = decodeURIComponent(parts[0]);
      const order = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`);
      if (!order) return json({ success: false, error: "Order tidak ditemukan" }, 404);
      return json({
        success: true,
        orderId,
        order,
        summary: orderSummary({ ...order, orderId }),
      });
    }

    /* ---------------------------------------------------------------- */
    /* PATCH /online-orders/{orderId}                                   */
    /* ---------------------------------------------------------------- */
    if ((method === "PATCH" || method === "POST") && parts.length === 1 && parts[0] !== "list") {
      const orderId = decodeURIComponent(parts[0]);
      const body = await request.json().catch(() => ({}));
      const action = String(body.action || "").trim();
      const kasir = String(body.kasir || "kasir").trim();
      const shiftId = String(body.shiftId || "").trim();

      const order = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`);
      if (!order) return json({ success: false, error: "Order tidak ditemukan" }, 404);

      // Customer klik "Saya sudah bayar" → pending (menunggu konfirmasi)
      if (action === "customer_paid") {
        if (order.status !== "pending_payment") {
          return json({ success: true, orderId, status: order.status, note: "status sudah lanjut" });
        }
        const res = await casWrite(ctx, `online_orders/${encodeURIComponent(orderId)}`, (cur) => {
          if (!cur || cur.status !== "pending_payment") return undefined;
          return { ...cur, status: "pending", customer_claimed_paid_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        });
        return json({ success: true, orderId, status: res.noop ? order.status : "pending" });
      }

      // Kasir serahkan pesanan → done
      if (action === "done") {
        if (order.status === "done") {
          return json({ success: true, orderId, status: "done", alreadyDone: true });
        }
        if (order.status !== "paid" && order.status !== "pending") {
          return json({ success: false, error: `Order berstatus '${order.status}' tidak bisa di-Done` }, 409);
        }

        const doneAt = new Date().toISOString();
        await casWrite(ctx, `online_orders/${encodeURIComponent(orderId)}`, (cur) => {
          if (!cur) return undefined;
          if (cur.status === "done") return undefined;
          return { ...cur, status: "done", done_at: doneAt, done_by: kasir, updated_at: doneAt };
        });

        // Transaksi POS milik shift kasir yang menyerahkan pesanan (CONSTRAINT-4).
        const posResult = await applyKasirShift(ctx, orderId, kasir, shiftId, order.pos_date || dateKey(Date.now()));

        // FASE 4 item 3: WA notif terima kasih + struk text ke customer.
        let waResult = null;
        try {
          const freshOrder = (await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`)) || order;
          waResult = await sendOrderWa(ctx, env, freshOrder, "done", { origin: url.origin });
        } catch (e) {
          waResult = { ok: false, status: "done", reason: e.message };
        }

        return json({ success: true, orderId, status: "done", done_at: doneAt, done_by: kasir, pos: posResult, wa: waResult });
      }

      // Kasir void/refund order (WAJIB PIN supervisor + alasan)
      if (action === "void") {
        const reason = String(body.reason || "").trim();
        const supervisorPin = String(body.supervisorPin || "").trim();

        if (reason.length < 5) {
          return json({ success: false, error: "Alasan void wajib diisi (min 5 karakter)" }, 400);
        }
        if (order.status === "done") {
          return json({
            success: false,
            error: "Order sudah DONE (pesanan sudah diambil customer) — tidak bisa di-void",
            orderId, status: order.status,
          }, 409);
        }

        // Verifikasi PIN supervisor di server (site_config.supervisorPin)
        let cfgPin = "";
        try {
          cfgPin = String((await fbGet(ctx, "site_config/supervisorPin")) || "").trim();
        } catch (e) {
          cfgPin = "";
        }
        if (cfgPin && supervisorPin !== cfgPin) {
          await writeVoidAuditLog(ctx, {
            orderId, action: "void", kasir, shiftId, reason,
            refundAmount: 0, refundMode: "", supervisorVerified: false, status: "denied_wrong_pin",
          }).catch(() => {});
          return json({ success: false, error: "PIN supervisor salah" }, 403);
        }

        const result = await voidOrder(ctx, env, order, {
          kasir, kasirName: String(body.kasirName || "").trim(), shiftId, reason, origin: url.origin,
        });

        if (!result.ok) {
          return json({ success: false, error: result.error, orderId, status: order.status }, 409);
        }

        // Audit log: 1 entri void + 1 entri refund (kalau ada refund)
        await writeVoidAuditLog(ctx, {
          orderId, action: "void", kasir, kasirName: String(body.kasirName || "").trim(), shiftId, reason,
          refundAmount: result.refundAmount, refundMode: (result.refund && result.refund.mode) || "",
          supervisorVerified: true, status: "executed",
        }).catch(() => {});
        if (toNum(result.refundAmount) > 0) {
          await writeVoidAuditLog(ctx, {
            orderId, action: "refund", kasir, kasirName: String(body.kasirName || "").trim(), shiftId, reason,
            refundAmount: result.refundAmount, refundMode: (result.refund && result.refund.mode) || "",
            supervisorVerified: true, status: (result.refund && result.refund.ok) ? "executed" : "pending_manual",
          }).catch(() => {});
        }

        return json({ success: true, orderId, status: "cancelled", result });
      }

      if (action === "expire" || action === "cancel") {
        const result = await expireOrder(ctx, order, action);
        return json({ success: result.ok, orderId, result });
      }

      return json({ success: false, error: "action tidak dikenal (customer_paid|done|expire|cancel|void)" }, 400);
    }

    return json({ success: false, error: `Route /online-orders/${parts.join("/")} tidak ditemukan` }, 404);
  } catch (err) {
    return json({ success: false, error: err.message || "Internal error" }, 500);
  }
}

/**
 * Set ksr + shf pada transaksi POS hasil order online.
 * Dijalankan saat kasir klik Done (bukan saat create).
 */
async function applyKasirShift(ctx, orderId, kasir, shiftId, posDate) {
  const dates = [];
  if (posDate) dates.push(posDate);
  if (!dates.includes(dateKey(Date.now()))) dates.push(dateKey(Date.now()));

  for (const d of dates) {
    const tx = await fbGet(ctx, `pos/transactions/${d}/${encodeURIComponent(orderId)}`);
    if (!tx) continue;
    const ok = await fbPatch(ctx, `pos/transactions/${d}/${encodeURIComponent(orderId)}`, {
      ksr: kasir,
      shf: shiftId,
      done_at: new Date().toISOString(),
      done_by: kasir,
    });
    return { ok, date: d, txId: orderId, kasir, shiftId };
  }
  return { ok: false, reason: "transaksi POS belum ada" };
}
