/**
 * functions/accounting/[[path]].js
 * Cloudflare Pages Function — Proxy request /accounting/* ke Firebase Realtime Database
 * 
 * VERSI 2.0 — FINAL
 * - Canonical 4-digit account codes (1001, 2001, 3001, dst)
 * - Auto-sync Ledger + Summary dari Journal (untuk semua entry, bukan hanya approved)
 * - Fallback: Summary bisa dihitung langsung dari Journal jika Ledger kosong
 * - Endpoint baru: /accounting/dashboard (ringkasan lengkap)
 * - Robust numeric conversion & error handling
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

// ============================================================================
// STANDAR CHART OF ACCOUNTS — Canonical 4-digit codes
// ============================================================================
const DEFAULT_COA = {
  "1001": { n: "Kas di Tangan (Cash on Hand)", t: "Aset", nb: "Debit" },
  "1002": { n: "Kas di Bank (BCA Operasional)", t: "Aset", nb: "Debit" },
  "1003": { n: "Piutang Usaha / Catering", t: "Aset", nb: "Debit" },
  "1004": { n: "Persediaan Bahan Baku (Stok)", t: "Aset", nb: "Debit" },
  "1005": { n: "Peralatan & Mesin Dapur", t: "Aset", nb: "Debit" },
  "2001": { n: "Hutang Dagang / Supplier", t: "Kewajiban", nb: "Kredit" },
  "2002": { n: "Hutang Beban & Operasional", t: "Kewajiban", nb: "Kredit" },
  "3001": { n: "Modal Pemilik", t: "Ekuitas", nb: "Kredit" },
  "3002": { n: "Laba Ditahan", t: "Ekuitas", nb: "Kredit" },
  "3003": { n: "Prive Pemilik", t: "Ekuitas", nb: "Debit" },
  "4001": { n: "Pendapatan Penjualan POS", t: "Pendapatan", nb: "Kredit" },
  "4002": { n: "Pendapatan Pesanan Catering", t: "Pendapatan", nb: "Kredit" },
  "5001": { n: "Harga Pokok Penjualan (HPP)", t: "Beban", nb: "Debit" },
  "6001": { n: "Beban Gaji Karyawan", t: "Beban", nb: "Debit" },
  "6002": { n: "Beban Sewa Tempat & Outlet", t: "Beban", nb: "Debit" },
  "6003": { n: "Beban Listrik, Air & Gas", t: "Beban", nb: "Debit" },
  "6004": { n: "Beban Marketing & Iklan", t: "Beban", nb: "Debit" },
  "6005": { n: "Beban Operasional & Kurir", t: "Beban", nb: "Debit" }
};

const ALLOWED_CATEGORIES = ['pembelian', 'operasional', 'modal', 'prive', 'penyesuaian', 'pendapatan'];

// Mapping tipe akun (untuk kalkulasi closing yang benar)
const ACCOUNT_TYPES = {
  '1001': 'Aset', '1002': 'Aset', '1003': 'Aset', '1004': 'Aset', '1005': 'Aset',
  '2001': 'Kewajiban', '2002': 'Kewajiban',
  '3001': 'Ekuitas', '3002': 'Ekuitas', '3003': 'Prive',
  '4001': 'Pendapatan', '4002': 'Pendapatan',
  '5001': 'Beban',
  '6001': 'Beban', '6002': 'Beban', '6003': 'Beban', '6004': 'Beban', '6005': 'Beban', '6006': 'Beban'
};

function getAccountType(code) {
  return ACCOUNT_TYPES[normalizeAccCode(code)] || 'Aset';
}

function isDebitNormal(code) {
  const t = getAccountType(code);
  return t === 'Aset' || t === 'Beban' || t === 'Prive';
}

// ============================================================================
// HELPER: Normalisasi kode akun (3-digit ↔ 4-digit)
// ============================================================================
function normalizeAccCode(code) {
  const s = String(code || '').trim();
  if (!s) return '';
  // Mapping 3-digit → 4-digit
  const map3to4 = {
    '101': '1001', '102': '1002', '103': '1003', '105': '1004', '106': '1005',
    '201': '2001', '202': '2002',
    '301': '3001', '302': '3002', '303': '3003',
    '401': '4001', '402': '4002',
    '501': '5001',
    '601': '6001', '602': '6002', '603': '6003', '604': '6004', '605': '6005', '606': '6006'
  };
  if (map3to4[s]) return map3to4[s];
  return s;
}

/**
 * Ambil kedua varian kode (4-digit dan 3-digit) untuk fallback lookup
 */
