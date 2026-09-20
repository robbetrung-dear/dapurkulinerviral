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
  "605": { n: "Beban Kurir & Ekspedisi", t: "expense" },
  "606": { n: "Beban Penyusutan", t: "expense" }
};

// Kategori Jurnal yang Diizinkan
const ALLOWED_CATEGORIES = ['pembelian', 'operasional', 'modal', 'prive', 'penyesuaian'];

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
 * Helper: Auto-update Buku Besar (Ledger) setelah Jurnal di-Approve
 */
async function updateLedgerAfterApprove(dbUrl, bulan, lines, apiKey, journalId) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  const validLines = Array.isArray(lines) ? lines : [];

  for (const line of validLines) {
    const acc = String(line.acc || '').trim();
    if (!acc) continue;

    const debit = Math.max(0, Number(line.debit) || 0);
    const credit = Math.max(0, Number(line.credit) || 0);
    if (debit === 0 && credit === 0) continue;

    try {
      const ledgerUrl = `${dbUrl}/accounting/ledger/${encodeURIComponent(acc)}/${encodeURIComponent(bulan)}.json${auth}`;
      const res = await fetch(ledgerUrl);
      let existing = null;
      if (res.ok) {
        existing = await res.json();
      }

      if (!existing || typeof existing !== 'object') {
        existing = {
          opening: 0,
          debit: 0,
          credit: 0,
          closing: 0
        };
      }

      existing.debit = (Number(existing.debit) || 0) + debit;
      existing.credit = (Number(existing.credit) || 0) + credit;
      existing.closing = (Number(existing.opening) || 0) + existing.debit - existing.credit;
      existing.updatedAt = Date.now();

      await fetch(ledgerUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing)
      });

      console.log(`[LEDGER] Updated acc ${acc} bulan ${bulan}: debit+${debit}, credit+${credit}, closing=${existing.closing} (from journal ${journalId})`);
    } catch (err) {
      console.error(`[ACCOUNTING-API] Gagal update ledger acc ${acc} bulan ${bulan}:`, err);
    }
  }
}

/**
 * Helper: Ambil data akun dari Ledger Firebase
 */
