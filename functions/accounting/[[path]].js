/**
 * functions/accounting/[[path]].js
 * Cloudflare Pages Function — Proxy request /accounting/* ke Firebase Realtime Database
 * Robust, double-entry validated, backward-compatible, and edge-case handled.
 */

// Header CORS standar untuk semua response
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

// Helper: konversi aman ke number
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/**
 * ✅ FIX BUG-23: Fetch with retry — handle network glitch pada Firebase REST API
 * Retry 3x dengan exponential backoff (500ms, 1s, 2s).
 * Throw error hanya kalau SEMUA attempt gagal.
 */
async function fetchWithRetry(url, options = {}, maxAttempts = 3) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (e) {
      lastErr = e;
    }
    if (attempt < maxAttempts) {
      const backoffMs = 500 * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, backoffMs));
      console.warn(`[RETRY] Attempt ${attempt} failed for ${url.split('?')[0]}, retrying in ${backoffMs}ms...`);
    }
  }
  throw lastErr || new Error('fetchWithRetry: all attempts failed');
}

// Default Chart of Accounts jika database belum diinisialisasi
const DEFAULT_COA = {
  "101": { n: "Kas di Tangan", t: "asset" },
  "102": { n: "Bank", t: "asset" },
  "103": { n: "Piutang Usaha", t: "asset" },
  "105": { n: "Persediaan Bahan Baku", t: "asset" },
  "111": { n: "Akum. Penyusutan", t: "asset" },
  "201": { n: "Hutang Supplier", t: "liability" },
  "301": { n: "Modal Pemilik", t: "equity" },
  "302": { n: "Prive Pemilik", t: "equity" },
  "401": { n: "Pendapatan Penjualan", t: "revenue" },
  "402": { n: "Pendapatan Catering", t: "revenue" },
  "501": { n: "HPP Bahan Baku", t: "expense" },
  "601": { n: "Beban Gaji Karyawan", t: "expense" },
  "602": { n: "Beban Sewa Tempat", t: "expense" },
  "603": { n: "Beban Listrik, Air & Gas", t: "expense" },
  "604": { n: "Beban Pemasaran & Promosi", t: "expense" },
    "605": { n: "Beban Operasional (Kurir/Ekspedisi/Lainnya)", t: "expense" },
  "606": { n: "Beban Penyusutan", t: "expense" }
};

// Kategori Jurnal yang Diizinkan
const ALLOWED_CATEGORIES = ['pembelian', 'operasional', 'modal', 'prive', 'penyesuaian', 'penjualan'];

/**
 * Helper pembentuk JSON Response standar
 */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}

/**
 * Helper: Mencari entri jurnal dengan 3 level fallback
 * 1. Exact match Firebase Key (/accounting/journal/{bulan}/{identifier})
 * 2. Scan field noEntry pada bulan tersebut (/accounting/journal/{bulan})
 * 3. Scan semua bulan (/accounting/journal)
 */
