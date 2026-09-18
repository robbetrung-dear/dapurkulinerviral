/**
 * ============================================================================
 * Cloudflare Pages Function & API: /functions/aggregate.js
 * ============================================================================
 * FUNGSI: Update Ringkasan (Summary) Penjualan Harian & Bulanan setelah transaksi.
 *         Dirancang khusus untuk OPTIMASI BACA FIREBASE RTDB agar dashboard
 *         dan laporan tidak perlu men-scan ribuan record transaksi mentah.
 *
 * ENDPOINT: POST /aggregate (dan /api/aggregate)
 *
 * BODY REQUEST:
 * {
 *   "date": "2026-09-18",       // YYYY-MM-DD
 *   "txId": "TRX-20260918-001", // ID transaksi unik (mencegah double count)
 *   "amount": 75000,            // Total nilai transaksi (Rupiah)
 *   "method": "qris",           // "cash" | "qris" | "transfer" | "ewallet" | "split"
 *   "itemsCount": 3             // (Opsional) Jumlah item terjual
 * }
 *
 * RESPONSE (STATUS 200):
 * {
 *   "success": true,
 *   "message": "Agregasi berhasil diperbarui",
 *   "updated": {
 *     "daily": {
 *       "date": "2026-09-18",
 *       "sales": 2450000,
 *       "tx": 32,
 *       "cash": 1200000,
 *       "qris": 1150000,
 *       "transfer": 100000,
 *       "ewallet": 0,
 *       "split": 0,
 *       "lastUpdated": 1789718400000
 *     },
 *     "monthly": {
 *       "month": "2026-09",
 *       "sales": 48500000,
 *       "tx": 620,
 *       "cash": 22500000,
 *       "qris": 24000000,
 *       "transfer": 2000000,
 *       "ewallet": 0,
 *       "split": 0,
 *       "lastUpdated": 1789718400000
 *     }
 *   },
 *   "cachedInKV": true
 * }
 * ============================================================================
 */

// ============================================================================
// 1. IN-MEMORY CACHE & RATE LIMITING
// ============================================================================
// In-memory cache untuk fallback lokal dan rate limiter
const rateLimitMap = new Map();
const inMemorySummaryCache = {
  daily: {},
  monthly: {},
  processedTxIds: new Set()
};

// Pembersihan berkala rate limiter setiap 10 menit
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now - record.resetTime > 60000) {
      rateLimitMap.delete(ip);
    }
  }
  // Batasi ukuran set processed txIds agar hemat memory
  if (inMemorySummaryCache.processedTxIds.size > 20000) {
    inMemorySummaryCache.processedTxIds.clear();
  }
}, 10 * 60 * 1000);

/**
 * Validasi Rate Limit: Max 100 request/menit per IP
 */
function checkRateLimit(clientIp) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 100;

  const record = rateLimitMap.get(clientIp) || { count: 0, resetTime: now + windowMs };

  if (now > record.resetTime) {
    record.count = 1;
    record.resetTime = now + windowMs;
  } else {
    record.count += 1;
  }

  rateLimitMap.set(clientIp, record);
  return record.count <= maxRequests;
}

// ============================================================================
// 2. HELPER VALIDASI & STRUKTUR DATA
// ============================================================================

/**
 * Validasi Format Tanggal YYYY-MM-DD
 */
