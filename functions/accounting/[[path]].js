/**
 * functions/accounting/[[path]].js
 * Cloudflare Pages Function — Proxy request /accounting/* ke Firebase Realtime Database
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const method = request.method;

  // Header CORS untuk preflight dan respons API
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Konfigurasi URL Firebase Realtime Database & API Key
  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // Ekstrak path setelah /accounting/
  const fullPath = url.pathname.replace(/^\/accounting\/?/, '');
  const parts = fullPath.split('/').filter(Boolean);

  // Default Chart of Accounts jika belum diinisialisasi di Firebase
  const defaultCOA = {
    "101": { n: "Kas di Tangan", t: "asset" },
    "102": { n: "Bank", t: "asset" },
    "103": { n: "Piutang", t: "asset" },
    "105": { n: "Persediaan Bahan Baku", t: "asset" },
    "111": { n: "Akum. Penyusutan", t: "asset" },
    "201": { n: "Hutang Supplier", t: "liability" },
    "301": { n: "Modal Pemilik", t: "equity" },
    "302": { n: "Prive", t: "equity" },
    "401": { n: "Pendapatan Penjualan", t: "revenue" },
    "402": { n: "Pendapatan Catering", t: "revenue" },
    "501": { n: "HPP", t: "expense" },
    "601": { n: "Beban Gaji", t: "expense" },
    "602": { n: "Beban Sewa", t: "expense" },
    "603": { n: "Beban Listrik & Air", t: "expense" },
    "604": { n: "Beban Marketing", t: "expense" },
    "605": { n: "Beban Kurir", t: "expense" },
    "606": { n: "Beban Penyusutan", t: "expense" }
  };

  try {
    // -------------------------------------------------------------
    // 1. GET & POST /accounting/coa (Chart of Accounts)
    // -------------------------------------------------------------
    if (parts[0] === 'coa') {
      if (method === 'GET') {
        const res = await fetch(`${dbUrl}/accounting/coa.json${authParam}`);
        const data = await res.json();
        return new Response(JSON.stringify({ 
          success: true, 
          data: data && Object.keys(data).length > 0 ? data : defaultCOA 
        }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      if (method === 'POST' || method === 'PUT') {
        const body = await request.json();
        if (body.code && body.n) {
          // Tambah atau edit satu akun COA
          await fetch(`${dbUrl}/accounting/coa/${encodeURIComponent(body.code)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ n: body.n, t: body.t || 'expense' })
          });
          return new Response(JSON.stringify({ success: true, message: `Akun ${body.code} berhasil disimpan` }), {
            headers: { ...cors, "Content-Type": "application/json" }
          });
        } else {
          // Simpan seluruh bagan akun sekaligus
          await fetch(`${dbUrl}/accounting/coa.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          return new Response(JSON.stringify({ success: true, message: "Bagan akun (COA) berhasil disimpan" }), {
            headers: { ...cors, "Content-Type": "application/json" }
          });
        }
      }
    }

    // -------------------------------------------------------------
    // 2. GET /accounting/approvals (Semua jurnal butuh approval)
    // -------------------------------------------------------------
    if (parts[0] === 'approvals' && method === 'GET') {
      const res = await fetch(`${dbUrl}/accounting/journal.json${authParam}`);
      const data = await res.json();
      const approvals = [];

      if (data && typeof data === 'object') {
        // Format di Firebase: /accounting/journal/{YYYY-MM}/{entryId}
        Object.entries(data).forEach(([bulanKey, monthEntries]) => {
          if (monthEntries && typeof monthEntries === 'object') {
            Object.entries(monthEntries).forEach(([entryId, entry]) => {
              if (entry && typeof entry === 'object') {
                approvals.push({
                  entryId,
                  bulan: bulanKey,
                  ...entry
                });
              }
            });
          }
        });
      }

      // Urutkan dari yang terbaru
      approvals.sort((a, b) => (b.createdAt || b.t || 0) - (a.createdAt || a.t || 0));

      return new Response(JSON.stringify({ 
        success: true, 
        count: approvals.length, 
        data: approvals 
      }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // -------------------------------------------------------------
    // 3. /accounting/journal/{bulan} & /accounting/journal/{bulan}/{entryId}
    // -------------------------------------------------------------
    if (parts[0] === 'journal' && parts[1]) {
      const bulan = parts[1]; // Format: YYYY-MM
      const entryId = parts[2]; // Opsional untuk single entry

      // GET /accounting/journal/{bulan}
      if (method === 'GET' && !entryId) {
        const res = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${authParam}`);
        const data = await res.json();
        const entries = [];
        if (data && typeof data === 'object') {
          Object.entries(data).forEach(([id, val]) => {
            if (val && typeof val === 'object') {
              entries.push({ entryId: id, bulan, ...val });
            }
          });
        }
        entries.sort((a, b) => (b.createdAt || b.t || 0) - (a.createdAt || a.t || 0));
        return new Response(JSON.stringify({ success: true, bulan, data: entries }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      // POST /accounting/journal/{bulan} (Tambah jurnal manual baru)
      if (method === 'POST' && !entryId) {
        const body = await request.json();
        const lines = Array.isArray(body.lines) ? body.lines : [];

        // 1. Validasi minimal 2 baris
        if (lines.length < 2) {
          return new Response(JSON.stringify({ success: false, error: "Jurnal minimal harus memiliki 2 baris transaksi" }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" }
          });
        }

        // 2. Validasi Double-Entry Balance
        let totalDebit = 0;
        let totalCredit = 0;
        for (const l of lines) {
          totalDebit += Number(l.debit) || 0;
          totalCredit += Number(l.credit) || 0;
        }

        if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
          return new Response(JSON.stringify({ 
            success: false, 
            error: `Total debit (${totalDebit}) dan kredit (${totalCredit}) harus seimbang dan > 0` 
          }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" }
          });
        }

        // 3. Generate Sequence dan No. Entry: JE-YYYY-MM-XXXX
        const now = new Date();
        const [yyyy, mm] = bulan.split('-');
        const countRes = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${authParam}`);
        const currentMonthData = await countRes.json();
        const currentCount = currentMonthData && typeof currentMonthData === 'object' ? Object.keys(currentMonthData).length : 0;
        const seq = String(currentCount + 1).padStart(4, '0');
        const noEntry = `JE-${yyyy || now.getFullYear()}-${mm || String(now.getMonth() + 1).padStart(2, '0')}-${seq}`;

        const newEntryId = "JE-" + Date.now();
        const entryPayload = {
          t: Date.now(),
          noEntry,
          date: body.date || now.toISOString().slice(0, 10),
          desc: (body.desc || '').trim(),
          category: body.category || 'operasional',
          ref: body.ref || '',
          lampiran: body.lampiran || '',
          lines: lines.map(l => ({
            acc: String(l.acc || '').trim(),
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0
          })),
          status: "pending",
          createdBy: body.createdBy || "kasir",
          createdAt: Date.now(),
          approvedBy: null,
          approvedAt: null,
          rejectedReason: null
        };

        await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(newEntryId)}.json${authParam}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entryPayload)
        });

        return new Response(JSON.stringify({ 
          success: true, 
          entryId: newEntryId, 
          noEntry, 
          data: entryPayload 
        }), {
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      // PATCH /accounting/journal/{bulan}/{entryId} (Approve / Reject / Edit)
      if (method === 'PATCH' && entryId) {
        const body = await request.json();
        const action = body.action; // "approve" | "reject" | "edit"

        // Ambil data jurnal saat ini
        const entryRes = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${authParam}`);
        const currentEntry = await entryRes.json();

        if (!currentEntry) {
          return new Response(JSON.stringify({ success: false, error: "Jurnal tidak ditemukan" }), {
            status: 404,
            headers: { ...cors, "Content-Type": "application/json" }
          });
        }

        let updatedEntry = { ...currentEntry };

        if (action === 'approve') {
          updatedEntry.status = "approved";
          updatedEntry.approvedBy = body.approvedBy || "Finance / Owner";
          updatedEntry.approvedAt = Date.now();
          updatedEntry.rejectedReason = null;

          // Simpan status approve ke Firebase
          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEntry)
          });

          // AUTO-UPDATE LEDGER & SUMMARY
          await updateLedgerAndSummary(dbUrl, authParam, bulan, entryId, updatedEntry);

          return new Response(JSON.stringify({ 
            success: true, 
            message: `Jurnal ${updatedEntry.noEntry} berhasil disetujui dan buku besar diperbarui`,
            entryId, 
            data: updatedEntry 
          }), {
            headers: { ...cors, "Content-Type": "application/json" }
          });
        } else if (action === 'reject') {
          updatedEntry.status = "rejected";
          updatedEntry.rejectedReason = body.rejectedReason || "Ditolak oleh finance";
          updatedEntry.rejectedAt = Date.now();

          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEntry)
          });

          return new Response(JSON.stringify({ 
            success: true, 
            message: `Jurnal ${updatedEntry.noEntry} berhasil ditolak`,
            entryId, 
            data: updatedEntry 
          }), {
            headers: { ...cors, "Content-Type": "application/json" }
          });
        } else if (action === 'edit') {
          // Edit field yang diizinkan
          if (body.newData) {
            updatedEntry.desc = body.newData.desc || updatedEntry.desc;
            updatedEntry.category = body.newData.category || updatedEntry.category;
            updatedEntry.ref = body.newData.ref !== undefined ? body.newData.ref : updatedEntry.ref;
            if (Array.isArray(body.newData.lines)) {
              updatedEntry.lines = body.newData.lines;
            }
          }
          await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${authParam}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedEntry)
          });

          return new Response(JSON.stringify({ 
            success: true, 
            message: `Jurnal ${updatedEntry.noEntry} berhasil diperbarui`,
            entryId, 
            data: updatedEntry 
          }), {
            headers: { ...cors, "Content-Type": "application/json" }
          });
        } else {
          return new Response(JSON.stringify({ success: false, error: `Action '${action}' tidak valid` }), {
            status: 400,
            headers: { ...cors, "Content-Type": "application/json" }
          });
        }
      }
    }

    // -------------------------------------------------------------
    // 4. GET /accounting/ledger/{accCode}/{bulan} (Buku Besar)
    // -------------------------------------------------------------
    if (parts[0] === 'ledger' && parts[1] && parts[2]) {
      const accCode = parts[1];
      const bulan = parts[2];

      const res = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${authParam}`);
      let ledgerData = await res.json();

      // Jika belum ada record tersimpan, buat kalkulasi dinamis dari jurnal bulan terkait
      if (!ledgerData) {
        ledgerData = await computeDynamicLedger(dbUrl, authParam, accCode, bulan);
      }

      return new Response(JSON.stringify({ success: true, accCode, bulan, data: ledgerData }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // -------------------------------------------------------------
    // 5. GET /accounting/summary/{bulan} (Ringkasan P&L, Arus Kas, Neraca)
    // -------------------------------------------------------------
    if (parts[0] === 'summary' && parts[1]) {
      const bulan = parts[1];
      const res = await fetch(`${dbUrl}/accounting/summary/${encodeURIComponent(bulan)}.json${authParam}`);
      let summary = await res.json();

      if (!summary) {
        summary = await computeDynamicSummary(dbUrl, authParam, bulan, defaultCOA);
      }

      return new Response(JSON.stringify({ success: true, bulan, data: summary }), {
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ success: false, error: `Route /accounting/${fullPath} tidak ditemukan` }), {
      status: 404,
      headers: { ...cors, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message || "Terjadi kesalahan server" }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}

/**
 * AUTO-UPDATE LEDGER & SUMMARY KETIKA JURNAL DI-APPROVE
 */
