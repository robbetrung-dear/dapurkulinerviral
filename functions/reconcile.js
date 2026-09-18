/**
 * ============================================================================
 * Cloudflare Pages Function & Node.js API: /functions/reconcile.js
 * ============================================================================
 * FUNGSI: Bulk Reconcile transaksi pesanan online/QRIS setelah di-approve kasir.
 *         Mengonversi order menjadi transaksi POS resmi (/pos/transactions),
 *         mencatat jurnal akuntansi (double-entry), memotong stok inventory,
 *         mengupdate agregasi harian/bulanan, menandai status order (reconciled),
 *         dan mencatat audit trail log ke /pos/reconcile_logs.
 *
 * ENDPOINT: POST /reconcile (dan /api/reconcile)
 *
 * BODY REQUEST:
 * {
 *   "orderIds": ["ORD-123", "ORD-456"],        // Array ID order yang di-approve
 *   "kasirUsername": "kasir_utama",            // Username kasir penanggung jawab
 *   "shiftId": "SHIFT-20260918-01",            // ID shift aktif
 *   "action": "record"                         // "record" | "archive"
 * }
 *
 * RESPONSE (STATUS 200):
 * {
 *   "success": true,
 *   "action": "record",
 *   "totalProcessed": 2,
 *   "successCount": 2,
 *   "failedCount": 0,
 *   "skippedCount": 0,
 *   "logId": "REC-LOG-20260918-1726000000",
 *   "results": [
 *     { "orderId": "ORD-123", "status": "success", "txId": "T1789718400001", "error": null },
 *     { "orderId": "ORD-456", "status": "skipped", "txId": null, "error": "Already reconciled" }
 *   ]
 * }
 * ============================================================================
 */

// ============================================================================
// 1. IN-MEMORY STORES (Untuk Fallback & Offline Development Mode)
// ============================================================================
const inMemoryStore = {
  orders: {},
  transactions: {},
  journals: {},
  inventory: {},
  reconcileLogs: {}
};

// ============================================================================
// 2. HELPER NETWORK FETCH DENGAN RETRY LOGIC (Exponential Backoff)
// ============================================================================

/**
 * Fetch HTTP dengan retry otomatis saat terjadi network failure atau transient HTTP error
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      // Sukses atau response terdefinisi dari server (termasuk 404, 400 dsb)
      if (response.ok || response.status === 404 || response.status === 400 || response.status === 409) {
        return response;
      }
      // Transient 5xx status -> lakukan retry
      if (response.status >= 500 && response.status < 600) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        // Backoff: 100ms, 200ms, 400ms...
        const backoffMs = Math.pow(2, attempt - 1) * 100 + Math.floor(Math.random() * 50);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError;
}

/**
 * Ambil konfigurasi Firebase Realtime Database
 */
