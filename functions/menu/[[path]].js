/**
 * functions/menu/[[path]].js
 * Cloudflare Pages Function — Proxy request /menu/* dan /menu ke Firebase Realtime Database
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // Header CORS untuk preflight dan respons API
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Konfigurasi URL Firebase Realtime Database & API Key
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // Ekstrak path setelah /menu/
  const fullPath = url.pathname.replace(/^\/menu\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  try {
    // 1. GET /menu/categories — Ambil daftar kategori menu
    if (method === 'GET' && parts[0] === 'categories') {
      const res = await fetch(`${dbUrl}/menu_categories.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, data: data || [] }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 2. POST /menu/categories — Simpan seluruh kategori menu
    if ((method === 'POST' || method === 'PUT') && parts[0] === 'categories') {
      const body = await request.json();
      await fetch(`${dbUrl}/menu_categories.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true, message: "Kategori menu berhasil disimpan" }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 3. GET /menu — Ambil semua menu items
    if (method === 'GET' && parts.length === 0) {
      const res = await fetch(`${dbUrl}/menu.json${authParam}`);
      const data = await res.json();
      let list = [];
      if (data && typeof data === 'object') {
        list = Array.isArray(data) ? data : Object.entries(data).map(([id, val]) => ({ id, ...(val || {}) }));
      }
      return new Response(JSON.stringify({ success: true, data: list }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 4. GET /menu/{menuId} — Ambil detail satu menu spesifik
    if (method === 'GET' && parts.length === 1) {
      const menuId = parts[0];
      const res = await fetch(`${dbUrl}/menu/${encodeURIComponent(menuId)}.json${authParam}`);
      const data = await res.json();
      if (!data) {
        return new Response(JSON.stringify({ success: false, error: "Menu tidak ditemukan" }), {
          status: 404,
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ success: true, data: { id: menuId, ...data } }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 5. POST / PUT /menu/{menuId} — Simpan / perbarui menu item
    if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && parts.length === 1) {
      const menuId = parts[0];
      const body = await request.json();
      const menuPayload = {
        ...body,
        id: menuId,
        updatedAt: Date.now()
      };
      await fetch(`${dbUrl}/menu/${encodeURIComponent(menuId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(menuPayload)
      });
      return new Response(JSON.stringify({ success: true, id: menuId, data: menuPayload }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 6. POST /menu — Bulk save atau tambah menu baru dengan auto-id
    if (method === 'POST' && parts.length === 0) {
      const body = await request.json();
      if (Array.isArray(body)) {
        await fetch(`${dbUrl}/menu.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return new Response(JSON.stringify({ success: true, count: body.length }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      } else {
        const menuId = body.id || ('m_' + Date.now());
        const menuPayload = { ...body, id: menuId, createdAt: Date.now() };
        await fetch(`${dbUrl}/menu/${encodeURIComponent(menuId)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(menuPayload)
        });
        return new Response(JSON.stringify({ success: true, id: menuId, data: menuPayload }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
    }

    // 7. DELETE /menu/{menuId} — Hapus menu
    if (method === 'DELETE' && parts.length === 1) {
      const menuId = parts[0];
      await fetch(`${dbUrl}/menu/${encodeURIComponent(menuId)}.json${authParam}`, {
        method: 'DELETE'
      });
      return new Response(JSON.stringify({ success: true, id: menuId, deleted: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: false, error: `Route /menu/${fullPath} tidak ditemukan` }), {
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
