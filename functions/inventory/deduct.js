/**
 * functions/inventory/deduct.js
 * Cloudflare Pages Function — Pengurangan Stok Bahan Baku Otomatis Berdasarkan Resep (BOM)
 * 
 * Route: POST /inventory/deduct
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

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Konversi unit takaran ingredient ke unit stock inventory
 */
function convertUnitUsage(amount, ingUnit, invUnit) {
  const uIng = String(ingUnit || '').toLowerCase().trim();
  const uInv = String(invUnit || '').toLowerCase().trim();

  // kg <-> gram
  if (uInv === 'kg' && uIng === 'gram') return amount / 1000;
  if (uInv === 'gram' && uIng === 'kg') return amount * 1000;

  // liter <-> ml
  if (uInv === 'liter' && (uIng === 'ml' || uIng === 'mili')) return amount / 1000;
  if ((uInv === 'ml' || uInv === 'mili') && uIng === 'liter') return amount * 1000;

  // Default: rasio 1:1
  return amount;
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed' }, 405);
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  try {
    const body = await request.json().catch(() => ({}));
    const orderId = body.orderId || body.id || ('ORD-' + Date.now());
    const kasir = body.kasir || 'kasir';
    const rawItems = Array.isArray(body.items) ? body.items : [];

    if (rawItems.length === 0) {
      return jsonResponse({
        success: true,
        orderId,
        deducted: [],
        warnings: ['Tidak ada item yang diproses'],
        processedAt: Date.now()
      });
    }

    // 1. Idempotency Check: Cek apakah orderId sudah pernah di-deduct
    try {
      const checkRes = await fetch(`${dbUrl}/inventory_deducted/${encodeURIComponent(orderId)}.json${authParam}`);
      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (existing) {
          return jsonResponse({
            success: true,
            orderId,
            alreadyProcessed: true,
            totalHpp: existing.totalHpp || 0,
            message: `Order #${orderId} sudah pernah diproses pengurangan stok.`,
            processedAt: existing.timestamp || Date.now()
          });
        }
      }
    } catch (e) {
      console.warn('[DEDUCT] Idempotency check warning:', e);
    }

    // 2. Fetch Bulk Data: Resep dan Inventory
    const [recipesRes, inventoryRes] = await Promise.all([
      fetch(`${dbUrl}/recipes.json${authParam}`),
      fetch(`${dbUrl}/inventory.json${authParam}`)
    ]);

    const recipesData = (recipesRes.ok ? await recipesRes.json() : {}) || {};
    const inventoryData = (inventoryRes.ok ? await inventoryRes.json() : {}) || {};

    const warnings = [];
    const usageByItemId = {}; // { [itemId]: totalUsage }

    // 3. Kalkulasi Pengurangan Stok per Bahan Baku
    for (const item of rawItems) {
      const menuId = item.id || item.menuId || item.code;
      const qty = toNum(item.qty || item.quantity || 1);

      if (qty <= 0) continue;

      const recipe = recipesData[menuId];
      if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
        warnings.push(`Resep untuk menu "${item.name || menuId}" tidak ditemukan atau belum diisi`);
        continue;
      }

      for (const ing of recipe.ingredients) {
        const itemId = ing.itemId || ing.id;
        const ingAmount = toNum(ing.amount);
        const ingUnit = ing.unit || 'gram';

        if (!itemId || ingAmount <= 0) continue;

        const invItem = inventoryData[itemId];
        if (!invItem) {
          warnings.push(`Bahan baku ID "${itemId}" tidak ditemukan dalam data inventori`);
          continue;
        }

        const convertedUsage = convertUnitUsage(ingAmount * qty, ingUnit, invItem.unit);
        usageByItemId[itemId] = (usageByItemId[itemId] || 0) + convertedUsage;
      }
    }

    const deducted = [];
    const now = Date.now();
    const updatePromises = [];
    let totalHpp = 0;

    // 4. Update Stok & Catat Log Inventory
    for (const [itemId, totalUsage] of Object.entries(usageByItemId)) {
      const invItem = inventoryData[itemId];
      if (!invItem) continue;

      const unitCost = toNum(invItem.purchasePrice !== undefined ? invItem.purchasePrice : (invItem.hargaBeli !== undefined ? invItem.hargaBeli : (invItem.price || 0)));
      const itemHpp = totalUsage * unitCost;
      totalHpp += itemHpp;

      const oldStock = toNum(invItem.stock !== undefined ? invItem.stock : invItem.stok);
      let newStock = oldStock - totalUsage;

      if (newStock < 0) {
        warnings.push(`Stok "${invItem.name || itemId}" tidak mencukupi (sisa: ${oldStock}, dibutuhkan: ${totalUsage}). Stok diset ke 0.`);
        newStock = 0;
      }

      const logId = 'log_' + now + '_' + Math.random().toString(36).substring(2, 6);
      const logPayload = {
        t: now,
        old: oldStock,
        new: newStock,
        diff: -(Math.min(oldStock, totalUsage)),
        by: `${kasir} (POS #${orderId})`,
        reason: 'Penjualan POS',
        changeType: 'auto-pos-sale'
      };

      deducted.push({
        itemId,
        name: invItem.name || itemId,
        before: oldStock,
        after: newStock,
        used: totalUsage,
        unit: invItem.unit || 'unit',
        unitCost,
        itemHpp: Math.round(itemHpp)
      });

      // Update item stok
      updatePromises.push(
        fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stock: newStock,
            stok: newStock,
            lastUpdate: now
          })
        })
      );

      // Simpan log pengurangan stok
      updatePromises.push(
        fetch(`${dbUrl}/inventory_logs/${encodeURIComponent(itemId)}/${encodeURIComponent(logId)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(logPayload)
        })
      );
    }

    // 5. Simpan record Idempotency
    updatePromises.push(
      fetch(`${dbUrl}/inventory_deducted/${encodeURIComponent(orderId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          timestamp: now,
          kasir,
          totalHpp: Math.round(totalHpp),
          itemsCount: rawItems.length,
          deductedCount: deducted.length
        })
      })
    );

    await Promise.all(updatePromises);

    return jsonResponse({
      success: true,
      orderId,
      deducted,
      totalHpp: Math.round(totalHpp),
      warnings,
      processedAt: now
    });
  } catch (err) {
    console.error('[DEDUCT] Server error:', err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
