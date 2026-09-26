/**
 * functions/accounting/rebuild-ledger.js
 * Cloudflare Pages Function — POST /accounting/rebuild-ledger
 * 
 * Rebuild seluruh ledger dari jurnal yang berstatus "approved".
 * - Normalisasi semua kode akun ke 4-digit (fix bug ledger 3-digit vs 4-digit).
 * - Hapus ledger lama, hitung ulang dari jurnal, simpan ke Firebase.
 * 
 * Body: { "bulan": "2026-09" }  (optional — kalau tidak ada, rebuild semua bulan)
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

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

function normalizeAcc(acc) {
  const clean = String(acc || '').trim();
  if (!clean) return '';
  return ACC_MAP_TO_4DIGIT[clean] || clean;
}

function isKreditNormal(acc) {
  // Kewajiban (2), Ekuitas non-Prive (3 kecuali 3003), Pendapatan (4)
  if (acc.startsWith('2')) return true;
  if (acc.startsWith('3') && acc !== '3003') return true;
  if (acc.startsWith('4')) return true;
  return false;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" }
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method !== 'POST') {
    return jsonResponse({ success: false, error: 'Method not allowed. Use POST.' }, 405);
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const auth = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : '';

  const body = await request.json().catch(() => ({}));
  const targetBulan = body.bulan || null;  // null = rebuild semua bulan

  try {
    console.log(`[REBUILD-LEDGER] Start rebuild for bulan: ${targetBulan || 'ALL'}`);

    // 1. Ambil semua jurnal
    const journalUrl = targetBulan
      ? `${dbUrl}/accounting/journal/${encodeURIComponent(targetBulan)}.json${auth}`
      : `${dbUrl}/accounting/journal.json${auth}`;

    const res = await fetch(journalUrl);
    const journalsData = await res.json();

    if (!journalsData || typeof journalsData !== 'object') {
      return jsonResponse({ success: false, error: 'Tidak ada jurnal ditemukan' }, 404);
    }

    // 2. Struktur data: { bulan: { jrnId: entry } } atau { jrnId: entry } (single month)
    const ledger = {};  // { "2026-09": { "1001": { opening, debit, credit, closing } } }

    const allEntries = targetBulan
      ? Object.entries(journalsData).map(([id, v]) => ({ id, bulan: targetBulan, entry: v }))
      : Object.entries(journalsData).flatMap(([bulan, monthData]) =>
          Object.entries(monthData || {}).map(([id, v]) => ({ id, bulan, entry: v }))
        );

    let processed = 0;
    let skipped = 0;

    for (const { id, bulan, entry } of allEntries) {
      if (!entry || entry.status !== 'approved') {
        skipped++;
        continue;
      }

      if (!Array.isArray(entry.lines)) {
        skipped++;
        continue;
      }

      if (!ledger[bulan]) ledger[bulan] = {};

      for (const line of entry.lines) {
        const rawAcc = String(line.acc || line.code || '').trim();
        const acc = normalizeAcc(rawAcc);
        if (!acc) continue;

        const debit = Math.max(0, Number(line.debit) || 0);
        const credit = Math.max(0, Number(line.credit) || 0);
        if (debit === 0 && credit === 0) continue;

        if (!ledger[bulan][acc]) {
          ledger[bulan][acc] = { opening: 0, debit: 0, credit: 0, closing: 0 };
        }

        ledger[bulan][acc].debit += debit;
        ledger[bulan][acc].credit += credit;

        // Hitung closing berdasarkan normal balance
        ledger[bulan][acc].closing = isKreditNormal(acc)
          ? ledger[bulan][acc].opening + ledger[bulan][acc].credit - ledger[bulan][acc].debit
          : ledger[bulan][acc].opening + ledger[bulan][acc].debit - ledger[bulan][acc].credit;
      }

      processed++;
    }

    console.log(`[REBUILD-LEDGER] Processed ${processed} jurnal, skipped ${skipped}. Months:`, Object.keys(ledger));

    // 3. Hapus ledger lama (semua node)
    await fetch(`${dbUrl}/accounting/ledger.json${auth}`, { method: 'DELETE' });

    // 4. Tulis ledger baru
    let writtenCount = 0;
    for (const [bulan, accounts] of Object.entries(ledger)) {
      for (const [acc, data] of Object.entries(accounts)) {
        data.updatedAt = Date.now();
        const writeRes = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(acc)}/${encodeURIComponent(bulan)}.json${auth}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (writeRes.ok) writtenCount++;
      }
    }

    console.log(`[REBUILD-LEDGER] Done. Written ${writtenCount} ledger entries.`);

    return jsonResponse({
      success: true,
      message: `Rebuild selesai. ${processed} jurnal diproses, ${skipped} dilewati, ${writtenCount} ledger entries ditulis.`,
      processed,
      skipped,
      written: writtenCount,
      months: Object.keys(ledger),
      accountCount: Object.values(ledger).reduce((sum, m) => sum + Object.keys(m).length, 0),
      ledgerSnapshot: ledger  // untuk verifikasi
    }, 200);

  } catch (err) {
    console.error('[REBUILD-LEDGER] Error:', err);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}
