const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  const parts = url.pathname.replace(/^\/orders\/?/, '').split('/').filter(Boolean);

  if (parts.length === 0) {
    const res = await fetch(`${dbUrl}/orders.json${authParam}`);
    const data = await res.json();
    const list = data && typeof data === 'object'
      ? Object.entries(data).map(([id, v]) => ({ id, orderId: id, ...(v || {}) }))
      : [];
    return jsonResponse({ success: true, data: list, orders: list });
  }

  const orderId = decodeURIComponent(parts[0]);

  if (method === 'GET') {
    const res = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`);
    const data = await res.json();
    if (!data) return jsonResponse({ success: false, error: 'Order tidak ditemukan' }, 404);
    return jsonResponse({ success: true, data, orderId });
  }

  if (method === 'PATCH' || method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const existingRes = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`);
    const existing = await existingRes.json();
    if (!existing) return jsonResponse({ success: false, error: 'Order tidak ditemukan' }, 404);
    const updated = { ...existing, ...body, updatedAt: Date.now() };
    await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    return jsonResponse({ success: true, orderId, data: updated });
  }

  if (method === 'DELETE') {
    await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`, { method: 'DELETE' });
    return jsonResponse({ success: true, orderId });
  }

  return jsonResponse({ success: false, error: `Method ${method} tidak didukung` }, 405);
}
