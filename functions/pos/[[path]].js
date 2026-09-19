/**
 * functions/pos/[[path]].js
 * Cloudflare Pages Function — Handle semua request /pos/*
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  const fullPath = url.pathname.replace(/^\/pos\/?/, '');
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
    if (parts.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "Path kosong" }), {
        status: 400, headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /pos/summary/daily/{date}
    if (method === 'GET' && parts[0] === 'summary' && parts[1] === 'daily' && parts[2]) {
      const date = parts[2];
      const res = await fetch(`${dbUrl}/pos/summary/daily/${encodeURIComponent(date)}.json${authParam}`);
      const data = await res.json() || {};
      return new Response(JSON.stringify({ 
        success: true, 
        totalSales: data.sales || 0, 
        totalTx: data.tx || 0, 
        breakdown: { cash: data.cash || 0, qris: data.qris || 0, transfer: data.transfer || 0, ewallet: data.ewallet || 0 } 
      }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /pos/transactions/{date}
    if (method === 'GET' && parts[0] === 'transactions' && parts[1]) {
      const date = parts[1];
      const res = await fetch(`${dbUrl}/pos/transactions/${encodeURIComponent(date)}.json${authParam}`);
      const data = await res.json();
      const list = data && typeof data === 'object' ? Object.values(data) : [];
      return new Response(JSON.stringify({ success: true, data: list }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /pos/transactions (all) — untuk laporan bulanan
    if (method === 'GET' && parts[0] === 'transactions' && parts.length === 1) {
      const res = await fetch(`${dbUrl}/pos/transactions.json${authParam}`);
      const data = await res.json() || {};
      const allTx = [];
      Object.values(data).forEach(dayData => {
        if (dayData && typeof dayData === 'object') {
          Object.values(dayData).forEach(tx => allTx.push(tx));
        }
      });
      return new Response(JSON.stringify({ success: true, data: allTx }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /pos/shifts — list shifts
    if (method === 'GET' && parts[0] === 'shifts' && parts.length === 1) {
      const res = await fetch(`${dbUrl}/pos/shifts.json${authParam}`);
      const data = await res.json() || {};
      const list = Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }));
      return new Response(JSON.stringify({ success: true, data: list }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // GET /pos/shifts/{shiftId}
    if (method === 'GET' && parts[0] === 'shifts' && parts[1]) {
      const shiftId = parts[1];
      const res = await fetch(`${dbUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // POST /pos/shifts — buat shift baru
    if (method === 'POST' && parts[0] === 'shifts' && parts.length === 1) {
      const body = await request.json();
      const shiftId = body.id || ('S-' + Date.now());
      await fetch(`${dbUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true, id: shiftId }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // PATCH /pos/shifts/{shiftId} — update shift (close, pause, dll)
    if ((method === 'PATCH' || method === 'POST') && parts[0] === 'shifts' && parts[1]) {
      const shiftId = parts[1];
      const body = await request.json();
      await fetch(`${dbUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // POST /pos/last_reconcile/{username}
    if ((method === 'POST' || method === 'PUT') && parts[0] === 'last_reconcile' && parts[1]) {
      const username = parts[1];
      const body = await request.json();
      const timestamp = body.timestamp || Date.now();
      await fetch(`${dbUrl}/pos/last_reconcile/${encodeURIComponent(username)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(timestamp)
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: false, error: "Route tidak ditemukan: /pos/" + fullPath }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
