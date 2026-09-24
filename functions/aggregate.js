/**
 * functions/aggregate.js
 * Cloudflare Pages Function & Server Handler — Ringkasan Penjualan Harian & Bulanan
 * Route: POST /aggregate, GET /aggregate
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export async function handleAggregateRequest(body = {}, env = process.env, clientIp = '127.0.0.1') {
  try {
    const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
    const apiKey = env.FIREBASE_API_KEY || "";
    const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

    const now = new Date();
    const dateStr = body.date || body.tgl || now.toISOString().slice(0, 10);
    const monthStr = dateStr.slice(0, 7);
    const tx = body.tx || body.transaction || null;

    let totalSales = 0;
    let totalTx = 0;
    const breakdown = { cash: 0, qris: 0, transfer: 0, ewallet: 0 };

    // 1. Fetch transactions for this date from Firebase
    try {
      const txRes = await fetch(`${dbUrl}/pos/transactions/${encodeURIComponent(dateStr)}.json${authParam}`);
      if (txRes.ok) {
        const txData = await txRes.json();
        if (txData && typeof txData === 'object') {
          const list = Array.isArray(txData) ? txData : Object.values(txData);
          for (const item of list) {
            if (!item) continue;
            const amt = toNum(item.total ?? item.tot ?? item.totalAmount ?? item.amount ?? 0);
            totalSales += amt;
            totalTx += 1;
            const pm = String(item.pm || item.paymentMethod || 'cash').toLowerCase();
            if (pm.includes('tunai') || pm.includes('cash')) {
              breakdown.cash += amt;
            } else if (pm.includes('qris')) {
              breakdown.qris += amt;
            } else if (pm.includes('transfer') || pm.includes('bca') || pm.includes('mandiri') || pm.includes('bank')) {
              breakdown.transfer += amt;
            } else if (pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo') || pm.includes('dana')) {
              breakdown.ewallet += amt;
            } else {
              breakdown.cash += amt;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[AGGREGATE] Fetch transactions warning:', e);
    }

    // If transactions were empty and a single tx was provided
    if (totalTx === 0 && tx) {
      const amt = toNum(tx.total ?? tx.tot ?? tx.totalAmount ?? 0);
      totalSales = amt;
      totalTx = 1;
      const pm = String(tx.pm || tx.paymentMethod || 'cash').toLowerCase();
      if (pm.includes('tunai') || pm.includes('cash')) breakdown.cash = amt;
      else if (pm.includes('qris')) breakdown.qris = amt;
      else if (pm.includes('transfer') || pm.includes('bank')) breakdown.transfer = amt;
      else breakdown.ewallet = amt;
    }

    const dailySummary = {
      date: dateStr,
      sales: totalSales,
      tx: totalTx,
      cash: breakdown.cash,
      qris: breakdown.qris,
      transfer: breakdown.transfer,
      ewallet: breakdown.ewallet,
      updatedAt: Date.now()
    };

    // 2. Save Daily Summary to Firebase
    try {
      await fetch(`${dbUrl}/pos/summary/daily/${encodeURIComponent(dateStr)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dailySummary)
      });
    } catch (e) {
      console.warn('[AGGREGATE] Save daily summary error:', e);
    }

    return {
      status: 200,
      data: {
        success: true,
        message: `Ringkasan penjualan tanggal ${dateStr} berhasil diperbarui`,
        date: dateStr,
        summary: dailySummary
      }
    };
  } catch (err) {
    console.error('[AGGREGATE] Error:', err);
    return {
      status: 500,
      data: { success: false, error: err.message }
    };
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method !== 'POST' && method !== 'GET') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
  const clientIp = request.headers.get('cf-connecting-ip') || '127.0.0.1';
  const result = await handleAggregateRequest(body, env, clientIp);
  return jsonResponse(result.data, result.status);
}
