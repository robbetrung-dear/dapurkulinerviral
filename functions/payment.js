/**
 * functions/payment.js - Cloudflare Pages Function
 * Proxy API untuk Midtrans Snap Payment Gateway.
 * 
 * Spesifikasi Khusus:
 * - TANPA KARTU KREDIT (Credit card dinonaktifkan di enabled_payments).
 * - Metode aktif: QRIS, Transfer Bank (BCA, Mandiri, BNI, BRI, Permata), E-Wallet (GoPay, ShopeePay).
 * - Menjaga Server Key Midtrans tetap privat (tidak bocor ke browser).
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

    // Mode Simulasi / Demo jika Midtrans belum diisi oleh pembeli template
    if (!serverKey || serverKey.includes("YOUR_MIDTRANS")) {
      const mockToken = "MOCK_SNAP_" + order_id + "_" + Date.now();
      return new Response(JSON.stringify({
        success: true,
        token: mockToken,
        redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/${mockToken}`,
        is_mock: true,
        note: "Mode simulasi aktif karena MIDTRANS_SERVER_KEY masih placeholder di Cloudflare. Checkout demo dapat dites langsung."
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Midtrans Snap Endpoint URL
    const snapUrl = isProduction
      ? "https://app.midtrans.com/snap/v1/transactions"
      : "https://app.sandbox.midtrans.com/snap/v1/transactions";

    // Base64 encode server key untuk Basic Auth Midtrans
    const authHeader = "Basic " + btoa(serverKey + ":");

    // Parameter Transaksi Midtrans Snap
    const transactionParams = {
      transaction_details: {
        order_id: order_id,
        gross_amount: Math.round(Number(gross_amount))
      },
      customer_details: {
        first_name: customer_details.name || "Pelanggan",
        email: customer_details.email || "customer@dapurkuliner.id",
        phone: customer_details.phone || "08123456789",
        billing_address: {
          first_name: customer_details.name || "Pelanggan",
          address: customer_details.address || "Alamat Pengiriman",
          phone: customer_details.phone || "08123456789"
        },
        shipping_address: {
          first_name: customer_details.name || "Pelanggan",
          address: customer_details.address || "Alamat Pengiriman",
          phone: customer_details.phone || "08123456789"
        }
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
      // PENTING: NONAKTIFKAN KARTU KREDIT (Sesuai spesifikasi prompt)
      // Hanya izinkan QRIS, Transfer Bank (BCA, Mandiri, BNI, BRI, Permata), E-Wallet
      enabled_payments: [
        "gopay",
        "shopeepay",
        "qris",
        "bca_va",
        "bni_va",
        "bri_va",
        "echannel", // Mandiri Bill
        "permata_va",
        "other_va"
      ],
      callbacks: {
        finish: (env.APP_URL || "https://pages.dev") + "/?order_id=" + order_id + "&status=success"
      }
    };

    const midtransRes = await fetch(snapUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": authHeader
      },
      body: JSON.stringify(transactionParams)
    });

    const midtransData = await midtransRes.json();

    if (!midtransRes.ok) {
      return new Response(JSON.stringify({
        error: midtransData.error_messages || "Gagal membuat transaksi Midtrans Snap",
        details: midtransData
      }), {
        status: midtransRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: true,
      token: midtransData.token,
      redirect_url: midtransData.redirect_url,
      order_id: order_id,
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
