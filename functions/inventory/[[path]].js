/**
 * functions/inventory/[[path]].js
 * Cloudflare Pages Function — Proxy request /inventory/* ke Firebase Realtime Database
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // Header CORS untuk preflight dan respons API
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // 7. Handle OPTIONS untuk CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Konfigurasi URL Firebase Realtime Database & API Key
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // Ekstrak path setelah /inventory/
  const fullPath = url.pathname.replace(/^\/inventory\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  try {
    // 1. GET /inventory — Ambil daftar semua item inventory
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

    // 2. GET /inventory/recipes — Ambil daftar semua resep menu
    if (method === 'GET' && parts[0] === 'recipes' && parts.length === 1) {
      const res = await fetch(`${dbUrl}/recipes.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, data: data || {} }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 3. POST /inventory/recipes/{menuId} — Simpan/update resep menu
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

    // 4. POST /inventory tanpa itemId di URL (menambahkan item baru dengan ID otomatis/dari body)
    if (method === 'POST' && parts.length === 0) {
      const body = await request.json();
      const itemId = body.id || ('inv_' + Date.now());
      await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true, id: itemId }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 4. POST /inventory/{itemId} — Tambah item baru
    // 5. PATCH /inventory/{itemId} — Update item (stok, harga, info)
    if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && parts.length >= 1 && parts[0] !== 'recipes') {
      const itemId = parts[0];
      const body = await request.json();
      // Gunakan PATCH ke Firebase supaya tidak menimpa field lain yang tidak dikirim
      await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 6. DELETE /inventory/{itemId} — Hapus item inventory
    if (method === 'DELETE' && parts.length >= 1 && parts[0] !== 'recipes') {
      const itemId = parts[0];
      await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
        method: 'DELETE'
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // Default route tidak ditemukan
    return new Response(JSON.stringify({ success: false, error: `Route /inventory/${fullPath} tidak ditemukan` }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" }
    });

  } catch (err) {
    // Tangani semua galat dan pastikan response selalu berupa JSON
    return new Response(JSON.stringify({ success: false, error: err.message || "Terjadi kesalahan server" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
