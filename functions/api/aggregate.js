/**
 * functions/aggregate.js
 * Update summary harian & bulanan setelah transaksi.
 */
export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }

  if (context.request.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed. Gunakan POST.' }),
      { status: 405, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { date, txId, amount, method } = await context.request.json();
    
    if (!date || !txId || !amount || !method) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: date, txId, amount, method' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const dbUrl = context.env.FIREBASE_DATABASE_URL;
    const apiKey = context.env.FIREBASE_API_KEY;
    const now = Date.now();
    const id = crypto.randomUUID();

    // Update daily summary
    const dailyUrl = `${dbUrl}/pos/summary/daily/${date}.json?auth=${apiKey}`;
    const dailyRes = await fetch(dailyUrl);
    const existing = await dailyRes.json() || { sales: 0, tx: 0 };
    
    const updated = {
      sales: (existing.sales || 0) + Number(amount),
      tx: (existing.tx || 0) + 1,
      [method]: (existing[method] || 0) + Number(amount),
      lastUpdate: now
    };

    await fetch(`${dailyUrl}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });

    return new Response(
      JSON.stringify({ success: true, date, updated, id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
