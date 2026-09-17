/**
 * functions/payment.js - Cloudflare Pages Function
 * Charge API Midtrans untuk QRIS DINAMIS (Nominal Pas Otomatis).
 * 
 * Spesifikasi:
 * - HANYA QRIS (nominal otomatis terisi).
 * - Tanpa kartu kredit.
 * - QR muncul LANGSUNG di halaman aplikasi (bukan redirect).
 * - Mode simulasi otomatis jika Server Key belum diisi.
 */

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Gunakan POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const payload = await request.json();
    const {
      order_id,
      gross_amount,
      customer_details = {},
      item_details = []
    } = payload;

    if (!order_id || !gross_amount) {
      return new Response(JSON.stringify({
        error: "Missing required fields: order_id and gross_amount are required."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const serverKey = env.MIDTRANS_SERVER_KEY || "YOUR_MIDTRANS_SERVER_KEY_HERE";
    const isProduction = env.MIDTRANS_IS_PRODUCTION === "true";

    // ============================================================
    // MODE SIMULASI (untuk testing template sebelum punya akun Midtrans)
    // ============================================================
    if (!serverKey || serverKey.includes("YOUR_MIDTRANS") || serverKey === "SKIP_DULU") {
      const mockQrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=MOCK-QRIS-" + order_id;
      return new Response(JSON.stringify({
        success: true,
        payment_type: "qris",
        qr_code_url: mockQrUrl,
        order_id: order_id,
        gross_amount: gross_amount,
        transaction_id: "MOCK-" + Date.now(),
        is_mock: true,
        note: "Mode simulasi aktif. Isi MIDTRANS_SERVER_KEY yang asli di Cloudflare Environment Variables untuk production."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // ============================================================
    // MODE PRODUCTION/SANDBOX - Charge API untuk QRIS Dinamis
    // ============================================================
    const chargeUrl = isProduction
      ? "https://api.midtrans.com/v2/charge"
      : "https://api.sandbox.midtrans.com/v2/charge";

    const authHeader = "Basic " + btoa(serverKey + ":");

    const chargeData = {
      payment_type: "qris",
      transaction_details: {
        order_id: order_id,
        gross_amount: Math.round(Number(gross_amount))
      },
      customer_details: {
        first_name: customer_details.name || "Pelanggan",
        email: customer_details.email || "customer@dapurkuliner.id",
        phone: customer_details.phone || "08123456789"
      },
      item_details: item_details.length > 0 ? item_details.map(item => ({
        id: item.id || "item-" + Math.random().toString(36).substring(7),
        price: Math.round(Number(item.price)),
        quantity: Number(item.quantity) || 1,
        name: (item.name || "Item Kuliner").substring(0, 50)
      })) : [{
        id: "ORDER-" + order_id,
        price: Math.round(Number(gross_amount)),
        quantity: 1,
        name: "Pesanan Kuliner / Catering"
      }],
      qris: {
        acquirer: "gopay" // Bisa diganti "shopeepay" jika ingin acquirer berbeda
      },
      // Custom expiry: QR berlaku 15 menit
      custom_expiry: {
        expiry_duration: 15,
        unit: "minute"
      }
    };

    const midtransRes = await fetch(chargeUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": authHeader
      },
      body: JSON.stringify(chargeData)
    });

    const midtransData = await midtransRes.json();

    if (!midtransRes.ok) {
      return new Response(JSON.stringify({
        error: midtransData.status_message || "Gagal membuat QRIS Dinamis",
        details: midtransData,
        success: false
      }), {
        status: midtransRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Ekstrak URL gambar QR dari actions
    let qrCodeUrl = null;
    let qrString = null;
    if (midtransData.actions && Array.isArray(midtransData.actions)) {
      const qrAction = midtransData.actions.find(a => a.name === "generate-qr-code");
      if (qrAction) qrCodeUrl = qrAction.url;
    }
    if (midtransData.qr_string) {
      qrString = midtransData.qr_string;
    }

    // Fallback: kalau URL QR tidak tersedia, generate sendiri dari qr_string
    if (!qrCodeUrl && qrString) {
      qrCodeUrl = "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=" + encodeURIComponent(qrString);
    }

    return new Response(JSON.stringify({
      success: true,
      payment_type: "qris",
      qr_code_url: qrCodeUrl,
      qr_string: qrString,
      order_id: midtransData.order_id,
      transaction_id: midtransData.transaction_id,
      gross_amount: midtransData.gross_amount,
      expiry_time: midtransData.expiry_time,
      transaction_status: midtransData.transaction_status,
      is_mock: false
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      error: err.message,
      success: false
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}
