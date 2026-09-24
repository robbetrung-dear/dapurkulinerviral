const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== 'POST') return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers: CORS_HEADERS });

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  try {
    const body = await request.json().catch(() => ({}));
    const orderId = String(body.orderId || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (!orderId || items.length === 0) {
      return new Response(JSON.stringify({ success: false, error: 'orderId dan items wajib diisi' }), { status: 400, headers: CORS_HEADERS });
    }

    // Cek apakah order ini sudah pernah di-deduct (biar tidak double)
    const idemRes = await fetch(`${dbUrl}/inventory_deducted/${encodeURIComponent(orderId)}.json${authParam}`);
    const idemData = await idemRes.json();
    if (idemData) {
      return new Response(JSON.stringify({ success: true, alreadyProcessed: true, message: `Order ${orderId} sudah di-deduct` }), { status: 200, headers: CORS_HEADERS });
    }

    const deductions = [];

    for (const item of items) {
      const menuId = item.id || item.menuId;
      const qty = toNum(item.qty || item.quantity) || 1;
      if (!menuId) continue;

      // Ambil resep menu (bahan apa saja yang dibutuhkan)
      const rRes = await fetch(`${dbUrl}/recipes/${encodeURIComponent(menuId)}.json${authParam}`);
      const recipe = await rRes.json();
      if (!recipe || !recipe.ingredients) continue;

      const ingArr = Array.isArray(recipe.ingredients) ? recipe.ingredients : Object.values(recipe.ingredients);

      for (const ing of ingArr) {
        const invId = ing.itemId;
        const ingAmt = toNum(ing.amount);
        if (!invId || ingAmt <= 0) continue;

        const invRes = await fetch(`${dbUrl}/inventory/${encodeURIComponent(invId)}.json${authParam}`);
        const inv = await invRes.json();
        if (!inv) continue;

        // Konversi satuan (kg ↔ gram, liter ↔ ml)
        const itemUnit = (inv.unit || '').toLowerCase();
        const ingUnit = (ing.unit || '').toLowerCase();
        let usage = ingAmt * qty;

        if (itemUnit === 'kg' && ingUnit === 'gram') usage = usage / 1000;
        else if (itemUnit === 'gram' && ingUnit === 'kg') usage = usage * 1000;
        else if (itemUnit === 'liter' && ingUnit === 'ml') usage = usage / 1000;
        else if (itemUnit === 'ml' && ingUnit === 'liter') usage = usage * 1000;

        const before = toNum(inv.stock || inv.stok || 0);
        const after = Math.max(0, before - usage);

        // Update stok
        await fetch(`${dbUrl}/inventory/${encodeURIComponent(invId)}.json${authParam}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock: after, stok: after, lastUpdate: Date.now() })
        });

        // Catat log perubahan stok
        const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await fetch(`${dbUrl}/inventory_logs/${encodeURIComponent(invId)}/${logId}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            t: Date.now(),
            old: before,
            new: after,
            diff: after - before,
            by: body.kasir || 'kasir',
            reason: `Penjualan POS #${orderId}`,
            changeType: 'auto-pos-sale'
          })
        });

        deductions.push({ itemId: invId, name: inv.name || invId, before, after, used: usage, unit: inv.unit });
      }
    }

    // Tandai agar order ini tidak diproses 2 kali
    await fetch(`${dbUrl}/inventory_deducted/${encodeURIComponent(orderId)}.json${authParam}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ processedAt: Date.now(), deductions })
    });

    return new Response(JSON.stringify({ success: true, orderId, deducted: deductions, processedAt: Date.now() }), {
      status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error('[INV-DEDUCT] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500, headers: CORS_HEADERS });
  }
}