function isValidDateFormat(dateStr) {
  if (typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

/**
 * Normalisasi Metode Pembayaran yang Valid
 */
function normalizePaymentMethod(method) {
  const m = String(method || 'cash').toLowerCase().trim();
  const validMethods = ['cash', 'qris', 'transfer', 'ewallet', 'split'];
  return validMethods.includes(m) ? m : 'cash';
}

/**
 * Buat template ringkasan default jika path belum pernah ada data
 */
function createEmptySummary(key, isMonthly = false) {
  return {
    [isMonthly ? 'month' : 'date']: key,
    sales: 0,
    tx: 0,
    cash: 0,
    qris: 0,
    transfer: 0,
    ewallet: 0,
    split: 0,
    itemsCount: 0,
    lastUpdated: Date.now()
  };
}

// ============================================================================
// 3. LOGIKA UPDATE SUMMARY DENGAN RETRY & ETAG (OPTIMISTIC CONCURRENCY)
// ============================================================================

/**
 * Update summary ke Firebase RTDB dengan strategi Read-Modify-Write + ETag Retry
 * atau fallback ke in-memory / KV
 */
async function updateFirebaseSummary(pathUrl, summaryKey, delta, isMonthly, env, maxRetries = 3) {
  const { amount, method, itemsCount, txId } = delta;
  const databaseUrl = (
    env?.FIREBASE_DATABASE_URL ||
    env?.VITE_FIREBASE_DATABASE_URL ||
    ""
  ).replace(/\/$/, "");

  const apiKey = env?.FIREBASE_API_KEY || env?.VITE_FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // 1. Jika Firebase tidak dikonfigurasi, gunakan in-memory cache
  if (!databaseUrl || databaseUrl.includes("YOUR_PROJECT_ID") || databaseUrl === "local-storage") {
    const store = isMonthly ? inMemorySummaryCache.monthly : inMemorySummaryCache.daily;
    if (!store[summaryKey]) {
      store[summaryKey] = createEmptySummary(summaryKey, isMonthly);
    }
    const cur = store[summaryKey];
    cur.sales = (cur.sales || 0) + amount;
    cur.tx = (cur.tx || 0) + 1;
    cur[method] = (cur[method] || 0) + amount;
    cur.itemsCount = (cur.itemsCount || 0) + (itemsCount || 0);
    cur.lastUpdated = Date.now();
    return cur;
  }

  const endpoint = `${databaseUrl}/pos/summary/${isMonthly ? 'monthly' : 'daily'}/${encodeURIComponent(summaryKey)}.json${authParam}`;

  // 2. Loop Retry untuk Read-Modify-Write (Optimistic Locking)
  let lastError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Step A: Read data saat ini
      const getRes = await fetch(endpoint, {
        method: "GET",
        headers: { "Accept": "application/json" }
      });

      let currentData = null;
      let eTag = getRes.headers.get("ETag");

      if (getRes.ok) {
        currentData = await getRes.json();
      }

      if (!currentData || typeof currentData !== 'object') {
        currentData = createEmptySummary(summaryKey, isMonthly);
      }

      // Step B: Kalkulasi Agregat Baru
      const updatedData = {
        [isMonthly ? 'month' : 'date']: summaryKey,
        sales: Math.round((Number(currentData.sales) || 0) + amount),
        tx: Math.round((Number(currentData.tx) || 0) + 1),
        cash: Math.round((Number(currentData.cash) || 0) + (method === 'cash' ? amount : 0)),
        qris: Math.round((Number(currentData.qris) || 0) + (method === 'qris' ? amount : 0)),
        transfer: Math.round((Number(currentData.transfer) || 0) + (method === 'transfer' ? amount : 0)),
        ewallet: Math.round((Number(currentData.ewallet) || 0) + (method === 'ewallet' ? amount : 0)),
        split: Math.round((Number(currentData.split) || 0) + (method === 'split' ? amount : 0)),
        itemsCount: Math.round((Number(currentData.itemsCount) || 0) + (itemsCount || 0)),
        lastTxId: txId || currentData.lastTxId || '',
        lastUpdated: Date.now()
      };

      // Step C: Tulis kembali dengan PUT / PATCH
      const putHeaders = {
        "Content-Type": "application/json"
      };
      if (eTag) {
        putHeaders["if-match"] = eTag; // Pastikan tidak tertimpa race condition jika didukung
      }

      const putRes = await fetch(endpoint, {
        method: "PUT",
        headers: putHeaders,
        body: JSON.stringify(updatedData)
      });

      if (putRes.ok || putRes.status === 200) {
        return updatedData;
      } else if (putRes.status === 412 || putRes.status === 409) {
        // Precondition failed (konflik versi data) -> Tunggu jitter & ulangi
        const jitter = Math.floor(Math.random() * 50) + 20;
        await new Promise(r => setTimeout(r, jitter));
        continue;
      } else {
        const errTxt = await putRes.text();
        throw new Error(`Firebase PUT failed (${putRes.status}): ${errTxt}`);
      }
    } catch (err) {
      lastError = err;
      // Exponential backoff singkat
      await new Promise(r => setTimeout(r, attempt * 40));
    }
  }

  console.warn(`Summary update for ${summaryKey} reached max retries. Fallback applied.`, lastError);
  
  // Fallback ke in-memory jika network retry gagal
  const store = isMonthly ? inMemorySummaryCache.monthly : inMemorySummaryCache.daily;
  if (!store[summaryKey]) store[summaryKey] = createEmptySummary(summaryKey, isMonthly);
  const cur = store[summaryKey];
  cur.sales += amount;
  cur.tx += 1;
  cur[method] += amount;
  cur.lastUpdated = Date.now();
  return cur;
}

// ============================================================================
// 4. SYNC KE CLOUDFLARE KV (JIKA TERSEDIA)
// ============================================================================
async function syncToCloudflareKV(env, dailySummary, monthlySummary) {
  if (!env || !env.POS_KV) return false;
  try {
    const dailyKey = `summary:daily:${dailySummary.date}`;
    const monthlyKey = `summary:monthly:${monthlySummary.month}`;
    
    // Simpan dengan TTL 90 hari untuk daily, 365 hari untuk monthly
    await Promise.all([
      env.POS_KV.put(dailyKey, JSON.stringify(dailySummary), { expirationTtl: 90 * 86400 }),
      env.POS_KV.put(monthlyKey, JSON.stringify(monthlySummary), { expirationTtl: 365 * 86400 })
    ]);
    return true;
  } catch (kvErr) {
    console.warn("Cloudflare KV sync note:", kvErr);
    return false;
  }
}

