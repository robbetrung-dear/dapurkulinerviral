/**
 * functions/recipes/[[path]].js
 * Cloudflare Pages Function — Proxy request /recipes/* ke Firebase Realtime Database
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  const fullPath = url.pathname.replace(/^\/recipes\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  try {
    // 1. GET /recipes — Ambil semua resep menu
    if (method === 'GET' && parts.length === 0) {
      const res = await fetch(`${dbUrl}/recipes.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, data: data || {} }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 2. GET /recipes/{menuId} — Ambil resep menu tertentu
    if (method === 'GET' && parts.length === 1) {
      const menuId = parts[0];
      const res = await fetch(`${dbUrl}/recipes/${encodeURIComponent(menuId)}.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, menuId, data: data || null }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 3. POST / PUT /recipes/{menuId} — Simpan resep menu
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && parts.length === 1) {
      const menuId = parts[0];
      const body = await request.json();
      await fetch(`${dbUrl}/recipes/${encodeURIComponent(menuId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true, menuId, data: body }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 4. DELETE /recipes/{menuId} — Hapus resep
    if (method === 'DELETE' && parts.length === 1) {
      const menuId = parts[0];
      await fetch(`${dbUrl}/recipes/${encodeURIComponent(menuId)}.json${authParam}`, {
        method: 'DELETE'
      });
      return new Response(JSON.stringify({ success: true, menuId, deleted: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: false, error: `Route /recipes/${fullPath} tidak ditemukan` }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message || "Terjadi kesalahan server" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
