/**
 * functions/orders/[[path]].js
 * Cloudflare Pages Function — CRUD Orders dengan Firebase Realtime Database
 * Route: /orders/*
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  const fullPath = url.pathname.replace(/^\/orders\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);
  const orderId = parts[0] || '';

  try {
    // 1. GET /orders
    if (method === 'GET' && !orderId) {
      const res = await fetch(`${dbUrl}/orders.json${authParam}`);
      if (!res.ok) {
        return jsonResponse({ success: false, error: 'Gagal memuat orders dari Firebase' }, res.status);
      }
      const data = await res.json() || {};
      const list = Object.entries(data).map(([id, val]) => ({
        id,
        orderId: id,
        ...(val || {})
      }));
      return jsonResponse({ success: true, data: list, count: list.length });
    }

    // 2. GET /orders/:id
    if (method === 'GET' && orderId) {
      const res = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`);
      if (!res.ok) {
        return jsonResponse({ success: false, error: 'Order tidak ditemukan' }, res.status);
      }
      const data = await res.json();
      if (!data) {
        return jsonResponse({ success: false, error: 'Order tidak ditemukan' }, 404);
      }
      return jsonResponse({ success: true, data: { id: orderId, orderId, ...data } });
    }

    // 3. PATCH /orders/:id
    if (method === 'PATCH' && orderId) {
      const body = await request.json().catch(() => ({}));
      const patchRes = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!patchRes.ok) {
        return jsonResponse({ success: false, error: 'Gagal update order' }, patchRes.status);
      }
      const updated = await patchRes.json();
      return jsonResponse({ success: true, message: `Order ${orderId} berhasil di-update`, data: updated });
    }

    // 4. PUT /orders/:id
    if (method === 'PUT' && orderId) {
      const body = await request.json().catch(() => ({}));
      const putRes = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const updated = await putRes.json();
      return jsonResponse({ success: true, message: `Order ${orderId} berhasil disimpan`, data: updated });
    }

    // 5. POST /orders
    if (method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const newId = body.orderId || body.id || ('ORD-' + Date.now());
      const postRes = await fetch(`${dbUrl}/orders/${encodeURIComponent(newId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, orderId: newId, createdAt: body.createdAt || Date.now() })
      });
      const saved = await postRes.json();
      return jsonResponse({ success: true, message: `Order ${newId} berhasil dibuat`, orderId: newId, data: saved }, 201);
    }

    return jsonResponse({ success: false, error: `Method ${method} tidak didukung pada /orders` }, 405);
  } catch (err) {
    console.error('[ORDERS-API] Error:', err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