function getFirebaseConfig(env = {}) {
  const databaseUrl = (
    env?.FIREBASE_DATABASE_URL ||
    env?.VITE_FIREBASE_DATABASE_URL ||
    ""
  ).replace(/\/$/, "");

  const apiKey = env?.FIREBASE_API_KEY || env?.VITE_FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
  const isAvailable = Boolean(databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID") && databaseUrl !== "local-storage");

  return { databaseUrl, apiKey, authParam, isAvailable };
}

// ============================================================================
// 3. HELPER TRANSFORMATION: CONVERT ORDER TO POS TRANSACTION
// ============================================================================

/**
 * Helper: Mengonversi data order mentah menjadi format hemat POS Transaction
 * Format: { id, t, pm, st, tax, disc, total, k, items: [[id, qty, price, name?]], cust, ref }
 */
export function convertOrderToPosTx(order, generatedTxId, kasirUsername, shiftId) {
  const timestamp = Date.now();
  
  // Format items ke format array compact [menuId, qty, price, name]
  let posItems = [];
  if (Array.isArray(order.items)) {
    posItems = order.items.map((it, idx) => {
      if (Array.isArray(it)) return it; // Sudah format array
      const menuId = String(it.id || it.menuId || `item-${idx + 1}`);
      const qty = Number(it.qty || it.quantity || 1);
      const price = Number(it.price || it.unitPrice || 0);
      const name = String(it.name || it.title || menuId);
      return [menuId, qty, price, name];
    });
  } else if (order.items && typeof order.items === 'object') {
    posItems = Object.entries(order.items).map(([k, v]) => {
      const qty = Number(v.qty || v.quantity || 1);
      const price = Number(v.price || v.unitPrice || 0);
      const name = String(v.name || k);
      return [k, qty, price, name];
    });
  } else {
    // Fallback default jika items kosong
    posItems = [['order-menu', 1, Number(order.total || order.grandTotal || 0), 'Pesanan Online']];
  }

  // Hitung subtotal, diskon, pajak
  const calculatedSubtotal = posItems.reduce((acc, it) => acc + (Number(it[1]) * Number(it[2])), 0);
  const total = Number(order.total || order.grandTotal) || calculatedSubtotal;
  const subtotal = Number(order.subtotal) || calculatedSubtotal;
  const tax = Number(order.tax) || 0;
  const discount = Number(order.discount) || 0;

  // Normalisasi payment method
  let pm = String(order.paymentMethod || order.pm || 'qris').toLowerCase();
  if (pm.includes('qris')) pm = 'qris';
  else if (pm.includes('transfer') || pm.includes('bank') || pm.includes('va')) pm = 'transfer';
  else if (pm.includes('gopay') || pm.includes('shopeepay') || pm.includes('ovo') || pm.includes('dana')) pm = 'ewallet';
  else if (pm.includes('cash') || pm.includes('tunai')) pm = 'cash';
  else pm = 'qris';

  return {
    id: generatedTxId,
    orderId: order.orderId || order.id,
    t: timestamp,
    date: new Date(timestamp).toISOString().split('T')[0],
    pm: pm,
    st: subtotal,
    tax: tax,
    disc: discount,
    total: total,
    k: String(kasirUsername || order.kasir || 'kasir_reconcile'),
    shiftId: String(shiftId || 'SHIFT-RECONCILE'),
    items: posItems,
    customer: {
      name: order.customer?.name || order.customerName || 'Pelanggan Online',
      phone: order.customer?.phone || order.customerPhone || '-'
    },
    ref: order.orderId || order.id || generatedTxId,
    midtransId: order.midtransId || order.transaction_id || '',
    isReconciliation: true,
    reconciledAt: timestamp
  };
}

// ============================================================================
// 4. HELPER GENERATOR: JURNAL AKUNTANSI (DOUBLE-ENTRY)
// ============================================================================

/**
 * Helper: Menghasilkan entri Jurnal Umum Double-Entry dari transaksi POS
 * Kaidah F&B:
 * - DEBIT: Kas di Tangan (1001) / Kas di Bank (1002) / Piutang Catering (1003)
 * - KREDIT: Pendapatan Penjualan POS (4001) / Pendapatan Catering (4002)
 */
export function generateJournalEntry(posTx, entryNumber = 1) {
  const dateStr = posTx.date || new Date(posTx.t).toISOString().split('T')[0];
  const grandTotal = Number(posTx.total) || 0;
  const pm = String(posTx.pm || 'cash').toLowerCase();

  // Tentukan Akun Debit berdasarkan Metode Pembayaran
  let debitCode = '1001';
  let debitName = 'Kas di Tangan (Cash on Hand)';

  if (pm === 'qris' || pm === 'transfer' || pm === 'ewallet') {
    debitCode = '1002';
    debitName = 'Kas di Bank (BCA Operasional)';
  } else if (pm === 'piutang' || pm === 'tempo') {
    debitCode = '1003';
    debitName = 'Piutang Usaha / Catering';
  }

  // Tentukan Akun Kredit
  let creditCode = '4001';
  let creditName = 'Pendapatan Penjualan POS';
  if (posTx.customer?.name?.toLowerCase().includes('catering') || posTx.ref?.startsWith('CAT-')) {
    creditCode = '4002';
    creditName = 'Pendapatan Pesanan Catering';
  }

  const entryId = `JRN-REC-${posTx.id}`;
  const noEntry = `JE-REC-${String(entryNumber).padStart(4, '0')}`;

  return {
    id: entryId,
    date: dateStr,
    timestamp: posTx.t || Date.now(),
    noEntry: noEntry,
    desc: `Rekonsiliasi Transaksi POS #${posTx.id} (${posTx.customer?.name || 'Pelanggan'}) [${pm.toUpperCase()}]`,
    debitCode: debitCode,
    debitName: debitName,
    debitAmount: grandTotal,
    creditCode: creditCode,
    creditName: creditName,
    creditAmount: grandTotal,
    ref: posTx.ref || posTx.id,
    kasir: posTx.k,
    proof: ''
  };
}

// ============================================================================
// 5. HELPER DATABASE OPERATIONS (Firebase RTDB + Local In-Memory Fallback)
// ============================================================================

/**
 * 5A. Ambil Detail Order dari /orders/{orderId}
 */
async function fetchOrderDetail(orderId, fbConfig) {
  if (!fbConfig.isAvailable) {
    return inMemoryStore.orders[orderId] || null;
  }

  const url = `${fbConfig.databaseUrl}/orders/${encodeURIComponent(orderId)}.json${fbConfig.authParam}`;
  const res = await fetchWithRetry(url, { method: "GET" });
  if (res.ok) {
    const data = await res.json();
    return data;
  }
  return null;
}

/**
 * 5B. Simpan Transaksi POS ke /pos/transactions/{date}/{txId}
 */
async function savePosTransaction(dateStr, txId, txData, fbConfig) {
  if (!fbConfig.isAvailable) {
    if (!inMemoryStore.transactions[dateStr]) inMemoryStore.transactions[dateStr] = {};
    inMemoryStore.transactions[dateStr][txId] = txData;
    return true;
  }

  const url = `${fbConfig.databaseUrl}/pos/transactions/${encodeURIComponent(dateStr)}/${encodeURIComponent(txId)}.json${fbConfig.authParam}`;
  const res = await fetchWithRetry(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(txData)
  });
  return res.ok;
}

