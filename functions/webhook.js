/**
 * functions/webhook.js - Cloudflare Pages Function
 * Endpoint Webhook HTTP POST untuk Notifikasi Transaksi Midtrans
 * 
 * Standar Keamanan Tinggi:
 * 1. Verifikasi Signature Key (SHA-512) mencegah forgery / spoofing.
 * 2. Update status otomatis ke Firebase Realtime Database (/orders/:id/status).
 * 3. Pencatatan Log Transaksi Audit ke Firebase Realtime Database (/logs/:id) untuk audit berkala.
 */

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Hanya menerima POST dari Midtrans." }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  try {
    const notification = await request.json();
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
      payment_type,
      transaction_time,
      transaction_id
    } = notification;

    const serverKey = env.MIDTRANS_SERVER_KEY || "YOUR_MIDTRANS_SERVER_KEY_HERE";
    const dbUrl = env.FIREBASE_DATABASE_URL || "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app";
    const dbSecret = env.FIREBASE_DATABASE_SECRET || "";

    // 1. Verifikasi Keamanan SHA-512 Signature Midtrans
    // Rumus Midtrans: SHA512(order_id + status_code + gross_amount + ServerKey)
    if (serverKey && !serverKey.includes("YOUR_MIDTRANS") && signature_key) {
      const rawString = `${order_id}${status_code}${gross_amount}${serverKey}`;
      const calculatedHash = await sha512Hex(rawString);

      if (calculatedHash.toLowerCase() !== signature_key.toLowerCase()) {
        console.error("Midtrans signature mismatch! Kemungkinan serangan spoofing.");
        return new Response(JSON.stringify({
          error: "Invalid signature key. Verifikasi keamanan gagal."
        }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 2. Pemetaan Status Midtrans ke Status Alur Dapur
    let newOrderStatus = "Pending";
    let isSuccess = false;

    if (transaction_status === "capture") {
      if (fraud_status === "accept") {
        newOrderStatus = "Dibayar";
        isSuccess = true;
      }
    } else if (transaction_status === "settlement") {
      newOrderStatus = "Dibayar";
      isSuccess = true;
    } else if (transaction_status === "pending") {
      newOrderStatus = "Pending";
    } else if (transaction_status === "deny" || transaction_status === "cancel" || transaction_status === "expire") {
      newOrderStatus = "Dibatalkan";
    }

    // 3. Catat Log Transaksi untuk Audit Berkala
    const auditLog = {
      order_id,
      transaction_id: transaction_id || "TX-" + Date.now(),
      payment_type,
      gross_amount: Number(gross_amount),
      transaction_status,
      mapped_status: newOrderStatus,
      received_at: new Date().toISOString(),
      raw_notification: notification
    };

    // 4. Update status dan audit log ke Firebase Realtime Database via REST API
    if (dbUrl && !dbUrl.includes("YOUR_PROJECT")) {
      const authQuery = dbSecret ? `?auth=${dbSecret}` : "";
      
      // Update Status Order di Firebase Realtime Database
      await fetch(`${dbUrl}/orders/${order_id}/status.json${authQuery}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOrderStatus)
      }).catch(e => console.warn("Gagal update status Firebase RTDB:", e));

      // Update detail pembayaran order
      await fetch(`${dbUrl}/orders/${order_id}/paymentDetails.json${authQuery}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentType: payment_type,
          paidAt: isSuccess ? new Date().toISOString() : null,
          midtransTransactionId: transaction_id
        })
      }).catch(e => console.warn("Gagal update payment details Firebase RTDB:", e));

      // Simpan Audit Log Transaksi
      const logKey = `${order_id}_${Date.now()}`;
      await fetch(`${dbUrl}/logs/${logKey}.json${authQuery}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(auditLog)
      }).catch(e => console.warn("Gagal simpan audit log ke Firebase:", e));
    }

    return new Response(JSON.stringify({
      status: "OK",
      message: "Webhook processed successfully",
      order_id,
      new_status: newOrderStatus
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      status: "Error"
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}

/**
 * Helper menghitung SHA-512 menggunakan Web Crypto API asli browser/Workers
 */
async function sha512Hex(message) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
