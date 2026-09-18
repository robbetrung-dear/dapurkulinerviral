/**
 * ============================================================================
 * Cloudflare Pages Function & Cron Worker: /functions/archive.js
 * ============================================================================
 * FUNGSI: Mengarsipkan data historis transaksi (> 12 bulan lalu) dari Firebase
 *         Realtime Database (RTDB) ke Firebase Storage (JSON terkompresi gzip).
 *         Menjaga ukuran RTDB tetap ramping (< 500 MB) agar selalu gratis selamanya,
 *         sembari tetap mempertahankan data ringkasan agregat harian/bulanan
 *         (/pos/summary) untuk keperluan reporting cepat.
 *
 * TRIGGER:
 * 1. Manual API: POST /archive (atau /api/archive)
 *    Body: { "type": "monthly", "date": "2025-08", "dryRun": false }
 * 2. Otomatis: Cloudflare Scheduled Event (Cron Trigger: 0 3 1 * *)
 *
 * SAFETY & RESILIENCE:
 * - Backup sebelum hapus: Verifikasi upload Storage sukses 100% sebelum delete.
 * - Rollback: Jika upload gagal, node RTDB TIDAK akan disentuh.
 * - Dry-run mode: Mendukung simulasi audit tanpa menghapus record asli.
 * - Ringkasan Tetap Utuh: Path /pos/summary/daily & /pos/summary/monthly dipertahankan.
 * ============================================================================
 */

// ============================================================================
// 1. HELPER DATE & PERIODE ARSIP
// ============================================================================

/**
 * Mendapatkan bulan target default yang berusia > 12 bulan lalu (YYYY-MM)
 * Contoh: Jika sekarang September 2026, maka targetnya Agustus 2025 (13 bulan lalu)
 */
function getDefaultArchiveTargetMonth(monthsAgo = 12) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Validasi format YYYY-MM
 */
function isValidYearMonth(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}$/.test(str);
}

// ============================================================================
// 2. HELPER GZIP COMPRESSION (Edge Streams & Node.js Compatible)
// ============================================================================

/**
 * Mengompres string JSON menjadi GZIP Uint8Array menggunakan CompressionStream bawaan
 */
async function compressJsonToGzip(jsonString) {
  const uint8 = new TextEncoder().encode(jsonString);

  // Jika runtime mendukung CompressionStream (Web Standards / Cloudflare Edge / Node 18+)
  if (typeof CompressionStream === 'function') {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(uint8);
        controller.close();
      }
    }).pipeThrough(new CompressionStream('gzip'));

    const reader = stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  // Fallback: Kembalikan uncompressed Uint8Array jika CompressionStream tidak aktif
  return uint8;
}

// ============================================================================
// 3. FIREBASE REST API INTERACTIONS (RTDB & Cloud Storage)
// ============================================================================

function getFirebaseConfig(env = {}) {
  const databaseUrl = (
    env?.FIREBASE_DATABASE_URL ||
    env?.VITE_FIREBASE_DATABASE_URL ||
    ""
  ).replace(/\/$/, "");

  const apiKey = env?.FIREBASE_API_KEY || env?.VITE_FIREBASE_API_KEY || "";
  const storageBucket = (
    env?.FIREBASE_STORAGE_BUCKET ||
    env?.VITE_FIREBASE_STORAGE_BUCKET ||
    (databaseUrl.includes("firebaseio.com") ? databaseUrl.replace("https://", "").split(".")[0] + ".appspot.com" : "")
  );

  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
  const isAvailable = Boolean(databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID") && databaseUrl !== "local-storage");

  return { databaseUrl, apiKey, storageBucket, authParam, isAvailable };
}

/**
 * Ambil seluruh transaksi POS untuk bulan tertentu (misal: "2025-08")
 * Path RTDB: /pos/transactions/{date}
 */
async function fetchMonthTransactions(targetYearMonth, fbConfig) {
  if (!fbConfig.isAvailable) {
    // Mock sample untuk offline development
    return {
      dates: [`${targetYearMonth}-01`, `${targetYearMonth}-15`],
      data: {
        [`${targetYearMonth}-01`]: {
          "T1001": { id: "T1001", total: 45000, pm: "cash", items: [["m1", 2, 22500]] }
        },
        [`${targetYearMonth}-15`]: {
          "T1002": { id: "T1002", total: 120000, pm: "qris", items: [["m2", 4, 30000]] }
        }
      },
      count: 2
    };
  }

  // Ambil transaksi dengan query rentang tanggal
  const startDate = `${targetYearMonth}-01`;
  const endDate = `${targetYearMonth}-31`;
  const url = `${fbConfig.databaseUrl}/pos/transactions.json${fbConfig.authParam}&orderBy="$key"&startAt="${startDate}"&endAt="${endDate}"`;

  const res = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
  if (!res.ok) {
    throw new Error(`Gagal membaca transaksi RTDB (${res.status}): ${await res.text()}`);
  }

  const rawData = await res.json();
  if (!rawData || typeof rawData !== 'object') {
    return { dates: [], data: {}, count: 0 };
  }

  const dates = Object.keys(rawData);
  let totalCount = 0;
  for (const d of dates) {
    if (rawData[d] && typeof rawData[d] === 'object') {
      totalCount += Object.keys(rawData[d]).length;
    }
  }

  return { dates, data: rawData, count: totalCount };
}

/**
 * Ambil Jurnal Akuntansi bulan target: /accounting/journal/{targetYearMonth}
 */
async function fetchMonthJournals(targetYearMonth, fbConfig) {
  if (!fbConfig.isAvailable) return { data: {}, count: 0 };

  const url = `${fbConfig.databaseUrl}/accounting/journal/${encodeURIComponent(targetYearMonth)}.json${fbConfig.authParam}`;
  try {
    const res = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const count = data && typeof data === 'object' ? Object.keys(data).length : 0;
      return { data: data || {}, count };
    }
  } catch (e) {
    console.warn("Fetch journals note:", e);
  }
  return { data: {}, count: 0 };
}

