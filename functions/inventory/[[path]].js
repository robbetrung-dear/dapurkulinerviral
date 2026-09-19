/**
 * functions/inventory/[[path]].js
 * Cloudflare Pages Function — Handle semua request /inventory/*
 * Proxy ke Firebase Realtime Database
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // Ambil path setelah /inventory/
  const fullPath = url.pathname.replace(/^\/inventory\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  try {
    // GET /inventory — list semua inventory
    if (method === 'GET' && parts.length === 0) {
      const res = await fetch(`${dbUrl}/inventory.json${authParam}`);
      const data = await res.json();
      const list = data && typeof data === 'object'
        ? Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }))
        : [];
      return new Response(JSON.stringify({ success: true, data: list }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /inventory/recipes — list semua resep menu
    if (method === 'GET' && parts[0] === 'recipes' && parts.length === 1) {
      const res = await fetch(`${dbUrl}/recipes.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, data: data || {} }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // POST /inventory/recipes/{menuId} — simpan resep menu
    if (method === 'POST' && parts[0] === 'recipes' && parts[1]) {
      const menuId = parts[1];
      const body = await request.json();
      await fetch(`${dbUrl}/recipes/${encodeURIComponent(menuId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // POST /inventory/{itemId} — tambah item
    // PATCH /inventory/{itemId} — update item
    // DELETE /inventory/{itemId} — hapus item
    if (parts.length >= 1 && parts[0] !== 'recipes') {
      const itemId = parts[0];

      if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
        const body = await request.json();
        await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      if (method === 'DELETE') {
        await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
          method: 'DELETE'
        });
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    }

    return new Response(JSON.stringify({ success: false, error: "Route tidak ditemukan" }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