async function fetchLedgerAccount(dbUrl, accCode, bulan, apiKey) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  try {
    const res = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${auth}`);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object') {
        return {
          opening: Number(data.opening) || 0,
          debit: Number(data.debit) || 0,
          credit: Number(data.credit) || 0,
          closing: Number(data.closing) || 0
        };
      }
    }
  } catch (e) {
    console.warn(`[ACCOUNTING-API] Gagal fetch ledger acc ${accCode}:`, e.message);
  }
  return { opening: 0, debit: 0, credit: 0, closing: 0 };
}

/**
 * Helper: Hitung ringkasan P&L dan Keuangan langsung dari Ledger Firebase
 */
async function calculateSummaryFromLedger(dbUrl, bulan, apiKey) {
  const accountsToFetch = [
    '401', '402',              // Pendapatan (Penjualan POS, Catering)
    '501',                     // HPP Bahan Baku
    '601', '602', '603', '604', '605', '606', // Beban Operasional
    '101', '102', '103', '105', '111', // Aset / Kas
    '201', '301', '302'        // Kewajiban & Ekuitas
  ];

  const results = await Promise.all(
    accountsToFetch.map(async acc => ({
      acc,
      ledger: await fetchLedgerAccount(dbUrl, acc, bulan, apiKey)
    }))
  );

  const ledgerMap = {};
  results.forEach(r => {
    ledgerMap[r.acc] = r.ledger;
  });

  // 1. PENDAPATAN (Revenue): credit - debit
  const acc401 = ledgerMap['401'] || { debit: 0, credit: 0 };
  const acc402 = ledgerMap['402'] || { debit: 0, credit: 0 };
  const penjualanPos = (acc401.credit || 0) - (acc401.debit || 0);
  const penjualanCatering = (acc402.credit || 0) - (acc402.debit || 0);
  const totalPendapatan = penjualanPos + penjualanCatering;

  // 2. HPP (Harga Pokok Penjualan): debit - credit
  const acc501 = ledgerMap['501'] || { debit: 0, credit: 0 };
  const hppBahanBaku = (acc501.debit || 0) - (acc501.credit || 0);
  const totalHpp = hppBahanBaku;

  // 3. LABA KOTOR
  const labaKotor = totalPendapatan - totalHpp;
  const marginKotor = totalPendapatan > 0 ? (labaKotor / totalPendapatan) * 100 : 0;

  // 4. BEBAN OPERASIONAL (Operating Expenses): debit - credit
  const getExpense = (accCode) => {
    const a = ledgerMap[accCode] || { debit: 0, credit: 0 };
    return (a.debit || 0) - (a.credit || 0);
  };

  const gaji = getExpense('601');
  const sewa = getExpense('602');
  const utilitas = getExpense('603');
  const marketing = getExpense('604');
  const kurir = getExpense('605');
  const penyusutan = getExpense('606');
  const totalBeban = gaji + sewa + utilitas + marketing + kurir + penyusutan;

  // 5. LABA BERSIH
  const labaBersih = labaKotor - totalBeban;
  const marginBersih = totalPendapatan > 0 ? (labaBersih / totalPendapatan) * 100 : 0;

  // 6. STATUS
  const status = labaBersih >= 0 ? 'PROFIT' : 'LOSS';

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
      gaji,
      sewa,
      utilitas,
      marketing,
      kurir,
      penyusutan,
      totalBeban
    },
    labaBersih,
    marginBersih,
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
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // 3. Parse Route Path
  const fullPath = url.pathname.replace(/^\/accounting\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  try {
    // =========================================================================
    // ENDPOINT 1: /accounting/coa (Chart of Accounts)
    // =========================================================================
    if (parts[0] === 'coa') {
      if (method === 'GET') {
        const res = await fetch(`${dbUrl}/accounting/coa.json${authParam}`);
        const data = await res.json();
        const coaResult = data && typeof data === 'object' && Object.keys(data).length > 0 ? data : DEFAULT_COA;
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
          return jsonResponse({ success: true, message: "Bagan akun (COA) berhasil disimpan" }, 200);
        } else {
          return jsonResponse({ success: false, error: "Format data akun tidak valid" }, 400);
        }
      }

      return jsonResponse({ success: false, error: `Metode ${method} tidak diizinkan pada /accounting/coa` }, 405);
    }

    // =========================================================================
    // ENDPOINT 2: /accounting/approvals (Semua Jurnal dari Semua Bulan)
    // =========================================================================
    if (parts[0] === 'approvals') {
      if (method !== 'GET') {
        return jsonResponse({ success: false, error: `Metode ${method} tidak diizinkan pada /accounting/approvals` }, 405);
      }

      const res = await fetch(`${dbUrl}/accounting/journal.json${authParam}`);
      const data = await res.json().catch(() => null);
      let list = [];

      if (data && typeof data === 'object') {
        for (const [bulanKey, monthData] of Object.entries(data)) {
          if (monthData && typeof monthData === 'object') {
            for (const [key, val] of Object.entries(monthData)) {
              if (val && typeof val === 'object') {
                list.push({
                  entryId: key,          // Firebase Key asli
                  bulan: bulanKey,       // YYYY-MM
                  noEntry: val.noEntry || key,
                  ...val
                });
              }
            }
          }
        }
      }

      // Filter status jika diberikan query parameter ?status=...
      const filterStatus = url.searchParams.get('status');
      if (filterStatus) {
        const cleanFilter = filterStatus.trim().toLowerCase();
        list = list.filter(item => (item.status || '').toLowerCase() === cleanFilter);
      }

      // Sort by createdAt DESC (fallback ke field t)
      list.sort((a, b) => {
        const timeA = a.createdAt || a.t || 0;
        const timeB = b.createdAt || b.t || 0;
        return timeB - timeA;
      });

      return jsonResponse({
        success: true,
        count: list.length,
        data: list
      }, 200);
    }

    // =========================================================================
    // ENDPOINT 3: /accounting/journal/{bulan} & /accounting/journal/{bulan}/{identifier}
    // =========================================================================
    if (parts[0] === 'journal' && parts[1]) {
      const bulan = parts[1].trim(); // Format YYYY-MM
      const identifier = parts[2] ? parts[2].trim() : null;

      // 3.1 GET /accounting/journal/{bulan} (List Jurnal Bulan Ini)
      if (method === 'GET' && !identifier) {
        const res = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${authParam}`);
        const data = await res.json().catch(() => null);
        const entries = [];

        if (data && typeof data === 'object') {
          for (const [key, val] of Object.entries(data)) {
            if (val && typeof val === 'object') {
              entries.push({
                entryId: key,
                bulan,
                noEntry: val.noEntry || key,
                ...val
              });
            }
          }
        }

        entries.sort((a, b) => (b.createdAt || b.t || 0) - (a.createdAt || a.t || 0));

        return jsonResponse({
          success: true,
          bulan,
          count: entries.length,
          data: entries
        }, 200);
      }

      // 3.2 POST /accounting/journal/{bulan} (Tambah Jurnal Manual Baru)
      if (method === 'POST' && !identifier) {
        const body = await request.json().catch(() => ({}));

        // Validasi Kategori
        const rawCategory = String(body.category || 'operasional').trim().toLowerCase();
        const category = ALLOWED_CATEGORIES.includes(rawCategory) ? rawCategory : 'operasional';

        // Validasi Deskripsi (min 3 karakter)
        const desc = String(body.desc || '').trim();
        if (desc.length < 3) {
          return jsonResponse({
            success: false,
            error: "Deskripsi transaksi minimal 3 karakter"
          }, 400);
        }

        // Validasi Baris Transaksi
        const rawLines = Array.isArray(body.lines) ? body.lines : [];
        const sanitizedLines = rawLines.map(l => ({
          acc: String(l.acc || '').trim(),
          debit: Math.max(0, Number(l.debit) || 0),
          credit: Math.max(0, Number(l.credit) || 0)
        })).filter(l => l.acc.length >= 1 && (l.debit > 0 || l.credit > 0));

        if (sanitizedLines.length < 2) {
          return jsonResponse({
            success: false,
            error: "Jurnal minimal harus memiliki 2 baris akun yang valid dengan nominal"
          }, 400);
        }

        // Validasi Keseimbangan Double-Entry
        let sumDebit = 0;
        let sumCredit = 0;
        sanitizedLines.forEach(l => {
          sumDebit += l.debit;
          sumCredit += l.credit;
        });

        if (sumDebit <= 0 || Math.abs(sumDebit - sumCredit) > 0.01) {
          return jsonResponse({
            success: false,
            error: `Jurnal tidak balanced: debit=${sumDebit} credit=${sumCredit}`
          }, 400);
        }

        // Generate Nomor Urut (noEntry: JE-YYYY-MM-XXXX) & Firebase Key (entryId: JE-{timestamp})
        const now = new Date();
        const [rawY, rawM] = bulan.split('-');
        const yyyy = rawY || String(now.getFullYear());
        const mm = (rawM || String(now.getMonth() + 1)).padStart(2, '0');

        const countRes = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${authParam}`);
        const currentMonthData = await countRes.json().catch(() => null);
        const currentCount = currentMonthData && typeof currentMonthData === 'object' ? Object.keys(currentMonthData).length : 0;
        const seq = String(currentCount + 1).padStart(4, '0');
        const noEntry = `JE-${yyyy}-${mm}-${seq}`;
        const entryId = "JE-" + Date.now();

        const entryPayload = {
          t: Date.now(),
          noEntry,
          date: body.date || now.toISOString().slice(0, 10),
          desc,
          category,
          ref: String(body.ref || '').trim(),
          lampiran: String(body.lampiran || ''),
          lines: sanitizedLines,
          status: "pending",
          createdBy: String(body.createdBy || "kasir").trim(),
          createdAt: Date.now(),
          approvedBy: null,
          approvedAt: null,
          rejectedReason: null
        };

        // Simpan ke Firebase Realtime Database
        await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entryPayload)
        });

        return jsonResponse({
          success: true,
          entryId,
          noEntry,
          bulan,
          data: entryPayload
        }, 201);
      }

      // 3.3 PATCH /accounting/journal/{bulan}/{identifier} (Approve / Reject / Edit)
      if (method === 'PATCH' && identifier) {
        const body = await request.json().catch(() => ({}));
        const action = String(body.action || '').trim().toLowerCase();

        // Cari Jurnal dengan 3 Level Strategy Fallback
        const found = await findJournalEntry(dbUrl, bulan, identifier, apiKey);
        if (!found || !found.data) {
          return jsonResponse({
            success: false,
            error: `Jurnal tidak ditemukan: ${identifier}`
          }, 404);
        }

        const { firebaseKey, data: currentEntry, bulan: targetBulan } = found;
        let updatedEntry = { ...currentEntry };

        if (action === 'approve') {
          updatedEntry.status = 'approved';
          updatedEntry.approvedBy = String(body.approvedBy || 'Finance / Owner').trim();
          updatedEntry.approvedAt = Date.now();
          updatedEntry.rejectedReason = null;

          // Simpan status approval ke Firebase
          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(targetBulan)}/${encodeURIComponent(firebaseKey)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEntry)
          });

          // Trigger Auto-Update Ledger (Buku Besar) & Summary dalam Try-Catch
          try {
            await updateLedgerAfterApprove(dbUrl, targetBulan, updatedEntry.lines, apiKey, firebaseKey);
            await updateSummaryAfterApprove(dbUrl, targetBulan, apiKey);
          } catch (ledgerErr) {
            console.error('[ACCOUNTING-API] Gagal update ledger post-approval:', ledgerErr);
          }

          return jsonResponse({
            success: true,
            message: `Jurnal ${updatedEntry.noEntry || firebaseKey} berhasil disetujui`,
            entryId: firebaseKey,
            noEntry: updatedEntry.noEntry,
            bulan: targetBulan,
            data: updatedEntry
          }, 200);

        } else if (action === 'reject') {
          updatedEntry.status = 'rejected';
          updatedEntry.rejectedReason = String(body.rejectedReason || 'Ditolak oleh finance').trim();
          updatedEntry.approvedBy = String(body.approvedBy || 'Finance / Owner').trim();
          updatedEntry.rejectedAt = Date.now();

          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(targetBulan)}/${encodeURIComponent(firebaseKey)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEntry)
          });

          return jsonResponse({
            success: true,
            message: `Jurnal ${updatedEntry.noEntry || firebaseKey} berhasil ditolak`,
            entryId: firebaseKey,
            noEntry: updatedEntry.noEntry,
            bulan: targetBulan,
            data: updatedEntry
          }, 200);

        } else if (action === 'edit') {
          if (body.newData && typeof body.newData === 'object') {
            if (body.newData.desc) updatedEntry.desc = String(body.newData.desc).trim();
            if (body.newData.category && ALLOWED_CATEGORIES.includes(body.newData.category)) {
              updatedEntry.category = body.newData.category;
            }
            if (body.newData.ref !== undefined) updatedEntry.ref = String(body.newData.ref).trim();
            if (Array.isArray(body.newData.lines) && body.newData.lines.length >= 2) {
              updatedEntry.lines = body.newData.lines.map(l => ({
                acc: String(l.acc || '').trim(),
                debit: Math.max(0, Number(l.debit) || 0),
                credit: Math.max(0, Number(l.credit) || 0)
              }));
            }
          }

          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(targetBulan)}/${encodeURIComponent(firebaseKey)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEntry)
          });

          return jsonResponse({
            success: true,
            message: `Jurnal ${updatedEntry.noEntry || firebaseKey} berhasil diperbarui`,
            entryId: firebaseKey,
            noEntry: updatedEntry.noEntry,
            bulan: targetBulan,
            data: updatedEntry
          }, 200);

        } else {
          return jsonResponse({
            success: false,
            error: `Action '${action}' tidak valid. Gunakan: approve, reject, atau edit`
          }, 400);
        }
      }
    }

    // =========================================================================
    // ENDPOINT 4: /accounting/ledger/{accCode}/{bulan} (Buku Besar per Akun)
    // =========================================================================
    if (parts[0] === 'ledger' && parts[1] && parts[2]) {
      const accCode = String(parts[1]).trim();
      const bulan = String(parts[2]).trim();

      if (method !== 'GET') {
        return jsonResponse({ success: false, error: `Metode ${method} tidak diizinkan pada /accounting/ledger` }, 405);
      }

      const res = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${authParam}`);
      let ledgerData = await res.json().catch(() => null);

      if (!ledgerData || typeof ledgerData !== 'object') {
        ledgerData = {
          accCode,
          bulan,
          opening: 0,
          debit: 0,
          credit: 0,
          closing: 0
        };
      }

      return jsonResponse({
        success: true,
        accCode,
        bulan,
        data: ledgerData
      }, 200);
    }

    // =========================================================================
    // ENDPOINT 5: /accounting/summary/{bulan} (Ringkasan Laporan Finansial)
    // =========================================================================
    if (parts[0] === 'summary' && parts[1]) {
      const bulan = String(parts[1]).trim();

      if (method !== 'GET') {
        return jsonResponse({ success: false, error: `Metode ${method} tidak diizinkan pada /accounting/summary` }, 405);
      }

      // Hitung langsung dari data ledger terkini di Firebase
      let summary = await calculateSummaryFromLedger(dbUrl, bulan, apiKey);

      // Simpan juga ke cache summary Firebase untuk backup
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
