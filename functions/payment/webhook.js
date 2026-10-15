/**
 * functions/payment/webhook.js
 * Cloudflare Pages Function — POST /payment/webhook
 *
 * Callback dari payment gateway (iFortePay). Saat pembayaran terkonfirmasi:
 *   - order → paid
 *   - reserved stok dilepas (stok sudah dipotong saat reserve) = permanent deduct
 *   - auto-jurnal akuntansi (D Kas/Bank, K Pendapatan)
 *   - insert ke /pos/transactions/{date}/{orderId} sebagai transaksi kasir
 *
 * Payload yang diterima (kompatibel beberapa bentuk):
 *   { order_id | orderId | ref_id | reference_id, status | transaction_status,
 *     transaction_id | trx_id, signature | token }
 * Header alternatif: x-callback-token
 *
 * Kalau env IFORTEPAY_WEBHOOK_SECRET diisi, signature WAJIB cocok.
 */

import {
  json, preflight, methodNotAllowed, dbCtx, fbGet, fbPut,
  finalizePaid, expireOrder,
} from "../../lib/rto-core.js";

const PAID_STATES = ["paid", "settlement", "capture", "success", "berhasil", "lunas", "completed", "done"];
const FAILED_STATES = ["expired", "expire", "failed", "gagal", "cancel", "cancelled", "canceled", "deny", "timeout"];

function pickString(obj, keys) {
  for (const k of keys) {
    const segs = k.split(".");
    let v = obj;
    for (const s of segs) v = v == null ? v : v[s];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function timingSafeEqual(a, b) {
  const s1 = String(a || "");
  const s2 = String(b || "");
  if (s1.length !== s2.length || s1.length === 0) return false;
  let out = 0;
  for (let i = 0; i < s1.length; i++) out |= s1.charCodeAt(i) ^ s2.charCodeAt(i);
  return out === 0;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") return methodNotAllowed("Gunakan POST");

  const ctx = dbCtx(env);

  try {
    const rawText = await request.text();
    let body = {};
    try {
      body = JSON.parse(rawText);
    } catch (e) {
      // fallback form-urlencoded
      body = Object.fromEntries(new URLSearchParams(rawText || ""));
    }

    const orderId = pickString(body, [
      "order_id", "orderId", "ref_id", "reference_id", "merchant_ref", "data.order_id", "data.reference_id",
    ]);
    const status = pickString(body, ["status", "transaction_status", "payment_status", "data.status"]).toLowerCase();
    const transactionId = pickString(body, ["transaction_id", "trx_id", "id", "data.transaction_id", "data.trx_id"]);
    const signature = pickString(body, ["signature", "sign", "token", "hash"]) ||
      request.headers.get("x-callback-token") ||
      request.headers.get("authorization") ||
      "";

    if (!orderId) return json({ success: false, error: "order_id tidak ditemukan di payload" }, 400);

    const secret = env.IFORTEPAY_WEBHOOK_SECRET || "";
    if (secret && !timingSafeEqual(signature.replace(/^Bearer\s+/i, ""), secret)) {
      return json({ success: false, error: "Signature webhook tidak valid" }, 403);
    }

    const order = await fbGet(ctx, `online_orders/${encodeURIComponent(orderId)}`);
    if (!order) {
      // Selalu 200 supaya gateway tidak retry tanpa henti untuk order asing.
      return json({ success: false, orderId, error: "Order tidak ditemukan" }, 200);
    }

    const logId = `${orderId}_${Date.now()}`;
    await fbPut(ctx, `rto_webhook_logs/${logId}`, {
      orderId, status, transaction_id: transactionId,
      received_at: new Date().toISOString(), raw: body,
    }).catch(() => {});

    if (PAID_STATES.includes(status)) {
      const result = await finalizePaid(ctx, env, order, {
        transactionId,
        gateway: "ifortepay",
        kasir: "gateway",
        method: (order.payment && order.payment.method) || "qris_dynamic",
        origin: new URL(request.url).origin,
      });
      return json({ success: true, orderId, status: "paid", result });
    }

    if (FAILED_STATES.includes(status)) {
      const result = await expireOrder(ctx, order, `gateway:${status}`);
      return json({ success: true, orderId, status: "expired", result });
    }

    return json({ success: true, orderId, status: order.status || "pending_payment", note: `status gateway '${status}' belum final` });
  } catch (err) {
    return json({ success: false, error: err.message || "Internal error" }, 500);
  }
}
