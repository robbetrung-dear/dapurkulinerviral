/**
 * functions/payment/create.js
 * Cloudflare Pages Function — POST /payment/create
 *
 * Alur RTO (Realtime Order):
 *   1. Validasi customer (nama + no WA, pickup only) & hitung total dari harga server.
 *   2. Create order /online_orders/{orderId} status pending_payment (QRIS 5 menit).
 *   3. RESERVE STOK via Firebase atomic write (ETag + if-match): stok -= qty,
 *      reserved += qty. Gagal → rollback + order expired.
 *   4. QRIS dinamis (iFortePay/Midtrans bila tersedia), fallback QRIS statis admin.
 *
 * Body:
 *   { orderId?, customer: { name, phone }, items: [{ id, qty }], note? }
 */

import {
  CORS, json, preflight,
  dbCtx, toNum, fbGet, fbPut,
  buildOrderDraft, loadMenuMap, resolveReservation, reserveStock,
  loadPaymentConfig, createDynamicQris, staticQrisPayment,
  expireStaleOrders, formatOrderId, methodNotAllowed,
  RTO_TTL_MINUTES,
} from "../../lib/rto-core.js";

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") return methodNotAllowed("Gunakan POST");

  const ctx = dbCtx(env);

  try {
    const payload = await request.json().catch(() => ({}));

    const menuMap = await loadMenuMap(ctx);
    const draft = buildOrderDraft(payload, menuMap);
    if (!draft.ok) return json({ success: false, error: draft.error }, 400);
    const order = draft.order;

    // ID order dari client (idempotent retry) atau generate baru.
    const rawId = String(payload.orderId || "").trim().toUpperCase();
    const orderId = /^ORD-[A-Z0-9-]{4,40}$/.test(rawId) ? rawId : formatOrderId();
    order.orderId = orderId;

    // Idempotency: order yang sama tidak dibuat dua kali.
    const existing = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`);
    if (existing) {
      return json({
        success: true,
        reused: true,
        orderId,
        status: existing.status,
        order: existing,
        payment: existing.payment || {},
      });
    }

    // Sweep order pending_payment yang kedaluwarsa (pengganti cron).
    await expireStaleOrders(ctx).catch(() => {});

    const now = Date.now();
    const expiresAt = new Date(now + RTO_TTL_MINUTES * 60 * 1000).toISOString();
    order.created_at = new Date(now).toISOString();
    order.source = "landing-page";

    // --- QRIS: dinamis dulu, fallback statis admin ---
    const cfg = await loadPaymentConfig(ctx);
    let payment = await createDynamicQris(ctx, env, order);
    if (!payment) {
      if (!cfg.qrisImage) {
        return json({
          success: false,
          error: "QRIS belum dikonfigurasi. Isi siteConfig.paymentConfig.qrisImage di panel admin.",
        }, 503);
      }
      payment = staticQrisPayment(cfg, order);
    }
    payment.paid_at = "";
    payment.expires_at = expiresAt;

    // --- Kebutuhan bahan (reserved stock) ---
    const reservations = await resolveReservation(ctx, order.items, menuMap);

    order.status = "pending_payment";
    order.payment = payment;
    order.reserved_items = reservations;
    order.updated_at = order.created_at;

    // 1. Tulis order dulu supaya selalu ada rekam jejak.
    const orderWritten = await fbPut(ctx, `online_orders/${encodeURIComponent(orderId)}`, order);
    if (!orderWritten) {
      return json({ success: false, error: "Gagal menyimpan order ke database" }, 502);
    }

    // 2. RESERVE STOK (atomic per item).
    const reserveResult = await reserveStock(ctx, order, reservations);
    if (!reserveResult.ok) {
      order.reserved_items = [];
      order.status = "expired";
      order.expired_reason = "stok_tidak_cukup";
      order.expired_at = new Date().toISOString();
      await fbPut(ctx, `online_orders/${encodeURIComponent(orderId)}`, order).catch(() => {});
      const names = reserveResult.failures.map((f) => f.itemId).join(", ");
      return json({
        success: false,
        error: `Stok bahan tidak mencukupi (${names}). Silakan kurangi jumlah pesanan.`,
        orderId,
        failures: reserveResult.failures,
      }, 409);
    }

    // 3. Catat ringkasan reserve di order (audit).
    await fbPut(ctx, `online_orders/${encodeURIComponent(orderId)}/reserved_summary`, {
      items: reserveResult.reserved.length,
      qty: reserveResult.reserved.reduce((a, r) => a + toNum(r.qty), 0),
      at: Date.now(),
    }).catch(() => {});

    return json({
      success: true,
      orderId,
      status: order.status,
      order,
      payment: {
        ...payment,
        expires_at: expiresAt,
        expires_in_seconds: Math.round((Date.parse(expiresAt) - Date.now()) / 1000),
      },
      reserve: { checked: reservations.length, reserved: reserveResult.reserved.length },
      ttl_minutes: RTO_TTL_MINUTES,
    });
  } catch (err) {
    return json({ success: false, error: err.message || "Internal error" }, 500);
  }
}