async function findJournalEntry(dbUrl, bulan, identifier, apiKey) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  const cleanId = String(identifier || '').trim();
  if (!cleanId) return null;

  // STRATEGI 1: Exact match dengan Firebase key
  try {
    const url = `${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(cleanId)}.json${auth}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && Object.keys(data).length > 0) {
        return { firebaseKey: cleanId, data, bulan };
      }
    }
  } catch (e) {
    console.warn('[ACCOUNTING-API] Strategy 1 (exact key) failed:', e.message);
  }

  // STRATEGI 2: Cari via field noEntry di semua entry bulan tersebut
  try {
    const url = `${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${auth}`;
    const res = await fetch(url);
    if (res.ok) {
      const all = await res.json();
      if (all && typeof all === 'object') {
        for (const [key, val] of Object.entries(all)) {
          if (val && typeof val === 'object') {
            if (val.noEntry === cleanId || key === cleanId) {
              return { firebaseKey: key, data: val, bulan };
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[ACCOUNTING-API] Strategy 2 (scan noEntry) failed:', e.message);
  }

  // STRATEGI 3: Scan semua bulan (kalau identifier tersimpan di bulan lain)
  try {
    const url = `${dbUrl}/accounting/journal.json${auth}`;
    const res = await fetch(url);
    if (res.ok) {
      const allMonths = await res.json();
      if (allMonths && typeof allMonths === 'object') {
        for (const [mKey, monthData] of Object.entries(allMonths)) {
          if (monthData && typeof monthData === 'object') {
            for (const [key, val] of Object.entries(monthData)) {
              if (val && typeof val === 'object') {
                if (val.noEntry === cleanId || key === cleanId) {
                  return { firebaseKey: key, data: val, bulan: mKey };
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[ACCOUNTING-API] Strategy 3 (scan all months) failed:', e.message);
  }

  return null;
}

/**
 * Mapping kode akun 3-digit (legacy form manual) → 4-digit (standar ledger)
 * Semua kode akun WAJIB dinormalisasi ke 4-digit sebelum ditulis ke ledger
 */
const ACC_MAP_TO_4DIGIT = {
  // Aset
  '101':'1001',  '102':'1002',  '103':'1003',  '105':'1004',  '106':'1005',
  // Kewajiban
  '201':'2001',  '202':'2002',
  // Ekuitas
  '301':'3001',  '302':'3003',  '303':'3002',
  // Pendapatan
  '401':'4001',  '402':'4002',
  // HPP
  '501':'5001',
  // Beban
  '601':'6001',  '602':'6002',  '603':'6003',
  '604':'6004',  '605':'6005',  '606':'6006'
};

/**
 * Normalisasi kode akun ke 4-digit.
 * Kalau kode sudah 4-digit atau tidak ada di mapping, kembalikan apa adanya.
 */
function normalizeAcc(acc) {
  const clean = String(acc || '').trim();
  if (!clean) return '';
  return ACC_MAP_TO_4DIGIT[clean] || clean;
}

/**
 * ✅ FIX BUG-21: Helper hitung bulan sebelumnya dengan format YYYY-MM
 * Return null kalau input tidak valid
 */
function getPrevMonthKey(bulan) {
  if (!bulan || String(bulan).length !== 7) return null;
  const [y, m] = String(bulan).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * ✅ FIX BUG-21: Cek normal balance (kredit-normal vs debit-normal)
 * Konsisten antara rebuild-ledger.js & updateLedgerAfterApprove()
 */
function isKreditNormal(acc) {
  const a = String(acc || '').trim();
  if (!a) return false;
  if (a.startsWith('2')) return true;
  if (a.startsWith('3') && a !== '3003' && a !== '302') return true;  // Modal & Laba Ditahan kredit-normal, Prive debit-normal
  if (a.startsWith('4')) return true;
  return false;
}

/**
 * Helper: Auto-update Buku Besar (Ledger) setelah Jurnal di-Approve
 */
async function updateLedgerAfterApprove(dbUrl, bulan, lines, apiKey, journalId) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  const validLines = Array.isArray(lines) ? lines : [];

  // ✅ FIX BUG-23: Return results untuk audit
  const results = [];

  for (const line of validLines) {
    const rawAcc = String(line.acc || '').trim();
    const acc = normalizeAcc(rawAcc);
    if (!acc) {
      results.push({ acc: rawAcc, ok: false, error: 'invalid acc' });
      continue;
    }

    const debit = Math.max(0, Number(line.debit) || 0);
    const credit = Math.max(0, Number(line.credit) || 0);
    if (debit === 0 && credit === 0) {
      results.push({ acc, ok: true, skipped: true });
      continue;
    }

    try {
      const ledgerUrl = `${dbUrl}/accounting/ledger/${encodeURIComponent(acc)}/${encodeURIComponent(bulan)}.json${auth}`;

      // ✅ FIX BUG-23: Pakai fetchWithRetry
      const res = await fetchWithRetry(ledgerUrl);
      let existing = null;
      if (res.ok) {
        existing = await res.json();
      }

            if (!existing || typeof existing !== 'object') {
        existing = { opening: 0, debit: 0, credit: 0, closing: 0 };
      }

      existing.debit = (Number(existing.debit) || 0) + debit;
      existing.credit = (Number(existing.credit) || 0) + credit;

      // ✅ FIX BUG-21: Kalau opening masih 0 & bukan bulan pertama, ambil closing bulan sebelumnya
      if (!existing.opening || Number(existing.opening) === 0) {
        const prevBulan = getPrevMonthKey(bulan);
        if (prevBulan) {
          try {
            const prevData = await fetchLedgerAccount(dbUrl, acc, prevBulan, apiKey);
            const prevClosing = Number(prevData && prevData.closing) || 0;
            if (prevClosing !== 0) {
              existing.opening = prevClosing;
              console.log(`[LEDGER-BUG21] acc ${acc}: opening carry-forward dari ${prevBulan} = ${prevClosing}`);
            }
          } catch (e) {
            console.warn(`[LEDGER-BUG21] Gagal ambil closing ${acc} ${bulan} dari ${prevBulan}:`, e.message);
          }
        }
      }

      const kN = isKreditNormal(acc);
      existing.closing = kN
        ? (Number(existing.opening) || 0) + existing.credit - existing.debit
        : (Number(existing.opening) || 0) + existing.debit - existing.credit;
      existing.updatedAt = Date.now();

      // ✅ FIX BUG-23: PUT dengan retry juga
      const putRes = await fetchWithRetry(ledgerUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing)
      });

      if (putRes.ok) {
        console.log(`[LEDGER] ✅ acc ${acc} ${bulan}: debit+${debit}, credit+${credit}, closing=${existing.closing} (journal ${journalId})`);
        results.push({ acc, ok: true, closing: existing.closing });
      } else {
        const errText = await putRes.text().catch(() => '');
        console.error(`[LEDGER] ❌ PUT failed for acc ${acc}: HTTP ${putRes.status} ${errText}`);
        results.push({ acc, ok: false, error: `PUT HTTP ${putRes.status}` });
      }
    } catch (err) {
      // ✅ FIX BUG-23: JANGAN swallow — log detail
      console.error(`[LEDGER] ❌ Exception for acc ${acc} ${bulan}:`, err.message || err);
      results.push({ acc, ok: false, error: err.message || 'unknown' });

      // ✅ FIX BUG-23: Log ke Firebase untuk audit
      try {
        const errorLogUrl = `${dbUrl}/accounting/ledger_errors/${bulan}/${journalId}_${acc}_${Date.now()}.json${auth}`;
        await fetch(errorLogUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            acc, bulan, journalId, error: err.message || 'unknown',
            line: { debit, credit },
            at: Date.now(),
            rawAcc
          })
        });
      } catch (logErr) {
        console.error(`[LEDGER] Failed to log error for ${acc}:`, logErr.message);
      }
    }
  }

  return results;
}

/**
 * Helper: Apply delta debit/credit ke Buku Besar (Ledger) untuk edit atau reversal jurnal
 * deltas: { [accCode]: { debit: number, credit: number } }
 */
async function applyLedgerDelta(dbUrl, bulan, deltas, apiKey, journalId) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  const entries = Object.entries(deltas || {});

  for (const [rawAcc, delta] of entries) {
    const acc = normalizeAcc(rawAcc);
    if (!acc) continue;

    const deltaDebit = Number(delta.debit) || 0;
    const deltaCredit = Number(delta.credit) || 0;
    if (deltaDebit === 0 && deltaCredit === 0) continue;

    try {
      const ledgerUrl = `${dbUrl}/accounting/ledger/${encodeURIComponent(acc)}/${encodeURIComponent(bulan)}.json${auth}`;
      const res = await fetchWithRetry(ledgerUrl);
      let existing = null;
      if (res.ok) {
        existing = await res.json();
      }

      if (!existing || typeof existing !== 'object') {
        existing = { opening: 0, debit: 0, credit: 0, closing: 0 };
      }

      existing.debit = Math.max(0, (Number(existing.debit) || 0) + deltaDebit);
      existing.credit = Math.max(0, (Number(existing.credit) || 0) + deltaCredit);

      // Carry-forward opening balance jika belum ada
      if (!existing.opening || Number(existing.opening) === 0) {
        const prevBulan = getPrevMonthKey(bulan);
        if (prevBulan) {
          try {
            const prevData = await fetchLedgerAccount(dbUrl, acc, prevBulan, apiKey);
            const prevClosing = Number(prevData && prevData.closing) || 0;
            if (prevClosing !== 0) {
              existing.opening = prevClosing;
            }
          } catch (e) {}
        }
      }

      const kN = isKreditNormal(acc);
      existing.closing = kN
        ? (Number(existing.opening) || 0) + existing.credit - existing.debit
        : (Number(existing.opening) || 0) + existing.debit - existing.credit;
      existing.updatedAt = Date.now();

      await fetchWithRetry(ledgerUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing)
      });
      console.log(`[LEDGER-DELTA] ✅ acc ${acc} ${bulan}: deltaDebit=${deltaDebit}, deltaCredit=${deltaCredit}, closing=${existing.closing} (journal ${journalId || '-'})`);
    } catch (err) {
      console.error(`[LEDGER-DELTA] ❌ Exception acc ${acc} ${bulan}:`, err.message || err);
    }
  }
}

/**
 * Helper: Ambil data akun dari Ledger Firebase
 */
  async function fetchLedgerAccount(dbUrl, accCode, bulan, apiKey) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  try {
    const url = `${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${auth}`;
    const res = await fetch(url);
    let data = await res.json();

    // ✅ FIX: Pakai ACC_MAP_TO_4DIGIT constant (mapping lengkap 3→4 digit)
    if (!data && accCode.length === 3 && ACC_MAP_TO_4DIGIT[accCode]) {
      const altCode = ACC_MAP_TO_4DIGIT[accCode];
      const altRes = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(altCode)}/${encodeURIComponent(bulan)}.json${auth}`);
      data = await altRes.json();
    } else if (!data && accCode.length === 4) {
      // Reverse mapping 4-digit → 3-digit (legacy fallback)
      const reverseMap = {
        '1001':'101', '1002':'102', '1003':'103', '1004':'105', '1005':'106',
        '2001':'201', '2002':'202',
        '3001':'301', '3003':'302', '3002':'303',
        '4001':'401', '4002':'402',
        '5001':'501',
        '6001':'601', '6002':'602', '6003':'603',
        '6004':'604', '6005':'605', '6006':'606'
      };
      const altCode = reverseMap[accCode];
      if (altCode) {
        const altRes = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(altCode)}/${encodeURIComponent(bulan)}.json${auth}`);
        data = await altRes.json();
      }
    }
    return data || { opening: 0, debit: 0, credit: 0, closing: 0 };
  } catch (e) {
    console.warn(`Fetch ledger ${accCode} error:`, e.message);
    return { opening: 0, debit: 0, credit: 0, closing: 0 };
  }
}

/**
 * Helper: Hitung ringkasan P&L dan Keuangan langsung dari Ledger Firebase
 */
async function calculateSummaryFromLedger(dbUrl, bulan, apiKey) {
  const [
    acc101, acc102, acc103, acc105,
    acc201, acc301, acc302,
    acc401, acc402,
    acc501,
    acc601, acc602, acc603, acc604, acc605, acc606
  ] = await Promise.all([
    fetchLedgerAccount(dbUrl, '101', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '102', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '103', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '105', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '201', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '301', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '302', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '401', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '402', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '501', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '601', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '602', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '603', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '604', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '605', bulan, apiKey),
    fetchLedgerAccount(dbUrl, '606', bulan, apiKey)
  ]);

  // Revenue (credit - debit)
  const penjualanPos = (Number(acc401.credit) || 0) - (Number(acc401.debit) || 0);
  const penjualanCatering = (Number(acc402.credit) || 0) - (Number(acc402.debit) || 0);
  const totalPendapatan = penjualanPos + penjualanCatering;

  // HPP (debit - credit)
  const hppBahanBaku = (Number(acc501.debit) || 0) - (Number(acc501.credit) || 0);
  const totalHpp = hppBahanBaku;

  // Laba Kotor
  const labaKotor = totalPendapatan - totalHpp;
  const marginKotor = totalPendapatan > 0 ? Math.round((labaKotor / totalPendapatan) * 10000) / 100 : 0;

  // Beban
  const bebanGaji = (Number(acc601.debit) || 0) - (Number(acc601.credit) || 0);
  const bebanSewa = (Number(acc602.debit) || 0) - (Number(acc602.credit) || 0);
  const bebanListrik = (Number(acc603.debit) || 0) - (Number(acc603.credit) || 0);
  const bebanMarketing = (Number(acc604.debit) || 0) - (Number(acc604.credit) || 0);
  const bebanKurir = (Number(acc605.debit) || 0) - (Number(acc605.credit) || 0);
  const bebanPenyusutan = (Number(acc606.debit) || 0) - (Number(acc606.credit) || 0);
  const totalBeban = bebanGaji + bebanSewa + bebanListrik + bebanMarketing + bebanKurir + bebanPenyusutan;

  // Laba Bersih
  const labaBersih = labaKotor - totalBeban;
  const marginBersih = totalPendapatan > 0 ? Math.round((labaBersih / totalPendapatan) * 10000) / 100 : 0;

  // INFORMASI TAMBAHAN (BARU)
  const pembelianBahanBaku = Number(acc105.debit) || 0;
  const persediaanAkhir = Number(acc105.closing) || 0;

  // Saldo kas/bank
  const saldoKas = Number(acc101.closing) || 0;
  const saldoBank = Number(acc102.closing) || 0;
  const piutang = Number(acc103.closing) || 0;
  const hutangSupplier = Number(acc201.closing) || 0;

  // Total Aset: kas + bank + piutang + persediaan
  const totalAset = saldoKas + saldoBank + piutang + persediaanAkhir;
  const totalKewajiban = hutangSupplier;
  const totalEkuitas = (Number(acc301.closing) || 0) - (Number(acc302.closing) || 0) + labaBersih;

  const status = labaBersih >= 0 ? "PROFIT" : "LOSS";

  console.log(`[SUMMARY] ${bulan}: Revenue=${totalPendapatan}, HPP=${totalHpp}, Laba=${labaBersih}`);

  const summary = {
    periode: bulan,
    pendapatan: {
      penjualanPos,
      penjualanCatering,
      totalPendapatan
    },
    hpp: {
      bahanBaku: hppBahanBaku,
      totalHpp
    },
    labaKotor,
    marginKotor,
    beban: {
      gaji: bebanGaji,
      sewa: bebanSewa,
      utilitas: bebanListrik,
      marketing: bebanMarketing,
      kurir: bebanKurir,
      penyusutan: bebanPenyusutan,
      totalBeban
    },
    labaBersih,
    marginBersih,
    pembelianBahanBaku,
    persediaanAkhir,
    saldoKas,
    saldoBank,
    piutang,
    hutangSupplier,
    totalAset,
    totalKewajiban,
    totalEkuitas,
    status,
    updatedAt: Date.now()
  };

  return summary;
}

/**
 * Helper: Auto-update Ringkasan Laporan Finansial (P&L, Neraca, Cash Flow)
 */
async function updateSummaryAfterApprove(dbUrl, bulan, apiKey) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  try {
    const summary = await calculateSummaryFromLedger(dbUrl, bulan, apiKey);
    await fetch(`${dbUrl}/accounting/summary/${encodeURIComponent(bulan)}.json${auth}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary)
    });
    return summary;
  } catch (e) {
    console.error('[ACCOUNTING-API] Gagal update summary:', e);
    return null;
  }
}