// ============================================================================
// 5. MAIN CORE HANDLER (Node.js Express + Cloudflare Worker Compatible)
// ============================================================================

/**
 * Handler pemrosesan agregasi
 */
export async function handleAggregateRequest(body, env = {}, clientIp = '127.0.0.1') {
  // 1. Rate Limiting Check
  if (!checkRateLimit(clientIp)) {
    return {
      status: 429,
      data: {
        success: false,
        error: "Terlalu banyak permintaan (Rate limit exceeded: max 100 req/menit per IP)."
      }
    };
  }

  // 2. Validasi Input Body
  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      data: { success: false, error: "Request body harus berupa JSON objek yang valid." }
    };
  }

  const { date, txId, amount, method, itemsCount = 0 } = body;

  // Validasi format tanggal YYYY-MM-DD
  if (!date || !isValidDateFormat(date)) {
    return {
      status: 400,
      data: {
        success: false,
        error: "Field 'date' wajib diisi dengan format YYYY-MM-DD yang valid (contoh: '2026-09-18')."
      }
    };
  }

  // Validasi ID Transaksi
  if (!txId || typeof txId !== 'string') {
    return {
      status: 400,
      data: { success: false, error: "Field 'txId' wajib diisi string ID transaksi yang unik." }
    };
  }

  // Validasi Nominal Amount
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return {
      status: 400,
      data: { success: false, error: "Field 'amount' harus berupa angka positif lebih besar dari 0." }
    };
  }

  // Normalisasi Metode Bayar
  const validMethod = normalizePaymentMethod(method);
  const monthKey = date.substring(0, 7); // YYYY-MM

  // 3. Idempotency Check (Mencegah Agregasi Ganda untuk Transaksi yang Sama)
  const idempotencyKey = `${date}:${txId}`;
  if (inMemorySummaryCache.processedTxIds.has(idempotencyKey)) {
    return {
      status: 200,
      data: {
        success: true,
        message: "Transaksi ini sudah diagregasi sebelumnya (Idempotent OK).",
        updated: {
          daily: inMemorySummaryCache.daily[date] || createEmptySummary(date, false),
          monthly: inMemorySummaryCache.monthly[monthKey] || createEmptySummary(monthKey, true)
        },
        cachedInKV: false
      }
    };
  }

  const delta = {
    amount: Math.round(numAmount),
    method: validMethod,
    itemsCount: Math.max(0, Number(itemsCount) || 0),
    txId: String(txId)
  };

  // 4. Update Summary Harian & Bulanan secara Paralel
  try {
    const [dailySummary, monthlySummary] = await Promise.all([
      updateFirebaseSummary('/pos/summary/daily', date, delta, false, env),
      updateFirebaseSummary('/pos/summary/monthly', monthKey, delta, true, env)
    ]);

    // Tandai ID Transaksi telah diproses
    inMemorySummaryCache.processedTxIds.add(idempotencyKey);
    inMemorySummaryCache.daily[date] = dailySummary;
    inMemorySummaryCache.monthly[monthKey] = monthlySummary;

    // 5. Caching ke Cloudflare KV jika tersedia
    const cachedInKV = await syncToCloudflareKV(env, dailySummary, monthlySummary);

    return {
      status: 200,
      data: {
        success: true,
        message: "Agregasi ringkasan harian & bulanan berhasil diperbarui.",
        updated: {
          daily: dailySummary,
          monthly: monthlySummary
        },
        cachedInKV: cachedInKV
      }
    };
  } catch (err) {
    console.error("Aggregate process error:", err);
    return {
      status: 500,
      data: {
        success: false,
        error: err.message || "Gagal mengupdate agregasi ringkasan."
      }
    };
  }
}

// ============================================================================
// 6. CLOUDFLARE PAGES / WORKERS ENTRY POINT (onRequest)
// ============================================================================
export async function onRequest(context) {
  const { request, env } = context;

  // Header CORS Standar
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Handle Preflight OPTIONS
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
    // Ambil IP klien untuk rate limiting
    const clientIp = request.headers.get("cf-connecting-ip") ||
                     request.headers.get("x-forwarded-for")?.split(",")[0] ||
                     "127.0.0.1";

    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, error: "Payload request body tidak valid (wajib JSON)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await handleAggregateRequest(body, env, clientIp);

    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error("Aggregate fatal uncaught error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Internal server error pada agregasi." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