/**
 * 5C. Simpan Jurnal Akuntansi ke /accounting/journal/{month}/{journalId}
 */
async function saveAccountingJournal(monthStr, journalEntry, fbConfig) {
  if (!fbConfig.isAvailable) {
    if (!inMemoryStore.journals[monthStr]) inMemoryStore.journals[monthStr] = [];
    inMemoryStore.journals[monthStr].unshift(journalEntry);
    return true;
  }

  const url = `${fbConfig.databaseUrl}/accounting/journal/${encodeURIComponent(monthStr)}/${encodeURIComponent(journalEntry.id)}.json${fbConfig.authParam}`;
  const res = await fetchWithRetry(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(journalEntry)
  });
  return res.ok;
}

/**
 * 5D. Potong Stok Bahan Baku / Inventory (/pos/inventory/{menuId})
 */
async function updateInventoryDeduct(items, fbConfig) {
  if (!Array.isArray(items) || items.length === 0) return;

  for (const it of items) {
    const menuId = String(Array.isArray(it) ? it[0] : (it.id || it.menuId));
    const qty = Number(Array.isArray(it) ? it[1] : (it.qty || 1));

    if (!menuId || isNaN(qty) || qty <= 0) continue;

    if (!fbConfig.isAvailable) {
      if (!inMemoryStore.inventory[menuId]) {
        inMemoryStore.inventory[menuId] = { stock: 100, name: menuId };
      }
      inMemoryStore.inventory[menuId].stock = Math.max(0, (inMemoryStore.inventory[menuId].stock || 0) - qty);
      continue;
    }

    try {
      // Ambil stok saat ini
      const invUrl = `${fbConfig.databaseUrl}/pos/inventory/${encodeURIComponent(menuId)}.json${fbConfig.authParam}`;
      const getRes = await fetchWithRetry(invUrl, { method: "GET" });
      if (getRes.ok) {
        const invData = await getRes.json();
        if (invData && typeof invData === 'object' && typeof invData.stock === 'number') {
          const newStock = Math.max(0, invData.stock - qty);
          await fetchWithRetry(invUrl, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stock: newStock, lastDeducted: Date.now() })
          });
        }
      }
    } catch (invErr) {
      console.warn(`Inventory deduct note for ${menuId}:`, invErr);
    }
  }
}

