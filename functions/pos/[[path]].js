/**
 * functions/pos/[[path]].js
 * Cloudflare Pages Function — Proxy request /pos/* ke Firebase Realtime Database
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

  // 10. Handle OPTIONS untuk CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Konfigurasi URL Firebase Realtime Database & API Key
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // Ekstrak path setelah /pos/
  const fullPath = url.pathname.replace(/^\/pos\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  try {
    if (parts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "Path /pos tidak boleh kosong" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 1. GET & POST /pos/summary/daily/{date} — Ringkasan penjualan harian (YYYY-MM-DD)
    if ((method === 'GET' || method === 'POST') && parts[0] === 'summary' && parts[1] === 'daily' && parts[2]) {
      const date = parts[2];
      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (body && Object.keys(body).length > 0) {
          await fetch(`${dbUrl}/pos/summary/daily/${encodeURIComponent(date)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        }
      }
      const res = await fetch(`${dbUrl}/pos/summary/daily/${encodeURIComponent(date)}.json${authParam}`);
      const data = await res.json() || {};
      return new Response(JSON.stringify({ 
        success: true, 
        date,
        totalSales: data.sales || 0, 
        totalTx: data.tx || 0, 
        breakdown: { 
          cash: data.cash || 0, 
          qris: data.qris || 0, 
          transfer: data.transfer || 0, 
          ewallet: data.ewallet || 0 
        } 
      }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 2. GET & POST /pos/summary/monthly/{month} — Ringkasan penjualan bulanan (YYYY-MM)
    if ((method === 'GET' || method === 'POST') && parts[0] === 'summary' && parts[1] === 'monthly' && parts[2]) {
      const month = parts[2];
      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        if (body && Object.keys(body).length > 0) {
          await fetch(`${dbUrl}/pos/summary/monthly/${encodeURIComponent(month)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
        }
      }
      const res = await fetch(`${dbUrl}/pos/summary/monthly/${encodeURIComponent(month)}.json${authParam}`);
      const data = await res.json() || {};
      return new Response(JSON.stringify({ 
        success: true, 
        month,
        totalSales: data.sales || 0, 
        totalTx: data.tx || 0, 
        breakdown: { 
          cash: data.cash || 0, 
          qris: data.qris || 0, 
          transfer: data.transfer || 0, 
          ewallet: data.ewallet || 0 
        } 
      }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 3. GET /pos/transactions/{date} — Daftar transaksi per tanggal (YYYY-MM-DD)
    if (method === 'GET' && parts[0] === 'transactions' && parts[1]) {
      const date = parts[1];
      const res = await fetch(`${dbUrl}/pos/transactions/${encodeURIComponent(date)}.json${authParam}`);
      const data = await res.json();
      const list = data && typeof data === 'object'
        ? (Array.isArray(data) ? data : Object.entries(data).map(([id, val]) => ({ id, ...(val || {}) })))
        : [];
      return new Response(JSON.stringify({ success: true, date, data: list }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 4. GET /pos/transactions — Daftar SEMUA transaksi (untuk laporan bulanan/analitik)
    if (method === 'GET' && parts[0] === 'transactions' && parts.length === 1) {
      const res = await fetch(`${dbUrl}/pos/transactions.json${authParam}`);
      const data = await res.json() || {};
      const allTx = [];
      if (typeof data === 'object') {
        Object.entries(data).forEach(([dateKey, dayData]) => {
          if (dayData && typeof dayData === 'object') {
            Object.entries(dayData).forEach(([txId, tx]) => {
              allTx.push({ id: txId, date: dateKey, ...(tx || {}) });
            });
          }
        });
      }
      return new Response(JSON.stringify({ success: true, data: allTx }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 5. GET /pos/shifts — Daftar semua riwayat shift kasir
    if (method === 'GET' && parts[0] === 'shifts' && parts.length === 1) {
      const res = await fetch(`${dbUrl}/pos/shifts.json${authParam}`);
      const data = await res.json() || {};
      const list = data && typeof data === 'object'
        ? Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }))
        : [];
      // Urutkan dari shift terbaru ke terlama
      list.sort((a, b) => (b.openTime || b.createdAt || 0) - (a.openTime || a.createdAt || 0));
      return new Response(JSON.stringify({ success: true, data: list }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 6. GET /pos/shifts/{shiftId} — Ambil detail satu shift spesifik
    if (method === 'GET' && parts[0] === 'shifts' && parts[1]) {
      const shiftId = parts[1];
      const res = await fetch(`${dbUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`);
      const data = await res.json();
      if (!data) {
        return new Response(JSON.stringify({ success: false, error: "Shift tidak ditemukan" }), {
          status: 404,
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ success: true, data: { id: shiftId, ...data } }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 7. POST /pos/shifts — Buat shift kasir baru
    if (method === 'POST' && parts[0] === 'shifts' && parts.length === 1) {
      const body = await request.json();
      const shiftId = body.id || ('S-' + Date.now());
      const shiftData = {
        ...body,
        id: shiftId,
        createdAt: body.createdAt || Date.now()
      };
      await fetch(`${dbUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shiftData)
      });
      return new Response(JSON.stringify({ success: true, id: shiftId, data: shiftData }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 8. PATCH /pos/shifts/{shiftId} — Update data shift (tutup shift, jeda/pause, update kas)
    if ((method === 'PATCH' || method === 'POST') && parts[0] === 'shifts' && parts[1]) {
      const shiftId = parts[1];
      const body = await request.json();
      await fetch(`${dbUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true, id: shiftId }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 9. POST /pos/last_reconcile/{username} — Update timestamp rekonsiliasi terakhir kasir
    if ((method === 'POST' || method === 'PUT') && parts[0] === 'last_reconcile' && parts[1]) {
      const username = parts[1];
      let timestamp = Date.now();
      try {
        const body = await request.json();
        timestamp = body.timestamp || body.lastReconcile || Date.now();
      } catch (_) {}
      await fetch(`${dbUrl}/pos/last_reconcile/${encodeURIComponent(username)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timestamp)
      });
      return new Response(JSON.stringify({ success: true, username, timestamp }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // Default route tidak ditemukan
    return new Response(JSON.stringify({ success: false, error: `Route /pos/${fullPath} tidak ditemukan` }), {
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