async function updateLedgerAndSummary(dbUrl, authParam, bulan, entryId, entry) {
  try {
    const lines = Array.isArray(entry.lines) ? entry.lines : [];
    
    // 1. Update setiap akun yang ada di baris jurnal
    for (const line of lines) {
      const accCode = String(line.acc || '').trim();
      if (!accCode) continue;

      const ledgerRes = await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${authParam}`);
      let ledger = await ledgerRes.json();
      if (!ledger || typeof ledger !== 'object') {
        ledger = {
          accCode,
          bulan,
          opening: 0,
          totalDebit: 0,
          totalCredit: 0,
          closing: 0,
          entries: []
        };
      }

      if (!Array.isArray(ledger.entries)) {
        ledger.entries = [];
      }

      // Hindari duplikasi baris transaksi yang sama
      const exists = ledger.entries.some(e => e.entryId === entryId);
      if (!exists) {
        ledger.entries.push({
          entryId,
          noEntry: entry.noEntry,
          date: entry.date,
          desc: entry.desc,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          t: entry.t || Date.now()
        });
      }

      // Hitung ulang debit, kredit, dan closing balance
      let sumDebit = 0;
      let sumCredit = 0;
      for (const item of ledger.entries) {
        sumDebit += Number(item.debit) || 0;
        sumCredit += Number(item.credit) || 0;
      }
      ledger.totalDebit = sumDebit;
      ledger.totalCredit = sumCredit;
      ledger.closing = (Number(ledger.opening) || 0) + sumDebit - sumCredit;
      ledger.updatedAt = Date.now();

      await fetch(`${dbUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ledger)
      });
    }

    // 2. Update Ringkasan Laporan (P&L, Neraca, Arus Kas)
    await computeDynamicSummary(dbUrl, authParam, bulan);
  } catch (err) {
    console.error("Gagal auto-update ledger:", err);
  }
}

