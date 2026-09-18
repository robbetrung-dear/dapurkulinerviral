/**
 * functions/pending-orders.js
 * Cloudflare Pages Function: Ambil daftar order yang belum di-reconcile.
 * 
 * ENDPOINT: GET /pending-orders
 * RESPONSE: { success: true, orders: [...] }
 */

export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed. Gunakan GET." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const dbUrl = (env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
    const apiKey = env.FIREBASE_API_KEY || "";

    if (!dbUrl) {
      return new Response(
        JSON.stringify({ success: false, error: "FIREBASE_DATABASE_URL belum diset." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
    const ordersUrl = `${dbUrl}/orders.json${authParam}`;
    
    const res = await fetch(ordersUrl, { method: "GET" });
    if (!res.ok) {
      throw new Error(`Firebase fetch failed: ${res.status}`);
    }

    const ordersRaw = await res.json();
    const orders = [];

    if (ordersRaw && typeof ordersRaw === "object") {
      for (const [key, o] of Object.entries(ordersRaw)) {
        if (!o || typeof o !== "object") continue;
        if (o.reconciled === true || o.archived === true) continue;

        // Skip kalau tidak ada total
        const total = Number(o.totalAmount || o.total || 0);
        if (total <= 0) continue;

        orders.push({
          orderId: o.orderId || o.id || key,
          pemesan: o.customer?.name || o.customerName || "Pelanggan",
          phone: o.customer?.phone || o.customerPhone || "-",
          total: total,
          subtotal: Number(o.subtotal) || total,
          status: o.status || "Pending",
          paymentMethod: o.paymentMethod || o.pm || "qris",
          midtransId: o.midtransId || o.transaction_id || "",
          createdAt: o.createdAt || o.t || new Date().toISOString(),
          items: o.items || [],
          courier: o.courier || null,
          reconciled: o.reconciled || false
        });
      }
    }

    // Sort terbaru dulu
    orders.sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0;
      const tb = new Date(b.createdAt).getTime() || 0;
      return tb - ta;
    });

    return new Response(
      JSON.stringify({ success: true, count: orders.length, orders }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