/**
 * 5E. Update Summary Penjualan Harian & Bulanan
 */
async function triggerSummaryAggregation(posTx, env) {
  try {
    const { handleAggregateRequest } = await import('./aggregate.js');
    if (typeof handleAggregateRequest === 'function') {
      await handleAggregateRequest({
        date: posTx.date,
        txId: posTx.id,
        amount: posTx.total,
        method: posTx.pm,
        itemsCount: (posTx.items || []).length
      }, env, '127.0.0.1');
    }
  } catch (aggErr) {
    console.warn('Summary aggregation trigger note:', aggErr);
  }
}

/**
 * 5F. Update status /orders/{orderId}
 */
async function patchOrderStatus(orderId, patchPayload, fbConfig) {
  if (!fbConfig.isAvailable) {
    if (inMemoryStore.orders[orderId]) {
      inMemoryStore.orders[orderId] = { ...inMemoryStore.orders[orderId], ...patchPayload };
    } else {
      inMemoryStore.orders[orderId] = { orderId, ...patchPayload };
    }
    return true;
  }

  const url = `${fbConfig.databaseUrl}/orders/${encodeURIComponent(orderId)}.json${fbConfig.authParam}`;
  const res = await fetchWithRetry(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patchPayload)
  });
  return res.ok;
}

/**
 * 5G. Simpan Log Reconcile ke /pos/reconcile_logs/{date}/{logId}
 */
async function saveReconcileAuditLog(dateStr, logId, logData, fbConfig) {
  if (!fbConfig.isAvailable) {
    if (!inMemoryStore.reconcileLogs[dateStr]) inMemoryStore.reconcileLogs[dateStr] = {};
    inMemoryStore.reconcileLogs[dateStr][logId] = logData;
    return true;
  }

  const url = `${fbConfig.databaseUrl}/pos/reconcile_logs/${encodeURIComponent(dateStr)}/${encodeURIComponent(logId)}.json${fbConfig.authParam}`;
  const res = await fetchWithRetry(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(logData)
  });
  return res.ok;
}

// ============================================================================
// 6. MAIN RECONCILIATION PROCESSOR (Sequential Batch Execution)
// ============================================================================

/**
 * Memproses daftar pesanan secara berurutan untuk menjaga integritas jurnal & stok
 */
