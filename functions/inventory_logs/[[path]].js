/**
 * Cloudflare Pages Function: /inventory_logs/*
 * Proxy log perubahan stok inventory ke Firebase Realtime Database.
 * 
 * Endpoint:
 *   POST /inventory_logs/{itemId}/{logId}   → simpan log perubahan stok
 *   GET  /inventory_logs/{itemId}           → ambil semua log item
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;

  // Preflight CORS
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const dbUrl = env.FIREBASE_DATABASE_URL
    || 'https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app';

  // Path segments: contoh params.path = ["inv1", "log_1790369"]
  const pathSegments = Array.isArray(params.path) ? params.path : [];
  const firebasePath = ['inventory_logs', ...pathSegments].join('/');

  try {
    // ── POST: simpan log baru ──
    if (request.method === 'POST' || request.method === 'PUT') {
      const body = await request.json();
      const clean = JSON.parse(JSON.stringify(body));

      const targetUrl = `${dbUrl.replace(/\/$/, '')}/${firebasePath}.json`;
      const res = await fetch(targetUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(clean),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error('[inventory_logs] Firebase write gagal:', res.status, errText);
        return jsonResponse({ success: false, error: `Firebase ${res.status}` }, 502);
      }

      return jsonResponse({ success: true, path: firebasePath });
    }

    // ── GET: ambil log ──
    if (request.method === 'GET') {
      const targetUrl = `${dbUrl.replace(/\/$/, '')}/${firebasePath}.json`;
      const res = await fetch(targetUrl);
      if (!res.ok) {
        return jsonResponse({ success: false, error: `Firebase ${res.status}` }, res.status);
      }
      const data = await res.json();
      return jsonResponse({ success: true, data });
    }

    // ── DELETE: hapus log ──
    if (request.method === 'DELETE') {
      const targetUrl = `${dbUrl.replace(/\/$/, '')}/${firebasePath}.json`;
      const res = await fetch(targetUrl, { method: 'DELETE' });
      return jsonResponse({ success: res.ok });
    }

    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  } catch (err) {
    console.error('[inventory_logs] Exception:', err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
