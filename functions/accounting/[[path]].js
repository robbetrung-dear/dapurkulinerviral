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
      // Normal balance: Kewajiban (2), Modal/Ekuitas (3 non-prive), Pendapatan (4) bertambah di Kredit
      // Aset (1), Prive (302/3002/3003), HPP (5), Beban (6) bertambah di Debit
      const isKreditNormal = acc.startsWith('2') || (acc.startsWith('3') && acc !== '302' && acc !== '3002' && acc !== '3003') || acc.startsWith('4');
      if (isKreditNormal) {
        existing.closing = (Number(existing.opening) || 0) + existing.credit - existing.debit;
      } else {
        existing.closing = (Number(existing.opening) || 0) + existing.debit - existing.credit;
      }
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
    const url = `${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${auth}`;
    const res = await fetch(url);
    let data = await res.json();
    if (!data && accCode.length === 3) {
      const altCode = accCode === '101' ? '1001' : accCode === '102' ? '1002' : accCode === '103' ? '1003' : accCode === '105' ? '1004' : accCode === '201' ? '2001' : accCode === '301' ? '3001' : accCode === '401' ? '4001' : accCode === '402' ? '4002' : accCode === '501' ? '5001' : accCode === '601' ? '6001' : null;
      if (altCode) {
        const altRes = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(altCode)}/${encodeURIComponent(bulan)}.json${auth}`);
        data = await altRes.json();
      }
    } else if (!data && accCode.length === 4) {
      const altCode = accCode === '1001' ? '101' : accCode === '1002' ? '102' : accCode === '1003' ? '103' : accCode === '1004' ? '105' : accCode === '2001' ? '201' : null;
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
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
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

        // Tentukan Partition Bulan berdasarkan tanggal (YYYY-MM)
        const entryMonth = dateStr.substring(0, 7);
        const journalId = `JRN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;

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

      // PATCH /accounting/journal/:bulan/:entryId ATAU /accounting/journal/:entryId/approve
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

        const action = body.action || (parts[2] === 'approve' || parts[3] === 'approve' ? 'approve' : 'approve');
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
        } else {
          return jsonResponse({ success: false, error: `Action '${action}' tidak valid` }, 400);
        }
      }

      // DELETE /accounting/journal/{identifier}
      if (method === 'DELETE' && parts[1]) {
        const found = await findJournalEntry(dbUrl, targetBulan, parts[1], apiKey);
        if (!found) {
          return jsonResponse({ success: false, error: `Jurnal '${parts[1]}' tidak ditemukan untuk dihapus` }, 404);
        }

        await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(found.bulan)}/${encodeURIComponent(found.firebaseKey)}.json${authParam}`, {
          method: 'DELETE'
        });

        return jsonResponse({ success: true, message: `Jurnal ${parts[1]} berhasil dihapus` }, 200);
      }
    }

    // =========================================================================
    // ENDPOINT 3: /accounting/ledger (Buku Besar)
    // =========================================================================
    if (parts[0] === 'ledger') {
      const now = new Date();
      const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const accCode = parts[1];
      const bulan = parts[2] || currentBulan;

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
        const closing = opening + debit - credit;

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