/**
 * Handler Utama Cloudflare Pages Function
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // 1. Handle CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // 2. Setup Firebase Database REST Endpoint & Auth
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // 3. Parse Route Path
  const fullPath = url.pathname.replace(/^\/accounting\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  // ✅ FIX: Kalau path KOSONG (user buka /accounting), 
  // lanjutkan ke static file handler (context.next())
  // Cloudflare akan serve /public/accounting.html
  if (parts.length === 0) {
    return context.next();
  }

  try {
    // =========================================================================
    // ENDPOINT 1: /accounting/coa (Chart of Accounts)
    // =========================================================================
    if (parts[0] === 'coa') {
      if (method === 'GET') {
                const res = await fetch(`${dbUrl}/accounting/coa.json${authParam}`);
        const data = await res.json();
        // ✅ FIX: Merge Firebase dengan DEFAULT_COA — Firebase override, tapi missing keys dilengkapi default
        // Ini mencegah dropdown lock kalau Firebase korup (cuma 1-2 akun)
        const coaResult = (data && typeof data === 'object' && Object.keys(data).length > 0)
          ? { ...DEFAULT_COA, ...data }
          : { ...DEFAULT_COA };
        console.log('[ACCOUNTING-API] COA merged:', Object.keys(coaResult).length, 'akun (firebase:', Object.keys(data || {}).length + ')');
        return jsonResponse({ success: true, data: coaResult }, 200);
      }

      if (method === 'POST' || method === 'PUT') {
        const body = await request.json().catch(() => ({}));
        if (body.code && body.n) {
          const code = String(body.code).trim();
          const coaItem = {
            n: String(body.n).trim(),
            t: body.t || 'expense'
          };
          await fetch(`${dbUrl}/accounting/coa/${encodeURIComponent(code)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(coaItem)
          });
          return jsonResponse({ success: true, message: `Akun ${code} berhasil disimpan`, data: coaItem }, 200);
        } else if (typeof body === 'object') {
          await fetch(`${dbUrl}/accounting/coa.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          return jsonResponse({ success: true, message: "Seluruh Chart of Accounts berhasil disimpan" }, 200);
        }
        return jsonResponse({ success: false, error: "Payload akun tidak valid" }, 400);
      }

      return jsonResponse({ success: false, error: "Metode tidak didukung pada /accounting/coa" }, 405);
    }

    // =========================================================================
    // ENDPOINT 2A: /accounting/approvals (Daftar Approval Jurnal POS & Akuntansi)
    // =========================================================================
    if (parts[0] === 'approvals') {
      if (method === 'GET') {
        const res = await fetch(`${dbUrl}/accounting/journal.json${authParam}`);
        const allJournals = await res.json();
        const approvals = [];
        if (allJournals && typeof allJournals === 'object') {
          for (const [bulanKey, monthEntries] of Object.entries(allJournals)) {
            if (monthEntries && typeof monthEntries === 'object') {
              for (const [eId, entry] of Object.entries(monthEntries)) {
                approvals.push({
                  entryId: eId,
                  id: eId,
                  bulan: bulanKey,
                  month: bulanKey,
                  ...(entry || {})
                });
              }
            }
          }
        }
        approvals.sort((a, b) => (b.createdAt || b.timestamp || b.t || 0) - (a.createdAt || a.timestamp || a.t || 0));
        return jsonResponse({
          success: true,
          count: approvals.length,
          data: approvals
        }, 200);
      }
      return jsonResponse({ success: false, error: "Metode tidak didukung pada /accounting/approvals" }, 405);
    }

    // =========================================================================
    // ENDPOINT 2: /accounting/journal (Jurnal Umum)
    // =========================================================================
    if (parts[0] === 'journal') {
      const now = new Date();
      const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const targetBulan = parts[1] || currentBulan;

      // GET /accounting/journal ATAU /accounting/journal/{bulan}
      if (method === 'GET') {
        if (parts[1] && parts[1].length === 7) {
          // Format YYYY-MM
          const res = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(parts[1])}.json${authParam}`);
          const data = await res.json();
          const list = data && typeof data === 'object'
            ? Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }))
            : [];
          return jsonResponse({ success: true, bulan: parts[1], data: list }, 200);
        } else if (parts[1]) {
          // Cari spesifik ID / noEntry
          const found = await findJournalEntry(dbUrl, currentBulan, parts[1], apiKey);
          if (!found) {
            return jsonResponse({ success: false, error: `Jurnal dengan ID '${parts[1]}' tidak ditemukan` }, 404);
          }
          return jsonResponse({ success: true, id: found.firebaseKey, bulan: found.bulan, data: found.data }, 200);
        } else {
          // Default: Ambil bulan berjalan
          const res = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(currentBulan)}.json${authParam}`);
          const data = await res.json();
          const list = data && typeof data === 'object'
            ? Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }))
            : [];
          return jsonResponse({ success: true, bulan: currentBulan, data: list }, 200);
        }
      }

      // POST /accounting/journal (Buat Entri Jurnal Baru)
      // ================================================================
      // POST /accounting/journal/pos — Jurnal otomatis dari POS
      // Revenue + HPP (dari resep), ledger & summary auto-update
      // ================================================================
      if (method === 'POST' && parts[1] === 'pos') {
        const body = await request.json().catch(() => ({}));
        const orderId = String(body.orderId || '').trim();
        const dateStr = body.date || new Date().toISOString().split('T')[0];
        const pm = String(body.pm || 'cash').toLowerCase();
        const total = toNum(body.total || body.totalAmount || body.tot);

        let items = [];
        if (Array.isArray(body.items)) {
          items = body.items;
        } else if (body.items && typeof body.items === 'object') {
          items = Object.values(body.items).filter(Boolean);
        }
        items = items.map(it => {
          if (Array.isArray(it)) {
            return { id: it[0], qty: Number(it[1]) || 1, price: Number(it[2]) || 0 };
          }
          return {
            id: it.id || it.menuId,
            qty: Number(it.qty || it.quantity) || 1,
            price: Number(it.price || it.harga) || 0
          };
        });

        if (!orderId || total <= 0) {
          return jsonResponse({ success: false, error: 'orderId dan total wajib diisi' }, 400);
        }

        const bulan = dateStr.substring(0, 7);

        // 1. Tentukan akun debit (Kas/Bank)
        const isBank = pm.includes('qris') || pm.includes('transfer') || pm.includes('bank')
                    || pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo') || pm.includes('dana');
        const debitAcc = isBank ? '1002' : '1001';

        // 2. Jurnal Revenue
        const revId = `JRN-${dateStr.replace(/-/g, '')}-REV-${Date.now().toString().slice(-4)}`;
        const revEntry = {
          noEntry: `POS-REV-${orderId.slice(-6)}`,
          date: dateStr,
          timestamp: Date.now(),
          category: 'pendapatan',
          desc: `Penjualan POS #${orderId} (${pm.toUpperCase()})`,
          ref: orderId,
          status: 'approved',
          lines: [
            { acc: debitAcc, debit: total, credit: 0 },
            { acc: '4001', debit: 0, credit: total }
          ],
          total,
          createdAt: Date.now()
        };

        await fetch(`${dbUrl}/accounting/journal/${bulan}/${revId}.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(revEntry)
        });
        await updateLedgerAfterApprove(dbUrl, bulan, revEntry.lines, apiKey, revId);

        // 3. Hitung HPP dari resep × qty × harga beli
        let totalHpp = 0;
        const hppDetails = [];
        for (const it of items) {
          const menuId = it.id || it.menuId;
          const qty = toNum(it.qty || it.quantity) || 1;
          if (!menuId) continue;

          try {
            const rRes = await fetch(`${dbUrl}/recipes/${encodeURIComponent(menuId)}.json${authParam}`);
            const recipe = await rRes.json();
            if (!recipe || !recipe.ingredients) continue;

            const ingArr = Array.isArray(recipe.ingredients) 
              ? recipe.ingredients 
              : Object.values(recipe.ingredients);
            
            for (const ing of ingArr) {
              const invId = ing.itemId;
              const ingAmt = toNum(ing.amount);
              if (!invId || ingAmt <= 0) continue;

              const invRes = await fetch(`${dbUrl}/inventory/${encodeURIComponent(invId)}.json${authParam}`);
              const inv = await invRes.json();
              if (!inv) continue;
              const price = toNum(inv.purchasePrice || inv.hargaBeli);
              const itemHpp = ingAmt * qty * price;
              totalHpp += itemHpp;
              hppDetails.push({ ing: inv.name || invId, qty, cost: itemHpp });
            }
          } catch (e) {
            console.warn(`[POS-JOURNAL] Resep ${menuId} error:`, e.message);
          }
        }
        totalHpp = Math.round(totalHpp);

        // 4. Jurnal HPP (kalau ada biaya bahan)
        let hppId = null;
        if (totalHpp > 0) {
          hppId = `JRN-${dateStr.replace(/-/g, '')}-HPP-${Date.now().toString().slice(-4)}`;
          const hppEntry = {
            noEntry: `POS-HPP-${orderId.slice(-6)}`,
            date: dateStr,
            timestamp: Date.now(),
            category: 'pembelian',
            desc: `HPP Penjualan #${orderId}`,
            ref: orderId,
            status: 'approved',
            lines: [
              { acc: '5001', debit: totalHpp, credit: 0 },
              { acc: '1004', debit: 0, credit: totalHpp }
            ],
            total: totalHpp,
            createdAt: Date.now()
          };

          await fetch(`${dbUrl}/accounting/journal/${bulan}/${hppId}.json${authParam}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(hppEntry)
          });
          await updateLedgerAfterApprove(dbUrl, bulan, hppEntry.lines, apiKey, hppId);
        }

        // 5. Refresh summary
        await updateSummaryAfterApprove(dbUrl, bulan, apiKey);

        console.log(`[POS-JOURNAL] ✅ ${orderId}: Rev=${total} HPP=${totalHpp}`);
        return jsonResponse({
          success: true,
          message: `Jurnal POS tersimpan. Revenue: ${total}, HPP: ${totalHpp}`,
          revId, hppId, totalRev: total, totalHpp, hppDetails
        }, 201);
      }

      // ================================================================
      // POST /accounting/journal/receive — Jurnal Terima Barang Konsinyasi
      // Debit Persediaan 1004 / Kredit Hutang Supplier 2001
      // ================================================================
      if (method === 'POST' && parts[1] === 'receive') {
        const body = await request.json().catch(() => ({}));
        const dateStr = body.date || new Date().toISOString().split('T')[0];
        const bulan = dateStr.substring(0, 7);
        const amount = toNum(body.amount || body.totalValue);
        const ref = String(body.ref || body.receiveId || `TRM-${Date.now()}`);
        const desc = body.desc || `Penerimaan Barang Konsinyasi: ${body.supplierName || 'Supplier'} (${ref})`;

        if (amount <= 0) return jsonResponse({ success: false, error: 'amount harus lebih dari 0' }, 400);

        const recId = `JRN-${dateStr.replace(/-/g, '')}-REC-${Date.now().toString().slice(-4)}`;
        const recEntry = {
          noEntry: `REC-${ref.slice(-6)}`,
          date: dateStr,
          timestamp: Date.now(),
          category: 'pembelian',
          desc,
          ref,
          status: 'approved',
          lines: [
            { acc: '1004', debit: amount, credit: 0 },
            { acc: '2001', debit: 0, credit: amount }
          ],
          total: amount,
          createdAt: Date.now()
        };

        await fetch(`${dbUrl}/accounting/journal/${bulan}/${recId}.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(recEntry)
        });
        await updateLedgerAfterApprove(dbUrl, bulan, recEntry.lines, apiKey, recId);
        await updateSummaryAfterApprove(dbUrl, bulan, apiKey);

        return jsonResponse({ success: true, message: 'Jurnal penerimaan konsinyasi tercatat', recId, amount }, 201);
      }

      // ================================================================
      // POST /accounting/journal/settlement — Jurnal Settlement & Bayar Supplier
      // Debit Hutang Supplier 2001 / Kredit Kas 1001 atau Bank 1002
      // ================================================================
      if (method === 'POST' && parts[1] === 'settlement') {
        const body = await request.json().catch(() => ({}));
        const dateStr = body.date || new Date().toISOString().split('T')[0];
        const bulan = dateStr.substring(0, 7);
        const amount = toNum(body.amount || body.totalPaid);
        const pm = String(body.paymentMethod || 'cash').toLowerCase();
        const isBank = pm.includes('transfer') || pm.includes('bank') || pm.includes('qris');
        const creditAcc = isBank ? '1002' : '1001';
        const ref = String(body.ref || body.settlementId || `STL-${Date.now()}`);
        const desc = body.desc || `Bayar Konsinyasi: ${body.supplierName || 'Semua'} (${pm.toUpperCase()})`;

        if (amount <= 0) return jsonResponse({ success: false, error: 'amount harus lebih dari 0' }, 400);

        const stlId = `JRN-${dateStr.replace(/-/g, '')}-STL-${Date.now().toString().slice(-4)}`;
        const stlEntry = {
          noEntry: `STL-${ref.slice(-6)}`,
          date: dateStr,
          timestamp: Date.now(),
          category: 'operasional',
          desc,
          ref,
          status: 'approved',
          lines: [
            { acc: '2001', debit: amount, credit: 0 },
            { acc: creditAcc, debit: 0, credit: amount }
          ],
          total: amount,
          createdAt: Date.now()
        };

        await fetch(`${dbUrl}/accounting/journal/${bulan}/${stlId}.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stlEntry)
        });
        await updateLedgerAfterApprove(dbUrl, bulan, stlEntry.lines, apiKey, stlId);
        await updateSummaryAfterApprove(dbUrl, bulan, apiKey);

        return jsonResponse({ success: true, message: 'Jurnal settlement konsinyasi tercatat', stlId, amount }, 201);
      }

      // ================================================================
      // POST /accounting/journal/return — Jurnal Retur Barang Konsinyasi
      // Debit Hutang Supplier 2001 / Kredit Persediaan 1004
      // ================================================================
      if (method === 'POST' && parts[1] === 'return') {
        const body = await request.json().catch(() => ({}));
        const dateStr = body.date || new Date().toISOString().split('T')[0];
        const bulan = dateStr.substring(0, 7);
        const amount = toNum(body.amount || body.totalValue);
        const ref = String(body.ref || body.returnId || `RET-${Date.now()}`);
        const desc = body.desc || `Retur Barang Konsinyasi: ${body.supplierName || 'Supplier'} (${ref})`;

        if (amount <= 0) return jsonResponse({ success: false, error: 'amount harus lebih dari 0' }, 400);

        const retId = `JRN-${dateStr.replace(/-/g, '')}-RET-${Date.now().toString().slice(-4)}`;
        const retEntry = {
          noEntry: `RET-${ref.slice(-6)}`,
          date: dateStr,
          timestamp: Date.now(),
          category: 'penyesuaian',
          desc,
          ref,
          status: 'approved',
          lines: [
            { acc: '2001', debit: amount, credit: 0 },
            { acc: '1004', debit: 0, credit: amount }
          ],
          total: amount,
          createdAt: Date.now()
        };

        await fetch(`${dbUrl}/accounting/journal/${bulan}/${retId}.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retEntry)
        });
        await updateLedgerAfterApprove(dbUrl, bulan, retEntry.lines, apiKey, retId);
        await updateSummaryAfterApprove(dbUrl, bulan, apiKey);

        return jsonResponse({ success: true, message: 'Jurnal retur konsinyasi tercatat', retId, amount }, 201);
      }
      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));
        
        // Validasi Fields Wajib
        const noEntry = String(body.noEntry || body.ref || `JE-${Date.now().toString().slice(-6)}`).trim();
        const dateStr = body.date || body.tgl || new Date().toISOString().split('T')[0];
        const category = String(body.category || 'operasional').toLowerCase();
        const desc = String(body.desc || body.keterangan || '').trim();
        const lines = Array.isArray(body.lines) ? body.lines : [];

        if (!ALLOWED_CATEGORIES.includes(category)) {
          return jsonResponse({
            success: false,
            error: `Kategori '${category}' tidak valid. Pilih dari: ${ALLOWED_CATEGORIES.join(', ')}`
          }, 400);
        }

        if (lines.length < 2) {
          return jsonResponse({
            success: false,
            error: "Entri jurnal harus memiliki minimal 2 baris akun (Debit & Kredit)"
          }, 400);
        }

        // Hitung dan Validasi Double-Entry Balance
        let totalDebit = 0;
        let totalCredit = 0;
        const sanitizedLines = [];

        for (const line of lines) {
          const acc = String(line.acc || line.code || '').trim();
          const debit = Math.max(0, Number(line.debit) || 0);
          const credit = Math.max(0, Number(line.credit) || 0);

          if (!acc) {
            return jsonResponse({ success: false, error: "Setiap baris jurnal harus memiliki kode akun (acc)" }, 400);
          }

          totalDebit += debit;
          totalCredit += credit;

          sanitizedLines.push({
            acc,
            debit,
            credit,
            desc: line.desc ? String(line.desc).trim() : undefined
          });
        }

        if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
          return jsonResponse({
            success: false,
            error: `Jurnal tidak balance! Total Debit: Rp${totalDebit.toLocaleString('id-ID')}, Total Kredit: Rp${totalCredit.toLocaleString('id-ID')}`
          }, 400);
        }

                // ✅ FIX BUG-3: Honor path {bulan}/{entryId} kalau ada
        let entryMonth = dateStr.substring(0, 7);
        let journalId;
        if (parts[1] && parts[1].length === 7 && parts[2]) {
          entryMonth = parts[1];
          journalId = String(parts[2]).trim();
          console.log(`[ACCOUNTING-API] POST journal user-ID: ${journalId} @ ${entryMonth}`);
        } else {
          journalId = `JRN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
        }

        const newEntry = {
          noEntry,
          date: dateStr,
          timestamp: body.timestamp || Date.now(),
          category,
          desc,
          lines: sanitizedLines,
          total: totalDebit,
          status: body.status || 'draft', // 'draft' | 'approved' | 'rejected'
          ref: body.ref || noEntry,
          createdAt: Date.now()
        };

        // Simpan ke Firebase
        await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(entryMonth)}/${encodeURIComponent(journalId)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEntry)
        });

        // Jika status langsung 'approved', auto update ledger & summary
        if (newEntry.status === 'approved') {
          await updateLedgerAfterApprove(dbUrl, entryMonth, sanitizedLines, apiKey, journalId);
          await updateSummaryAfterApprove(dbUrl, entryMonth, apiKey);
        }

        return jsonResponse({
          success: true,
          message: `Entri jurnal ${noEntry} berhasil disimpan`,
          id: journalId,
          bulan: entryMonth,
          data: newEntry
        }, 201);
      }

      // PATCH /accounting/journal/:bulan/:entryId ATAU /accounting/journal/:entryId
      if (method === 'PATCH') {
        const body = await request.json().catch(() => ({}));
        let targetMonth = currentBulan;
        let identifier = '';

        if (parts[1] && parts[1].length === 7 && parts[2]) {
          targetMonth = parts[1];
          identifier = parts[2];
        } else if (parts[1] === 'approve' && parts[2]) {
          identifier = parts[2];
        } else if (parts[2] === 'approve' && parts[1]) {
          identifier = parts[1];
        } else if (parts[1]) {
          identifier = parts[1];
        }

        const found = await findJournalEntry(dbUrl, targetMonth, identifier, apiKey);

        if (!found) {
          return jsonResponse({ success: false, error: `Jurnal '${identifier}' tidak ditemukan untuk diproses` }, 404);
        }

        const isExplicitApproveOrReject = body.action === 'approve' || body.action === 'reject' || parts[2] === 'approve' || parts[3] === 'approve' || parts[1] === 'approve';
        const action = body.action || (isExplicitApproveOrReject ? (parts[2] === 'reject' ? 'reject' : 'approve') : 'edit');
        const approver = body.approvedBy || body.name || 'Finance / Kasir';

        if (action === 'approve') {
          if (found.data.status === 'approved') {
            return jsonResponse({ success: true, message: "Jurnal sudah berstatus approved sebelumnya", data: found.data }, 200);
          }

          // Update status di Firebase
          const updatedData = {
            ...found.data,
            status: 'approved',
            approvedBy: approver,
            approvedAt: Date.now(),
            rejectedReason: null
          };

          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(found.bulan)}/${encodeURIComponent(found.firebaseKey)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
          });

          // Update Buku Besar & Ringkasan Laporan
          await updateLedgerAfterApprove(dbUrl, found.bulan, found.data.lines, apiKey, found.firebaseKey);
          await updateSummaryAfterApprove(dbUrl, found.bulan, apiKey);

          return jsonResponse({
            success: true,
            message: `Jurnal ${found.data.noEntry || found.firebaseKey} berhasil di-approve & diposting ke Buku Besar`,
            entryId: found.firebaseKey,
            data: updatedData
          }, 200);
        } else if (action === 'reject') {
          const updatedData = {
            ...found.data,
            status: 'rejected',
            approvedBy: approver,
            rejectedReason: body.rejectedReason || 'Ditolak oleh finance',
            rejectedAt: Date.now()
          };

          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(found.bulan)}/${encodeURIComponent(found.firebaseKey)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
          });

          return jsonResponse({
            success: true,
            message: `Jurnal ${found.data.noEntry || found.firebaseKey} berhasil ditolak`,
            entryId: found.firebaseKey,
            data: updatedData
          }, 200);
        } else if (action === 'edit' || Array.isArray(body.lines)) {
          // GUARD: hanya boleh delete/edit jurnal dengan status === 'pending' ATAU date === hari ini.
          // Jurnal approved dari hari sebelumnya → reject 403
          const todayUTC = new Date().toISOString().split('T')[0];
          const todayWIB = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
          const oldDate = String(found.data.date || found.data.tgl || '').split('T')[0];
          const isPending = (found.data.status === 'pending');
          const isToday = (oldDate === todayUTC || oldDate === todayWIB);

          if (!isPending && !isToday) {
            return jsonResponse({
              success: false,
              error: "Jurnal approved dari hari sebelumnya tidak dapat dihapus. Buat jurnal reversal."
            }, 403);
          }

          const newLines = Array.isArray(body.lines) ? body.lines : (found.data.lines || []);
          let totalDebit = 0, totalCredit = 0;
          for (const l of newLines) {
            totalDebit += Math.max(0, Number(l.debit) || 0);
            totalCredit += Math.max(0, Number(l.credit) || 0);
          }
          if (Math.abs(totalDebit - totalCredit) > 0.01) {
            return jsonResponse({ success: false, error: "Jurnal tidak seimbang: Total debit harus sama dengan total kredit" }, 400);
          }

          // Hitung delta per akun: deltaDebit = newDebit - oldDebit, deltaCredit = newCredit - oldCredit
          const oldLines = Array.isArray(found.data.lines) ? found.data.lines : [];
          const accountDeltas = {};
          for (const line of oldLines) {
            const acc = normalizeAcc(line.acc);
            if (!acc) continue;
            if (!accountDeltas[acc]) accountDeltas[acc] = { debit: 0, credit: 0 };
            accountDeltas[acc].debit -= Math.max(0, Number(line.debit) || 0);
            accountDeltas[acc].credit -= Math.max(0, Number(line.credit) || 0);
          }
          for (const line of newLines) {
            const acc = normalizeAcc(line.acc);
            if (!acc) continue;
            if (!accountDeltas[acc]) accountDeltas[acc] = { debit: 0, credit: 0 };
            accountDeltas[acc].debit += Math.max(0, Number(line.debit) || 0);
            accountDeltas[acc].credit += Math.max(0, Number(line.credit) || 0);
          }

          // Apply delta ke ledger jika status approved
          if (found.data.status === 'approved' || !found.data.status) {
            await applyLedgerDelta(dbUrl, found.bulan, accountDeltas, apiKey, found.firebaseKey);
            await updateSummaryAfterApprove(dbUrl, found.bulan, apiKey);
          }

          // Update jurnal di /accounting/journal/{bulan}/{entryId}
          const updatedData = {
            ...found.data,
            date: body.date || found.data.date,
            category: body.category || found.data.category || 'operasional',
            desc: body.desc !== undefined ? String(body.desc).trim() : found.data.desc,
            ref: body.ref !== undefined ? String(body.ref).trim() : found.data.ref,
            lines: newLines,
            updatedAt: Date.now()
          };

          const debitLine = newLines.find(l => Number(l.debit) > 0);
          const creditLine = newLines.find(l => Number(l.credit) > 0);
          if (debitLine) {
            updatedData.debitCode = debitLine.acc;
            updatedData.debitAmount = Number(debitLine.debit);
          }
          if (creditLine) {
            updatedData.creditCode = creditLine.acc;
            updatedData.creditAmount = Number(creditLine.credit);
          }

          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(found.bulan)}/${encodeURIComponent(found.firebaseKey)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedData)
          });

          return jsonResponse({
            success: true,
            message: `Jurnal ${found.data.noEntry || found.firebaseKey} berhasil diperbarui`,
            id: found.firebaseKey,
            data: updatedData
          }, 200);
        } else {
          return jsonResponse({ success: false, error: `Action '${action}' tidak valid` }, 400);
        }
      }

      // DELETE /accounting/journal/{identifier} ATAU /accounting/journal/{bulan}/{identifier}
      if (method === 'DELETE' && parts[1]) {
        let deleteMonth = targetBulan;
        let identifier = parts[1];
        if (parts[1].length === 7 && parts[2]) {
          deleteMonth = parts[1];
          identifier = parts[2];
        }

        const found = await findJournalEntry(dbUrl, deleteMonth, identifier, apiKey);
        if (!found) {
          return jsonResponse({ success: false, error: `Jurnal '${identifier}' tidak ditemukan untuk dihapus` }, 404);
        }

        // GUARD: hanya boleh delete/edit jurnal dengan status === 'pending' ATAU date === hari ini.
        // Jurnal approved dari hari sebelumnya → reject 403
        const todayUTC = new Date().toISOString().split('T')[0];
        const todayWIB = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
        const oldDate = String(found.data.date || found.data.tgl || '').split('T')[0];
        const isPending = (found.data.status === 'pending');
        const isToday = (oldDate === todayUTC || oldDate === todayWIB);

        if (!isPending && !isToday) {
          return jsonResponse({
            success: false,
            error: "Jurnal approved dari hari sebelumnya tidak dapat dihapus. Buat jurnal reversal."
          }, 403);
        }

        // Reverse saldo lama: debit -= oldDebit, credit -= oldCredit per akun
        if ((found.data.status === 'approved' || !found.data.status) && Array.isArray(found.data.lines)) {
          const reversalDeltas = {};
          for (const line of found.data.lines) {
            const acc = normalizeAcc(line.acc);
            if (!acc) continue;
            if (!reversalDeltas[acc]) reversalDeltas[acc] = { debit: 0, credit: 0 };
            reversalDeltas[acc].debit -= Math.max(0, Number(line.debit) || 0);
            reversalDeltas[acc].credit -= Math.max(0, Number(line.credit) || 0);
          }
          await applyLedgerDelta(dbUrl, found.bulan, reversalDeltas, apiKey, found.firebaseKey);
          await updateSummaryAfterApprove(dbUrl, found.bulan, apiKey);
        }

        // Hapus entry dari /accounting/journal/{bulan}/{entryId}
        await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(found.bulan)}/${encodeURIComponent(found.firebaseKey)}.json${authParam}`, {
          method: 'DELETE'
        });

        return jsonResponse({ success: true, message: `Jurnal ${identifier} berhasil dihapus` }, 200);
      }
    }

    // =========================================================================
    // ENDPOINT 3: /accounting/ledger (Buku Besar)
    // =========================================================================
    if (parts[0] === 'ledger') {
      const now = new Date();
      const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const accCode = parts[1];
      // Bulan diambil dari query string (?bulan=YYYY-MM) terlebih dahulu,
      // lalu fallback ke path segment, lalu bulan sekarang.
      const bulan = url.searchParams.get('bulan') || parts[2] || currentBulan;

      if (method === 'GET') {
        if (accCode) {
          // Ambil ledger akun spesifik
          const res = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${authParam}`);
          const data = await res.json();
          return jsonResponse({
            success: true,
            acc: accCode,
            bulan,
            data: data || { opening: 0, debit: 0, credit: 0, closing: 0 }
          }, 200);
        } else {
          // Ambil seluruh ledger untuk bulan tertentu
          const res = await fetch(`${dbUrl}/accounting/ledger.json${authParam}`);
          const all = await res.json();
          const ledgerMonth = {};
          if (all && typeof all === 'object') {
            for (const [code, months] of Object.entries(all)) {
              if (months && months[bulan]) {
                ledgerMonth[code] = months[bulan];
              }
            }
          }
          return jsonResponse({ success: true, bulan, data: ledgerMonth }, 200);
        }
      }

      // PUT/POST /accounting/ledger/{acc}/{bulan} — Set saldo manual / opening
      if ((method === 'POST' || method === 'PUT') && accCode && bulan) {
        const body = await request.json().catch(() => ({}));
        const existing = await fetchLedgerAccount(dbUrl, accCode, bulan, apiKey);
        
        const opening = body.opening !== undefined ? Number(body.opening) : Number(existing.opening || 0);
        const debit = body.debit !== undefined ? Number(body.debit) : Number(existing.debit || 0);
        const credit = body.credit !== undefined ? Number(body.credit) : Number(existing.credit || 0);
        // ✅ FIX BUG-21: closing sesuai normal balance akun
        const closing = isKreditNormal(accCode)
          ? opening + credit - debit
          : opening + debit - credit;

        const ledgerPayload = {
          opening,
          debit,
          credit,
          closing,
          updatedAt: Date.now()
        };

        await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ledgerPayload)
        });

        await updateSummaryAfterApprove(dbUrl, bulan, apiKey);

        return jsonResponse({
          success: true,
          message: `Buku besar akun ${accCode} periode ${bulan} berhasil diperbarui`,
          data: ledgerPayload
        }, 200);
      }

      return jsonResponse({ success: false, error: "Metode tidak didukung pada /accounting/ledger" }, 405);
    }

    // =========================================================================
    // ENDPOINT 4: /accounting/summary/{bulan} (Laporan Laba Rugi / P&L)
    // =========================================================================
    if (parts[0] === 'summary') {
      const now = new Date();
      const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const bulan = parts[1] || currentBulan;

      // Hitung realtime dari Ledger Firebase
      const summary = await calculateSummaryFromLedger(dbUrl, bulan, apiKey);

      // Simpan cache ke Firebase
      try {
        await fetch(`${dbUrl}/accounting/summary/${encodeURIComponent(bulan)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(summary)
        });
      } catch (saveErr) {
        console.warn('[ACCOUNTING-API] Gagal cache summary:', saveErr);
      }

      return jsonResponse({
        success: true,
        data: summary
      }, 200);
    }

        // =========================================================================
    // ENDPOINT: /accounting/closed_periods[/{bulan}] — Cek status tutup buku
    // Return 200 selalu (biar tidak muncul 404 di console browser)
    // =========================================================================
    if (parts[0] === 'closed_periods') {
      const bulan = (parts[1] || '').replace(/\.json$/, '');

      if (!bulan) {
        // Return semua periode yang sudah ditutup
        const res = await fetch(`${dbUrl}/accounting/closed_periods.json${authParam}`);
        const data = await res.json() || {};
        return jsonResponse({ success: true, data }, 200);
      }

      // Return status 1 periode spesifik — return 200 walau belum ditutup
      const res = await fetch(`${dbUrl}/accounting/closed_periods/${encodeURIComponent(bulan)}.json${authParam}`);
      const data = await res.json();
      return jsonResponse({
        success: true,
        bulan,
        closed: !!(data && data.closed),
        data: data || null
      }, 200);
    }

    // Route tidak dikenali
    return jsonResponse({
      success: false,
      error: `Endpoint /accounting/${fullPath} tidak ditemukan`
    }, 404);

  } catch (err) {
    console.error('[ACCOUNTING-API] Global Request Exception:', err);
    return jsonResponse({
      success: false,
      error: err.message || "Terjadi kesalahan internal server"
    }, 500);
  }
}
