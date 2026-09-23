/**
 * functions/inventory/[[path]].js
 * Cloudflare Pages Function — Proxy request /inventory/* ke Firebase Realtime Database
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // Header CORS untuk preflight dan respons API
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // 7. Handle OPTIONS untuk CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Konfigurasi URL Firebase Realtime Database & API Key
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // Ekstrak path setelah /inventory/
  const fullPath = url.pathname.replace(/^\/inventory\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  try {
    // 1. GET /inventory — Ambil daftar semua item inventory
    if (method === 'GET' && parts.length === 0) {
      const res = await fetch(`${dbUrl}/inventory.json${authParam}`);
      const data = await res.json();
      const list = data && typeof data === 'object'
        ? Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }))
        : [];
      return new Response(JSON.stringify({ success: true, data: list }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 2. GET /inventory/recipes — Ambil daftar semua resep menu
    if (method === 'GET' && parts[0] === 'recipes' && parts.length === 1) {
      const res = await fetch(`${dbUrl}/recipes.json${authParam}`);
      const data = await res.json();
      return new Response(JSON.stringify({ success: true, data: data || {} }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 3. POST /inventory/recipes/{menuId} — Simpan/update resep menu
    if (method === 'POST' && parts[0] === 'recipes' && parts[1]) {
      const menuId = parts[1];
      const body = await request.json();
      await fetch(`${dbUrl}/recipes/${encodeURIComponent(menuId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 3.5 POST /inventory/deduct — Pengurangan Stok Bahan Baku Otomatis Berdasarkan Resep
    if (method === 'POST' && parts[0] === 'deduct') {
      const body = await request.json().catch(() => ({}));
      const orderId = body.orderId || body.id || ('ORD-' + Date.now());
      const kasir = body.kasir || 'kasir';
      const rawItems = Array.isArray(body.items) ? body.items : [];

      if (rawItems.length === 0) {
        return new Response(JSON.stringify({
          success: true,
          orderId,
          deducted: [],
          warnings: ['Tidak ada item yang diproses'],
          processedAt: Date.now()
        }), { headers: { ...cors, "Content-Type": "application/json" } });
      }

      // Idempotency check
      try {
        const checkRes = await fetch(`${dbUrl}/inventory_deducted/${encodeURIComponent(orderId)}.json${authParam}`);
        if (checkRes.ok) {
          const existing = await checkRes.json();
          if (existing) {
            return new Response(JSON.stringify({
              success: true,
              orderId,
              alreadyProcessed: true,
              message: `Order #${orderId} sudah pernah diproses pengurangan stok.`,
              processedAt: existing.timestamp || Date.now()
            }), { headers: { ...cors, "Content-Type": "application/json" } });
          }
        }
      } catch (e) {}

      // Bulk fetch recipes & inventory
      const [recipesRes, inventoryRes] = await Promise.all([
        fetch(`${dbUrl}/recipes.json${authParam}`),
        fetch(`${dbUrl}/inventory.json${authParam}`)
      ]);

      const recipesData = (recipesRes.ok ? await recipesRes.json() : {}) || {};
      const inventoryData = (inventoryRes.ok ? await inventoryRes.json() : {}) || {};

      const warnings = [];
      const usageByItemId = {};

      const convertUsage = (amt, ingU, invU) => {
        const uIng = String(ingU || '').toLowerCase().trim();
        const uInv = String(invU || '').toLowerCase().trim();
        if (uInv === 'kg' && uIng === 'gram') return amt / 1000;
        if (uInv === 'gram' && uIng === 'kg') return amt * 1000;
        if (uInv === 'liter' && (uIng === 'ml' || uIng === 'mili')) return amt / 1000;
        if ((uInv === 'ml' || uInv === 'mili') && uIng === 'liter') return amt * 1000;
        return amt;
      };

      for (const item of rawItems) {
        const menuId = item.id || item.menuId || item.code;
        const qty = Number(item.qty || 1) || 0;
        if (qty <= 0) continue;

        const recipe = recipesData[menuId];
        if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
          warnings.push(`Resep untuk menu "${item.name || menuId}" tidak ditemukan atau belum diisi`);
          continue;
        }

        for (const ing of recipe.ingredients) {
          const itemId = ing.itemId || ing.id;
          const ingAmount = Number(ing.amount) || 0;
          if (!itemId || ingAmount <= 0) continue;

          const invItem = inventoryData[itemId];
          if (!invItem) {
            warnings.push(`Bahan baku ID "${itemId}" tidak ditemukan dalam data inventori`);
            continue;
          }

          const converted = convertUsage(ingAmount * qty, ing.unit, invItem.unit);
          usageByItemId[itemId] = (usageByItemId[itemId] || 0) + converted;
        }
      }

      const deducted = [];
      const now = Date.now();
      const updatePromises = [];

      for (const [itemId, totalUsage] of Object.entries(usageByItemId)) {
        const invItem = inventoryData[itemId];
        if (!invItem) continue;

        const oldStock = Number(invItem.stock !== undefined ? invItem.stock : invItem.stok) || 0;
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
          unit: invItem.unit || 'unit'
        });

        updatePromises.push(
          fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: newStock, stok: newStock, lastUpdate: now })
          })
        );

        updatePromises.push(
          fetch(`${dbUrl}/inventory_logs/${encodeURIComponent(itemId)}/${encodeURIComponent(logId)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(logPayload)
          })
        );
      }

      updatePromises.push(
        fetch(`${dbUrl}/inventory_deducted/${encodeURIComponent(orderId)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, timestamp: now, kasir, itemsCount: rawItems.length, deductedCount: deducted.length })
        })
      );

      await Promise.all(updatePromises);

      return new Response(JSON.stringify({
        success: true,
        orderId,
        deducted,
        warnings,
        processedAt: now
      }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // 4. POST /inventory tanpa itemId di URL (menambahkan item baru dengan ID otomatis/dari body)
    if (method === 'POST' && parts.length === 0) {
      const body = await request.json();
      const itemId = body.id || ('inv_' + Date.now());
      await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true, id: itemId }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 4. POST /inventory/{itemId} — Tambah item baru
    // 5. PATCH /inventory/{itemId} — Update item (stok, harga, info)
    if ((method === 'POST' || method === 'PATCH' || method === 'PUT') && parts.length >= 1 && parts[0] !== 'recipes') {
      const itemId = parts[0];
      const body = await request.json();
      // Gunakan PATCH ke Firebase supaya tidak menimpa field lain yang tidak dikirim
      await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // 6. DELETE /inventory/{itemId} — Hapus item inventory
    if (method === 'DELETE' && parts.length >= 1 && parts[0] !== 'recipes') {
      const itemId = parts[0];
      await fetch(`${dbUrl}/inventory/${encodeURIComponent(itemId)}.json${authParam}`, {
        method: 'DELETE'
      });
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // Default route tidak ditemukan
    return new Response(JSON.stringify({ success: false, error: `Route /inventory/${fullPath} tidak ditemukan` }), {
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