/**
 * Upload payload arsip terkompresi ke Firebase Cloud Storage via REST API
 * Destination: archives/{YYYY}/transactions-{YYYY-MM}.json.gz
 */
async function uploadToFirebaseStorage(storagePath, compressedBuffer, fbConfig) {
  if (!fbConfig.isAvailable || !fbConfig.storageBucket) {
    // Mode demo offline
    return {
      success: true,
      downloadUrl: `https://storage.mock.local/${storagePath}`,
      sizeBytes: compressedBuffer.byteLength
    };
  }

  const encodedPath = encodeURIComponent(storagePath);
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${fbConfig.storageBucket}/o?name=${encodedPath}${fbConfig.authParam}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/gzip",
      "Content-Encoding": "gzip",
      "X-Goog-Meta-ArchivedAt": new Date().toISOString()
    },
    body: compressedBuffer
  });

  if (!res.ok) {
    const errTxt = await res.text();
    throw new Error(`Upload Firebase Storage gagal (${res.status}): ${errTxt}`);
  }

  const resultJson = await res.json();
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${fbConfig.storageBucket}/o/${encodedPath}?alt=media`;

  return {
    success: true,
    name: resultJson.name || storagePath,
    downloadUrl: downloadUrl,
    sizeBytes: compressedBuffer.byteLength
  };
}

/**
 * Hapus record transaksi harian yang sudah sukses diarsipkan dari RTDB
 */
async function deleteTransactionsFromRTDB(dates, fbConfig) {
  if (!fbConfig.isAvailable || !Array.isArray(dates) || dates.length === 0) return true;

  const results = [];
  for (const d of dates) {
    const deleteUrl = `${fbConfig.databaseUrl}/pos/transactions/${encodeURIComponent(d)}.json${fbConfig.authParam}`;
    const res = await fetch(deleteUrl, { method: "DELETE" });
    results.push({ date: d, ok: res.ok });
  }

  return results.every(r => r.ok);
}

/**
 * Simpan Log Riwayat Arsip ke /archive_logs/{timestamp}
 */
async function saveArchiveAuditLog(logData, fbConfig) {
  if (!fbConfig.isAvailable) return;
  try {
    const timestamp = Date.now();
    const url = `${fbConfig.databaseUrl}/archive_logs/${timestamp}.json${fbConfig.authParam}`;
    await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...logData, timestamp })
    });
  } catch (logErr) {
    console.warn("Save archive log error:", logErr);
  }
}

// ============================================================================
// 4. MAIN ARCHIVE WORKFLOW ENGINE
// ============================================================================

/**
 * Menjalankan proses arsip per 1 bulan target
 */
export async function executeMonthlyArchive(options = {}, env = {}) {
  const {
    date = getDefaultArchiveTargetMonth(12),
    dryRun = false,
    triggeredBy = "manual"
  } = options;

  const targetYearMonth = String(date).trim();
  if (!isValidYearMonth(targetYearMonth)) {
    return {
      status: 400,
      data: { success: false, error: "Format parameter 'date' harus YYYY-MM (contoh: '2025-08')." }
    };
  }

  const fbConfig = getFirebaseConfig(env);
  const [year] = targetYearMonth.split('-');
  const storagePath = `archives/${year}/transactions-${targetYearMonth}.json.gz`;

  const startTime = Date.now();

  try {
    // STEP 1: Ambil data transaksi dan jurnal lama
    const [txResult, journalResult] = await Promise.all([
      fetchMonthTransactions(targetYearMonth, fbConfig),
      fetchMonthJournals(targetYearMonth, fbConfig)
    ]);

    const totalRecords = txResult.count + journalResult.count;

    if (totalRecords === 0) {
      return {
        status: 200,
        data: {
          success: true,
          message: `Tidak ada data historis pada bulan ${targetYearMonth} untuk diarsipkan.`,
          targetMonth: targetYearMonth,
          totalRecords: 0,
          dryRun: Boolean(dryRun)
        }
      };
    }

    // STEP 2: Susun Paket Bundel Arsip
    const archiveBundle = {
      archiveInfo: {
        version: "1.0",
        targetMonth: targetYearMonth,
        archivedAt: new Date().toISOString(),
        totalTransactions: txResult.count,
        totalJournals: journalResult.count,
        datesIncluded: txResult.dates,
        summaryRetainedInRTDB: true
      },
      transactions: txResult.data,
      journals: journalResult.data
    };

    const jsonString = JSON.stringify(archiveBundle);
    const uncompressedSize = jsonString.length;

    // STEP 3: Kompresi Gzip
    const compressedGzip = await compressJsonToGzip(jsonString);
    const compressedSize = compressedGzip.byteLength;
    const compressionRatio = ((1 - (compressedSize / uncompressedSize)) * 100).toFixed(1) + "%";

    // STEP 4: Jika DRY-RUN, berikan preview tanpa upload & hapus
    if (dryRun) {
      return {
        status: 200,
        data: {
          success: true,
          dryRun: true,
          message: `[DRY-RUN] Simulasi arsip bulan ${targetYearMonth} selesai. Tidak ada data yang dihapus.`,
          summary: {
            targetMonth: targetYearMonth,
            storagePath: storagePath,
            datesCount: txResult.dates.length,
            dates: txResult.dates,
            transactionCount: txResult.count,
            journalCount: journalResult.count,
            uncompressedBytes: uncompressedSize,
            compressedBytes: compressedSize,
            compressionRatio: compressionRatio
          }
        }
      };
    }

    // STEP 5: Upload ke Firebase Storage
    const uploadResult = await uploadToFirebaseStorage(storagePath, compressedGzip, fbConfig);

    // STEP 6: Hapus dari RTDB hanya setelah upload berhasil diverifikasi
    let deletedSuccess = false;
    if (uploadResult.success) {
      deletedSuccess = await deleteTransactionsFromRTDB(txResult.dates, fbConfig);
    }

    const durationMs = Date.now() - startTime;

    // STEP 7: Audit Trail Log
    const auditLog = {
      range: targetYearMonth,
      storagePath: storagePath,
      uncompressedSize: uncompressedSize,
      compressedSize: compressedSize,
      compressionRatio: compressionRatio,
      transactionCount: txResult.count,
      journalCount: journalResult.count,
      datesDeleted: txResult.dates,
      triggeredBy: triggeredBy,
      durationMs: durationMs,
      status: deletedSuccess ? "SUCCESS" : "PARTIAL_ERROR"
    };

    await saveArchiveAuditLog(auditLog, fbConfig);

    return {
      status: 200,
      data: {
        success: true,
        message: `Arsip data bulan ${targetYearMonth} berhasil dipindahkan ke Firebase Storage.`,
        summary: {
          targetMonth: targetYearMonth,
          storagePath: storagePath,
          downloadUrl: uploadResult.downloadUrl,
          totalTransactionsArchived: txResult.count,
          totalJournalsArchived: journalResult.count,
          uncompressedSize: `${(uncompressedSize / 1024).toFixed(2)} KB`,
          compressedSize: `${(compressedSize / 1024).toFixed(2)} KB`,
          compressionRatio: compressionRatio,
          rtdbCleanupCompleted: deletedSuccess,
          summaryRetained: true,
          durationMs: durationMs
        }
      }
    };

  } catch (err) {
    console.error(`Archive execution failed for ${targetYearMonth}:`, err);
    return {
      status: 500,
      data: {
        success: false,
        error: err.message || "Gagal menjalankan proses arsip data."
      }
    };
  }
}

// ============================================================================
// 5. CLOUDFLARE PAGES / WORKERS ENTRY POINT (onRequest & scheduled)
// ============================================================================

/**
 * Handle Manual API Trigger: POST /archive & /api/archive
 */
export async function onRequest(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    let options = {};
    const url = new URL(request.url);
    const dryRunParam = url.searchParams.get("dryRun");

    if (request.method === "POST") {
      try {
        options = await request.json();
      } catch (_) {
        options = {};
      }
    } else if (request.method === "GET") {
      options.date = url.searchParams.get("date") || undefined;
    }

    if (dryRunParam !== null) {
      options.dryRun = dryRunParam === "true" || dryRunParam === "1";
    }
    options.triggeredBy = "manual_api";

    const result = await executeMonthlyArchive(options, env);

    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Archive request fatal error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Internal server error." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle Scheduled Cron Trigger (Cloudflare Cron: 0 3 1 * *)
 * Eksekusi otomatis tiap tanggal 1 jam 03:00 pagi
 */
export async function scheduled(event, env, ctx) {
  console.log(`[CRON ARCHIVE] Starting scheduled archive job at ${new Date().toISOString()}`);
  const targetMonth = getDefaultArchiveTargetMonth(12); // Arsipkan bulan ke-13 yang lalu
  const result = await executeMonthlyArchive({
    date: targetMonth,
    dryRun: false,
    triggeredBy: "cloudflare_cron"
  }, env);
  console.log(`[CRON ARCHIVE] Completed:`, JSON.stringify(result.data));
  return result;
}

export default {
  scheduled
};