export async function processBulkReconcile(body, env = {}) {
  // 1. Validasi Input Body
  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      data: { success: false, error: "Request body harus berupa JSON objek yang valid." }
    };
  }

  const {
    orderIds = [],
    kasirUsername = "kasir_utama",
    shiftId = `SHIFT-${new Date().toISOString().split('T')[0]}`,
    action = "record" // "record" | "archive"
  } = body;

  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return {
      status: 400,
      data: { success: false, error: "Field 'orderIds' harus berupa array berisi minimal 1 ID order." }
    };
  }

  if (action !== 'record' && action !== 'archive') {
    return {
      status: 400,
      data: { success: false, error: "Field 'action' harus bernilai 'record' atau 'archive'." }
    };
  }

  const fbConfig = getFirebaseConfig(env);
  const now = Date.now();
  const dateStr = new Date(now).toISOString().split('T')[0];
  const monthStr = dateStr.substring(0, 7);

  const results = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  // 2. Loop Sequential Batch Processing
  for (let i = 0; i < orderIds.length; i++) {
    const rawOrderId = orderIds[i];
    const orderId = String(rawOrderId).trim();

    if (!orderId) {
      results.push({ orderId: String(rawOrderId), status: "failed", txId: null, error: "ID order kosong" });
      failedCount++;
      continue;
    }

    try {
      // Step A: Ambil detail order
      let order = await fetchOrderDetail(orderId, fbConfig);

      // Jika di DB belum ada data detail lengkap (misal langsung dari webhook ID), buat fallback terstruktur
      if (!order) {
        order = {
          orderId: orderId,
          total: 0,
          customer: { name: "Pelanggan Online", phone: "-" },
          paymentMethod: "qris",
          items: [["menu-pesanan", 1, 0, "Pesanan " + orderId]],
          reconciled: false
        };
      }

      // Step B: Cek apakah sudah pernah di-reconcile sebelumnya (Idempotency)
      if (order.reconciled === true) {
        results.push({
          orderId: orderId,
          status: "skipped",
          txId: order.txId || null,
          error: "Order ini sudah direkonsiliasi sebelumnya (already reconciled)"
        });
        skippedCount++;
        continue;
      }

      // Step C: Action === "record" (Masuk ke POS & Jurnal)
      if (action === "record") {
        // Generate Tx ID POS Baru: T + Epoch + Index
        const generatedTxId = 'T' + (Date.now() + i);

        // 1. Konversi ke Format POS
        const posTx = convertOrderToPosTx(order, generatedTxId, kasirUsername, shiftId);

        // 2. Simpan ke /pos/transactions/{date}/{txId}
        await savePosTransaction(dateStr, generatedTxId, posTx, fbConfig);

        // 3. Generate Jurnal Akuntansi Double-Entry & Simpan
        const journalEntry = generateJournalEntry(posTx, i + 1);
        await saveAccountingJournal(monthStr, journalEntry, fbConfig);

        // 4. Update Potong Stok Inventory
        await updateInventoryDeduct(posTx.items, fbConfig);

        // 5. Update Agregasi Penjualan Harian/Bulanan
        await triggerSummaryAggregation(posTx, env);

        // 6. PATCH /orders/{orderId} status reconciled
        await patchOrderStatus(orderId, {
          reconciled: true,
          reconciledAt: Date.now(),
          reconciledBy: kasirUsername,
          txId: generatedTxId,
          status: 'settlement'
        }, fbConfig);

        results.push({
          orderId: orderId,
          status: "success",
          txId: generatedTxId,
          error: null
        });
        successCount++;

      } else if (action === "archive") {
        // Step D: Action === "archive" (Tandai arsip tanpa masuk POS / Jurnal)
        await patchOrderStatus(orderId, {
          reconciled: true,
          archived: true,
          archivedAt: Date.now(),
          archivedBy: kasirUsername
        }, fbConfig);

        results.push({
          orderId: orderId,
          status: "success",
          txId: null,
          error: null
        });
        successCount++;
      }

    } catch (orderErr) {
      console.error(`Error processing order ${orderId}:`, orderErr);
      results.push({
        orderId: orderId,
        status: "failed",
        txId: null,
        error: orderErr.message || "Gagal memproses rekonsiliasi order"
      });
      failedCount++;
    }
  }

  // 3. Logging Audit Trail ke /pos/reconcile_logs/{date}/{logId}
  const logId = `REC-LOG-${dateStr.replace(/-/g, '')}-${now}`;
  const logData = {
    logId: logId,
    timestamp: now,
    date: dateStr,
    kasir: String(kasirUsername),
    shiftId: String(shiftId),
    action: action,
    totalOrders: orderIds.length,
    successCount: successCount,
    failedCount: failedCount,
    skippedCount: skippedCount,
    results: results
  };

  try {
    await saveReconcileAuditLog(dateStr, logId, logData, fbConfig);
  } catch (logErr) {
    console.warn("Save audit log note:", logErr);
  }

  return {
    status: 200,
    data: {
      success: true,
      action: action,
      totalProcessed: orderIds.length,
      successCount: successCount,
      failedCount: failedCount,
      skippedCount: skippedCount,
      logId: logId,
      results: results
    }
  };
}

// ============================================================================
// 7. CLOUDFLARE PAGES / WORKERS ENTRY POINT (onRequest)
// ============================================================================
export async function onRequest(context) {
  const { request, env } = context;

  // Header CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Preflight OPTIONS Handler
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Hanya izinkan POST
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed. Hanya mendukung POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, error: "Payload request body tidak valid (wajib JSON)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await processBulkReconcile(body, env);

    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Reconcile fatal uncaught error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || "Internal server error pada rekonsiliasi."
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
