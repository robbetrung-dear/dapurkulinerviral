/**
 * functions/categories/[[path]].js
 * Cloudflare Pages Function — Proxy request /categories/* dan /categories ke Firebase Realtime Database
 */

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  try {
    if (method === 'GET') {
      const res = await fetch(`${dbUrl}/menu_categories.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, data: data || [] }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    if (method === 'POST' || method === 'PUT') {
      const body = await request.json();
      await fetch(`${dbUrl}/menu_categories.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true, message: "Kategori menu berhasil disimpan", data: body }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: false, error: "Metode tidak didukung" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message || "Terjadi kesalahan server" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