function getCodeVariants(code) {
  const canonical = normalizeAccCode(code);
  const map4to3 = {
    '1001': '101', '1002': '102', '1003': '103', '1004': '105', '1005': '106',
    '2001': '201', '2002': '202',
    '3001': '301', '3002': '302', '3003': '303',
    '4001': '401', '4002': '402',
    '5001': '501',
    '6001': '601', '6002': '602', '6003': '603', '6004': '604', '6005': '605', '6006': '606'
  };
  const alt = map4to3[canonical];
  return alt ? [canonical, alt] : [canonical];
}

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

// ============================================================================
// HELPER: Baca Ledger akun (dengan fallback 3/4 digit)
// ============================================================================
async function fetchLedgerAccount(dbUrl, accCode, bulan, apiKey) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  const variants = getCodeVariants(accCode);
  const merged = { opening: 0, debit: 0, credit: 0, closing: 0, _variants: [] };

  // MERGE semua varian (1001 & 101, dst) — jangan early return
  for (const code of variants) {
    try {
      const url = `${dbUrl}/accounting/ledger/${encodeURIComponent(code)}/${encodeURIComponent(bulan)}.json${auth}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === 'object') {
        merged.opening += toNum(data.opening);
        merged.debit += toNum(data.debit);
        merged.credit += toNum(data.credit);
        merged._variants.push(code);
      }
    } catch (e) {
      console.warn(`[LEDGER-FETCH] ${code}/${bulan} err:`, e.message);
    }
  }

  // Hitung closing dari opening+mutasi, berdasarkan tipe akun
  if (isDebitNormal(accCode)) {
    merged.closing = merged.opening + merged.debit - merged.credit;
  } else {
    merged.closing = merged.opening + merged.credit - merged.debit;
  }

  return merged;
}
// ============================================================================
// HELPER: Hitung saldo Ledger langsung dari Journal (fallback)
// ============================================================================
async function computeLedgerFromJournal(dbUrl, bulan, apiKey) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  const ledgerMap = {}; // code → {debit, credit}
  try {
    const url = `${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${auth}`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data || typeof data !== 'object') return ledgerMap;
    for (const entry of Object.values(data)) {
      if (!entry || !Array.isArray(entry.lines)) continue;
      for (const line of entry.lines) {
        const code = normalizeAccCode(line.acc || line.code);
        if (!code) continue;
        if (!ledgerMap[code]) ledgerMap[code] = { debit: 0, credit: 0 };
        ledgerMap[code].debit += toNum(line.debit);
        ledgerMap[code].credit += toNum(line.credit);
      }
    }
  } catch (e) {
    console.warn('[LEDGER-FROM-JOURNAL] err:', e.message);
  }
  return ledgerMap;
}

// ============================================================================
// HELPER: Update Ledger setelah jurnal disimpan (idempotent by journalId)
// ============================================================================
async function updateLedgerAfterApprove(dbUrl, bulan, lines, apiKey, journalId) {
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';
  const validLines = Array.isArray(lines) ? lines : [];
  for (const line of validLines) {
    const rawCode = String(line.acc || line.code || '').trim();
    const acc = normalizeAccCode(rawCode);
    if (!acc) continue;

    const debit = Math.max(0, toNum(line.debit));
    const credit = Math.max(0, toNum(line.credit));
    if (debit === 0 && credit === 0) continue;

    try {
      const ledgerUrl = `${dbUrl}/accounting/ledger/${encodeURIComponent(acc)}/${encodeURIComponent(bulan)}.json${auth}`;
      const res = await fetch(ledgerUrl);
      let existing = res.ok ? await res.json() : null;
      if (!existing || typeof existing !== 'object') {
        existing = { opening: 0, debit: 0, credit: 0, closing: 0, entries: {} };
      }
      if (!existing.entries) existing.entries = {};

      // Idempotensi: kalau journalId ini sudah pernah diposting, skip
      if (existing.entries[journalId]) {
        console.log(`[LEDGER] Skip duplicate posting for ${journalId} acc ${acc}`);
        continue;
      }

      existing.debit = toNum(existing.debit) + debit;
      existing.credit = toNum(existing.credit) + credit;
      // Closing: type-aware (Aset/Beban/Prive → debit-normal; sisanya kredit-normal)
      if (isDebitNormal(acc)) {
        existing.closing = toNum(existing.opening) + existing.debit - existing.credit;
      } else {
        existing.closing = toNum(existing.opening) + existing.credit - existing.debit;
      }
      existing.entries[journalId] = { debit, credit, at: Date.now() };
      existing.updatedAt = Date.now();

      await fetch(ledgerUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing)
      });
      console.log(`[LEDGER] Acc ${acc} bulan ${bulan}: +D${debit} +K${credit} → closing ${existing.closing}`);
    } catch (err) {
      console.error(`[LEDGER] Gagal update acc ${acc}:`, err.message);
    }
  }
}

// ============================================================================
// HELPER: Hitung Summary lengkap dari Ledger (dengan fallback dari Journal)
// ============================================================================
async function calculateSummaryFromLedger(dbUrl, bulan, apiKey) {
  // Kumpulkan saldo semua akun yang dibutuhkan
  const codes = ['1001','1002','1003','1004','1005','2001','2002','3001','3002','3003','4001','4002','5001','6001','6002','6003','6004','6005'];
  const ledgers = {};
  await Promise.all(codes.map(async (c) => {
    ledgers[c] = await fetchLedgerAccount(dbUrl, c, bulan, apiKey);
  }));

  // Fallback: kalau SEMUA ledger kosong, hitung dari journal
  const allEmpty = codes.every(c => {
    const l = ledgers[c];
    return toNum(l.debit) === 0 && toNum(l.credit) === 0 && toNum(l.closing) === 0;
  });
  if (allEmpty) {
    console.log('[SUMMARY] Ledger kosong, fallback ke Journal...');
    const fromJournal = await computeLedgerFromJournal(dbUrl, bulan, apiKey);
    for (const c of codes) {
      if (fromJournal[c]) {
        const d = fromJournal[c].debit;
        const k = fromJournal[c].credit;
        ledgers[c] = { opening: 0, debit: d, credit: k, closing: d - k };
      }
    }
  }

  const balance = (c) => toNum(ledgers[c]?.closing);
  const debitBal = (c) => toNum(ledgers[c]?.debit);
  const creditBal = (c) => toNum(ledgers[c]?.credit);

  // === PENDAPATAN ===
  const penjualanPos = creditBal('4001') - debitBal('4001');
  const penjualanCatering = creditBal('4002') - debitBal('4002');
  const totalPendapatan = penjualanPos + penjualanCatering;

  // === HPP ===
  const hppBahanBaku = debitBal('5001') - creditBal('5001');
  const totalHpp = hppBahanBaku;

  // === LABA KOTOR ===
  const labaKotor = totalPendapatan - totalHpp;
  const marginKotor = totalPendapatan > 0 ? Math.round((labaKotor / totalPendapatan) * 10000) / 100 : 0;

  // === BEBAN ===
  const bebanGaji = debitBal('6001') - creditBal('6001');
  const bebanSewa = debitBal('6002') - creditBal('6002');
  const bebanListrik = debitBal('6003') - creditBal('6003');
  const bebanMarketing = debitBal('6004') - creditBal('6004');
  const bebanOperasional = debitBal('6005') - creditBal('6005');
  const totalBeban = bebanGaji + bebanSewa + bebanListrik + bebanMarketing + bebanOperasional;

  // === LABA BERSIH ===
  const labaBersih = labaKotor - totalBeban;
  const marginBersih = totalPendapatan > 0 ? Math.round((labaBersih / totalPendapatan) * 10000) / 100 : 0;

  // === NERACA ===
  const saldoKas = balance('1001');
  const saldoBank = balance('1002');
  const piutang = balance('1003');
  const persediaanAkhir = balance('1004');
  const peralatan = balance('1005');
  const hutangSupplier = balance('2001');
  const hutangBeban = balance('2002');
  const modalPemilik = balance('3001');
  const labaDitahan = balance('3002');
  const prive = balance('3003');

  const totalAsetLancar = saldoKas + saldoBank + piutang + persediaanAkhir;
  const totalAsetTetap = peralatan;
  const totalAset = totalAsetLancar + totalAsetTetap;
  const totalKewajiban = hutangSupplier + hutangBeban;
  const totalEkuitas = modalPemilik + labaDitahan + labaBersih - prive;
  const totalKewajibanEkuitas = totalKewajiban + totalEkuitas;
  const selisihNeraca = totalAset - totalKewajibanEkuitas;

  const status = labaBersih >= 0 ? "PROFIT" : "LOSS";

  console.log(`[SUMMARY] ${bulan}: Rev=${totalPendapatan}, HPP=${totalHpp}, Laba=${labaBersih}, Aset=${totalAset}, Ekuitas=${totalEkuitas}`);

  return {
    periode: bulan,
    pendapatan: { penjualanPos, penjualanCatering, totalPendapatan },
    hpp: { bahanBaku: hppBahanBaku, totalHpp },
    labaKotor,
    marginKotor,
    beban: {
      gaji: bebanGaji, sewa: bebanSewa, utilitas: bebanListrik,
      marketing: bebanMarketing, operasional: bebanOperasional,
      totalBeban
    },
    labaBersih,
    marginBersih,
    pembelianBahanBaku: debitBal('1004'),
    persediaanAkhir,
    saldoKas,
    saldoBank,
    piutang,
    hutangSupplier,
    hutangBeban,
    modalPemilik,
    labaDitahan,
    prive,
    totalAset,
    totalAsetLancar,
    totalAsetTetap,
    totalKewajiban,
    totalEkuitas,
    totalKewajibanEkuitas,
    selisihNeraca,
    status,
    updatedAt: Date.now()
  };
}

// ============================================================================
// HELPER: Simpan cache summary
// ============================================================================
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
    console.error('[SUMMARY-UPDATE] err:', e.message);
    return null;
  }
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  const fullPath = url.pathname.replace(/^\/accounting\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  // Path kosong → serve static accounting.html
  if (parts.length === 0) return context.next();

  try {
    // =======================================================================
    // COA
    // =======================================================================
    if (parts[0] === 'coa') {
      if (method === 'GET') {
        const res = await fetch(`${dbUrl}/accounting/coa.json${authParam}`);
        const data = await res.json();
        const coaResult = data && typeof data === 'object' && Object.keys(data).length > 0 ? data : DEFAULT_COA;
        return jsonResponse({ success: true, data: coaResult });
      }
      if (method === 'POST' || method === 'PUT') {
        const body = await request.json().catch(() => ({}));
        if (body.code && (body.n || body.name)) {
          const code = normalizeAccCode(body.code);
          const coaItem = { n: String(body.n || body.name).trim(), t: body.t || body.type || 'Beban' };
          await fetch(`${dbUrl}/accounting/coa/${code}.json${authParam}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(coaItem)
          });
          return jsonResponse({ success: true, message: `Akun ${code} disimpan`, data: coaItem });
        }
        await fetch(`${dbUrl}/accounting/coa.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        return jsonResponse({ success: true, message: "COA disimpan" });
      }
      return jsonResponse({ success: false, error: "Metode tidak didukung" }, 405);
    }

    // =======================================================================
    // JOURNAL
    // =======================================================================
    if (parts[0] === 'journal') {
      const now = new Date();
      const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const targetBulan = (parts[1] && parts[1].length === 7) ? parts[1] : currentBulan;

      // === GET ===
      if (method === 'GET') {
        if (parts[1] && parts[1].length === 7) {
          const res = await fetch(`${dbUrl}/accounting/journal/${parts[1]}.json${authParam}`);
          const data = await res.json();
          const list = data && typeof data === 'object'
            ? Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }))
            : [];
          return jsonResponse({ success: true, bulan: parts[1], data: list });
        } else if (parts[1]) {
          const res = await fetch(`${dbUrl}/accounting/journal/${targetBulan}.json${authParam}`);
          const data = await res.json();
          if (data && typeof data === 'object') {
            for (const [key, val] of Object.entries(data)) {
              if (key === parts[1] || (val && val.noEntry === parts[1])) {
                return jsonResponse({ success: true, id: key, bulan: targetBulan, data: val });
              }
            }
          }
          return jsonResponse({ success: false, error: `Jurnal ${parts[1]} tidak ditemukan` }, 404);
        } else {
          const res = await fetch(`${dbUrl}/accounting/journal/${currentBulan}.json${authParam}`);
          const data = await res.json();
          const list = data && typeof data === 'object'
            ? Object.entries(data).map(([id, v]) => ({ id, ...(v || {}) }))
            : [];
          return jsonResponse({ success: true, bulan: currentBulan, data: list });
        }
      }

      // === POST — Buat jurnal baru ===
      if (method === 'POST') {
        const body = await request.json().catch(() => ({}));

        const noEntry = String(body.noEntry || body.ref || `JE-${Date.now().toString().slice(-6)}`).trim();
        const dateStr = body.date || body.tgl || new Date().toISOString().split('T')[0];
        const category = String(body.category || 'operasional').toLowerCase();
        const desc = String(body.desc || body.keterangan || '').trim();
        let lines = Array.isArray(body.lines) ? body.lines : [];

        // Fallback: frontend mungkin kirim debitAccount/creditAccount/amount
        if (lines.length === 0 && (body.debitAccount || body.creditAccount)) {
          const amt = toNum(body.amount);
          if (body.debitAccount && body.creditAccount && amt > 0) {
            lines = [
              { acc: body.debitAccount, debit: amt, credit: 0 },
              { acc: body.creditAccount, debit: 0, credit: amt }
            ];
          }
        }

        if (!ALLOWED_CATEGORIES.includes(category)) {
          // tolerate: kalau tidak valid, paksa ke 'operasional'
          console.warn(`[JOURNAL] Kategori '${category}' tidak standar, pakai 'operasional'`);
        }

        if (lines.length < 2) {
          return jsonResponse({ success: false, error: "Entri jurnal minimal 2 baris (Debit & Kredit)" }, 400);
        }

        let totalDebit = 0, totalCredit = 0;
        const sanitizedLines = [];
        for (const line of lines) {
          const acc = normalizeAccCode(line.acc || line.code);
          const debit = Math.max(0, toNum(line.debit));
          const credit = Math.max(0, toNum(line.credit));
          if (!acc) return jsonResponse({ success: false, error: "Setiap baris harus punya kode akun" }, 400);
          totalDebit += debit;
          totalCredit += credit;
          sanitizedLines.push({ acc, debit, credit, desc: line.desc ? String(line.desc).trim() : undefined });
        }

        if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
          return jsonResponse({
            success: false,
            error: `Jurnal tidak balance! Debit: Rp${totalDebit.toLocaleString('id-ID')}, Kredit: Rp${totalCredit.toLocaleString('id-ID')}`
          }, 400);
        }

        const entryMonth = dateStr.substring(0, 7);
        const journalId = body.id || `JRN-${dateStr.replace(/-/g, '')}-${Date.now().toString().slice(-4)}`;
        const finalStatus = body.status || 'approved'; // default langsung approved

        const newEntry = {
          noEntry,
          date: dateStr,
          timestamp: body.timestamp || Date.now(),
          category,
          desc,
          lines: sanitizedLines,
          total: totalDebit,
          status: finalStatus,
          ref: body.ref || noEntry,
          proof: body.proof || body.proofImage || '',
          debitCode: sanitizedLines.find(l => l.debit > 0)?.acc,
          creditCode: sanitizedLines.find(l => l.credit > 0)?.acc,
          debitAmount: sanitizedLines.find(l => l.debit > 0)?.debit,
          creditAmount: sanitizedLines.find(l => l.credit > 0)?.credit,
          createdAt: Date.now()
        };

        await fetch(`${dbUrl}/accounting/journal/${entryMonth}/${journalId}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEntry)
        });

        // ✅ SELALU update ledger & summary (idempotent)
        await updateLedgerAfterApprove(dbUrl, entryMonth, sanitizedLines, apiKey, journalId);
        await updateSummaryAfterApprove(dbUrl, entryMonth, apiKey);

        return jsonResponse({
          success: true,
          message: `Entri ${noEntry} berhasil disimpan`,
          id: journalId,
          bulan: entryMonth,
          data: newEntry
        }, 201);
      }

      // === PATCH/PUT /accounting/journal/{bulan}/{id}/approve ===
      if (method === 'PATCH' || method === 'PUT') {
        const bulanFromUrl = (parts[1] && parts[1].length === 7) ? parts[1] : currentBulan;
        const identifier = (parts[1] && parts[1].length === 7) ? parts[2] : parts[1];

        // Ambil existing
        let firebaseKey = null, entryData = null, entryBulan = bulanFromUrl;
        const res = await fetch(`${dbUrl}/accounting/journal/${bulanFromUrl}.json${authParam}`);
        const all = await res.json();
        if (all && typeof all === 'object') {
          for (const [k, v] of Object.entries(all)) {
            if (k === identifier || (v && v.noEntry === identifier)) {
              firebaseKey = k; entryData = v; break;
            }
          }
        }
        if (!entryData) return jsonResponse({ success: false, error: `Jurnal ${identifier} tidak ditemukan` }, 404);

        const updatedData = { ...entryData, status: 'approved', approvedAt: Date.now() };
        await fetch(`${dbUrl}/accounting/journal/${entryBulan}/${firebaseKey}.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedData)
        });
        await updateLedgerAfterApprove(dbUrl, entryBulan, entryData.lines, apiKey, firebaseKey);
        await updateSummaryAfterApprove(dbUrl, entryBulan, apiKey);
        return jsonResponse({ success: true, message: `Jurnal ${identifier} di-approve`, data: updatedData });
      }

      // === DELETE ===
      if (method === 'DELETE' && parts[1]) {
        const bulanFromUrl = (parts[1] && parts[1].length === 7) ? parts[1] : currentBulan;
        const identifier = (parts[1] && parts[1].length === 7) ? parts[2] : parts[1];
        const res = await fetch(`${dbUrl}/accounting/journal/${bulanFromUrl}.json${authParam}`);
        const all = await res.json();
        if (all && typeof all === 'object') {
          for (const [k, v] of Object.entries(all)) {
            if (k === identifier || (v && v.noEntry === identifier)) {
              await fetch(`${dbUrl}/accounting/journal/${bulanFromUrl}/${k}.json${authParam}`, { method: 'DELETE' });
              return jsonResponse({ success: true, message: `Jurnal ${identifier} dihapus` });
            }
          }
        }
        return jsonResponse({ success: false, error: `Jurnal ${identifier} tidak ditemukan` }, 404);
      }
    }

    // =======================================================================
    // LEDGER
    // =======================================================================
    if (parts[0] === 'ledger') {
      const now = new Date();
      const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const accCode = normalizeAccCode(parts[1]);
      const bulan = parts[2] || currentBulan;

      if (method === 'GET') {
        if (accCode) {
          const data = await fetchLedgerAccount(dbUrl, accCode, bulan, apiKey);
          return jsonResponse({ success: true, acc: accCode, bulan, data });
        }
        const res = await fetch(`${dbUrl}/accounting/ledger.json${authParam}`);
        const all = await res.json();
        const ledgerMonth = {};
        if (all && typeof all === 'object') {
          for (const [code, months] of Object.entries(all)) {
            if (months && months[bulan]) ledgerMonth[normalizeAccCode(code)] = months[bulan];
          }
        }
        return jsonResponse({ success: true, bulan, data: ledgerMonth });
      }

      if ((method === 'POST' || method === 'PUT') && accCode) {
        const body = await request.json().catch(() => ({}));
        const existing = await fetchLedgerAccount(dbUrl, accCode, bulan, apiKey);
        const opening = body.opening !== undefined ? toNum(body.opening) : toNum(existing.opening);
        const debit = body.debit !== undefined ? toNum(body.debit) : toNum(existing.debit);
        const credit = body.credit !== undefined ? toNum(body.credit) : toNum(existing.credit);
        const closing = opening + debit - credit;
        const payload = { opening, debit, credit, closing, updatedAt: Date.now() };
        await fetch(`${dbUrl}/accounting/ledger/${accCode}/${bulan}.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        await updateSummaryAfterApprove(dbUrl, bulan, apiKey);
        return jsonResponse({ success: true, message: `Ledger ${accCode}/${bulan} diperbarui`, data: payload });
      }
    }

    // =======================================================================
    // SUMMARY
    // =======================================================================
    if (parts[0] === 'summary') {
      const now = new Date();
      const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const bulan = parts[1] || currentBulan;

      const summary = await calculateSummaryFromLedger(dbUrl, bulan, apiKey);

      // Cache
      try {
        await fetch(`${dbUrl}/accounting/summary/${bulan}.json${authParam}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(summary)
        });
      } catch (e) { /* silent */ }

      return jsonResponse({ success: true, data: summary });
    }

    // =======================================================================
    // DASHBOARD (alias summary)
    // =======================================================================
    if (parts[0] === 'dashboard') {
      const now = new Date();
      const bulan = parts[1] || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const summary = await calculateSummaryFromLedger(dbUrl, bulan, apiKey);
      return jsonResponse({ success: true, data: summary });
    }

    // =======================================================================
    // APPROVALS (list jurnal draft)
    // =======================================================================
    if (parts[0] === 'approvals') {
      const now = new Date();
      const bulan = parts[1] || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`${dbUrl}/accounting/journal/${bulan}.json${authParam}`);
      const data = await res.json();
      const list = data && typeof data === 'object'
        ? Object.entries(data)
            .map(([id, v]) => ({ id, ...(v || {}) }))
            .filter(j => j.status !== 'approved')
        : [];
      return jsonResponse({ success: true, bulan, data: list });
    }

    // =======================================================================
    // REBUILD LEDGER — hapus ledger lama & rebuild dari journals
    // GET /accounting/rebuild-ledger/{bulan}
    // ⚠️ Jalankan SEKALI saja untuk cleanup data lama
    // =======================================================================
    if (parts[0] === 'rebuild-ledger') {
      const now = new Date();
      const bulan = parts[1] || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      console.log(`[REBUILD] Mulai rebuild ledger untuk ${bulan}...`);

      const report = { bulan, deleted: [], journalsRebuilt: 0, errors: [] };

      // 1. Hapus semua ledger bulan ini (baik 3-digit maupun 4-digit)
      try {
        const allLedgerRes = await fetch(`${dbUrl}/accounting/ledger.json${authParam}`);
        const allLedger = await allLedgerRes.json();
        if (allLedger && typeof allLedger === 'object') {
          for (const code of Object.keys(allLedger)) {
            if (allLedger[code] && allLedger[code][bulan]) {
              const delRes = await fetch(
                `${dbUrl}/accounting/ledger/${encodeURIComponent(code)}/${encodeURIComponent(bulan)}.json${authParam}`,
                { method: 'DELETE' }
              );
              if (delRes.ok) {
                report.deleted.push(code);
                console.log(`[REBUILD] ✅ Hapus ledger ${code}/${bulan}`);
              } else {
                report.errors.push(`Gagal hapus ledger ${code}: HTTP ${delRes.status}`);
              }
            }
          }
        }
      } catch (e) {
        report.errors.push(`Scan ledger error: ${e.message}`);
      }

      // 2. Baca semua jurnal bulan ini & posting ulang ke ledger
      try {
        const jRes = await fetch(`${dbUrl}/accounting/journal/${bulan}.json${authParam}`);
        const journals = await jRes.json();

        if (journals && typeof journals === 'object') {
          for (const [jid, entry] of Object.entries(journals)) {
            if (!entry || !Array.isArray(entry.lines)) continue;
            if (entry.status === 'rejected') continue;
            try {
              await updateLedgerAfterApprove(dbUrl, bulan, entry.lines, apiKey, jid);
              report.journalsRebuilt++;
              console.log(`[REBUILD] ✅ Posting ulang jurnal ${jid} (${entry.noEntry || '-'})`);
            } catch (e) {
              report.errors.push(`Posting ${jid} error: ${e.message}`);
            }
          }
        }
      } catch (e) {
        report.errors.push(`Scan journal error: ${e.message}`);
      }

      // 3. Refresh summary — non-critical, tapi log error-nya
      let newSummary = null;
      try {
        newSummary = await calculateSummaryFromLedger(dbUrl, bulan, apiKey);
        // Simpan ke cache (fire-and-forget, tidak block response)
        fetch(`${dbUrl}/accounting/summary/${encodeURIComponent(bulan)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSummary)
        }).catch(e => console.warn('[REBUILD] Cache save skipped:', e.message));
      } catch (e) {
        report.errors.push(`Summary calculation warning: ${e.message} (dashboard tetap OK karena /summary dihitung fresh)`);
        console.error('[REBUILD] Summary calc error:', e);
      }

      return jsonResponse({
        success: true,
        message: `Rebuild selesai. ${report.journalsRebuilt} jurnal diposting ulang, ${report.deleted.length} ledger lama dihapus.`,
        ...report,
        summary: newSummary
      });
    }

    return jsonResponse({ success: false, error: `Endpoint /accounting/${fullPath} tidak ditemukan` }, 404);

  } catch (err) {
    console.error('[ACCOUNTING-API] Exception:', err);
    return jsonResponse({ success: false, error: err.message || "Internal server error" }, 500);
  }
}