/**
 * Kalkulasi Buku Besar Dinamis dari Jurnal
 */
async function computeDynamicLedger(dbUrl, authParam, accCode, bulan) {
  try {
    const res = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${authParam}`);
    const data = await res.json();
    const entries = [];
    let totalDebit = 0;
    let totalCredit = 0;

    if (data && typeof data === 'object') {
      Object.entries(data).forEach(([eId, j]) => {
        if (j && j.status === 'approved' && Array.isArray(j.lines)) {
          j.lines.forEach(l => {
            if (String(l.acc) === String(accCode)) {
              const d = Number(l.debit) || 0;
              const c = Number(l.credit) || 0;
              totalDebit += d;
              totalCredit += c;
              entries.push({
                entryId: eId,
                noEntry: j.noEntry,
                date: j.date,
                desc: j.desc,
                debit: d,
                credit: c,
                t: j.t || Date.now()
              });
            }
          });
        }
      });
    }

    return {
      accCode,
      bulan,
      opening: 0,
      totalDebit,
      totalCredit,
      closing: totalDebit - totalCredit,
      entries
    };
  } catch (e) {
    return { accCode, bulan, opening: 0, totalDebit: 0, totalCredit: 0, closing: 0, entries: [] };
  }
}

/**
 * Kalkulasi Ringkasan Keuangan (Laba Rugi, Neraca, Arus Kas)
 */
async function computeDynamicSummary(dbUrl, authParam, bulan, coaRef) {
  try {
    const jRes = await fetch(`${dbUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${authParam}`);
    const jData = await jRes.json();

    let revenue = 0;
    let hpp = 0;
    let expense = 0;
    let cashIn = 0;
    let cashOut = 0;

    if (jData && typeof jData === 'object') {
      Object.values(jData).forEach(entry => {
        if (entry && entry.status === 'approved' && Array.isArray(entry.lines)) {
          entry.lines.forEach(l => {
            const acc = String(l.acc);
            const d = Number(l.debit) || 0;
            const c = Number(l.credit) || 0;

            // 4xx: Pendapatan (Kredit menambah pendapatan)
            if (acc.startsWith('4')) {
              revenue += (c - d);
            }
            // 5xx: HPP (Debit menambah HPP)
            else if (acc.startsWith('5')) {
              hpp += (d - c);
            }
            // 6xx: Beban Operasional (Debit menambah beban)
            else if (acc.startsWith('6')) {
              expense += (d - c);
            }
            // 101/102: Kas & Bank (Arus Kas)
            if (acc === '101' || acc === '102') {
              cashIn += d;
              cashOut += c;
            }
          });
        }
      });
    }

    const grossProfit = revenue - hpp;
    const netProfit = grossProfit - expense;
    const netCashFlow = cashIn - cashOut;

    const summary = {
      bulan,
      revenue,
      hpp,
      grossProfit,
      expense,
      netProfit,
      cashIn,
      cashOut,
      netCashFlow,
      updatedAt: Date.now()
    };

    // Simpan cache summary ke Firebase
    await fetch(`${dbUrl}/accounting/summary/${encodeURIComponent(bulan)}.json${authParam}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary)
    });

    return summary;
  } catch (e) {
    return {
      bulan,
      revenue: 0,
      hpp: 0,
      grossProfit: 0,
      expense: 0,
      netProfit: 0,
      cashIn: 0,
      cashOut: 0,
      netCashFlow: 0
    };
  }
}
