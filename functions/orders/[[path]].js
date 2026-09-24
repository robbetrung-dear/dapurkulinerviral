/**
 * functions/orders/[[path]].js
 * Cloudflare Pages Function — Handle single order operations
 * 
 * GET    /orders/{orderId}  → Baca detail satu order
 * PATCH  /orders/{orderId}  → Update status/reconciled/postponed
 * DELETE /orders/{orderId}  → Hapus order
 * GET    /orders            → List semua order
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
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  const fullPath = url.pathname.replace(/^\/orders\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  // Path kosong → list semua order
  if (parts.length === 0) {
    try {
      const res = await fetch(`${dbUrl}/orders.json${authParam}`);
      const data = await res.json();
      const list = data && typeof data === 'object'
        ? Object.entries(data).map(([id, v]) => ({ id, orderId: id, ...(v || {}) }))
        : [];
      return jsonResponse({ success: true, data: list, orders: list });
    } catch (err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  const orderId = decodeURIComponent(parts[0]);

  try {
    // === GET /orders/{orderId} ===
    if (method === 'GET') {
      const res = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`);
      const data = await res.json();
      
      if (!data) {
        return jsonResponse({ success: false, error: `Order ${orderId} tidak ditemukan` }, 404);
      }
      
      return jsonResponse({ success: true, data, orderId });
    }

    // === PATCH /orders/{orderId} → Update fields ===
    if (method === 'PATCH' || method === 'PUT') {
      const body = await request.json().catch(() => ({}));
      
      const existingRes = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`);
      const existing = await existingRes.json();
      
      if (!existing) {
        return jsonResponse({ success: false, error: `Order ${orderId} tidak ditemukan` }, 404);
      }

      const updated = {
        ...existing,
        ...body,
        updatedAt: Date.now()
      };

      const patchRes = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });

      if (!patchRes.ok) {
        return jsonResponse({ success: false, error: `Firebase PATCH failed: ${patchRes.status}` }, patchRes.status);
      }

      console.log(`[ORDERS-PATCH] ${orderId}:`, Object.keys(body).join(', '));
      return jsonResponse({ success: true, orderId, data: updated });
    }

    // === DELETE /orders/{orderId} ===
    if (method === 'DELETE') {
      const delRes = await fetch(`${dbUrl}/orders/${encodeURIComponent(orderId)}.json${authParam}`, {
        method: 'DELETE'
      });
      
      if (!delRes.ok) {
        return jsonResponse({ success: false, error: `Firebase DELETE failed: ${delRes.status}` }, delRes.status);
      }
      
      return jsonResponse({ success: true, orderId, message: 'Order dihapus' });
    }

    return jsonResponse({ success: false, error: `Method ${method} tidak didukung untuk /orders/${orderId}` }, 405);

  } catch (err) {
    console.error('[ORDERS] Exception:', err);
    return jsonResponse({ success: false, error: err.message || 'Internal server error' }, 500);
  }
}
