/**
 * ============================================================================
 * Cloudflare Pages Function & Node.js API: /functions/report-pl.js
 * ============================================================================
 * FUNGSI: Menghasilkan Laporan Laba Rugi (Profit & Loss / Income Statement)
 *         Bulanan standar akuntansi F&B. Mengambil data buku besar ledger
 *         dari Firebase Realtime Database (atau in-memory mock), mengkalkulasi
 *         Pendapatan, HPP, Laba Kotor, Biaya Operasional, dan Laba Bersih,
 *         serta menghasilkan dokumen PDF A4 (Base64) + data JSON terstruktur.
 *
 * ENDPOINT: POST /report-pl (dan /api/report-pl)
 *
 * BODY REQUEST:
 * {
 *   "bulan": "2026-09",        // YYYY-MM
 *   "kasirName": "Budi Kasir", // Nama kasir/akuntan untuk footer (opsional)
 *   "includeCharts": false     // (opsional)
 * }
 *
 * RESPONSE (STATUS 200):
 * {
 *   "success": true,
 *   "pdfBase64": "data:application/pdf;base64,...",
 *   "data": {
 *     "periode": "2026-09",
 *     "periodeText": "September 2026",
 *     "pendapatan": {
 *       "penjualanPos": 45000000,
 *       "penjualanCatering": 15000000,
 *       "totalPendapatan": 60000000
 *     },
 *     "hpp": {
 *       "bahanBaku": 24000000,
 *       "totalHpp": 24000000
 *     },
 *     "labaKotor": 36000000,
 *     "marginKotor": 60.0,
 *     "beban": {
 *       "gaji": 12000000,
 *       "sewa": 3500000,
 *       "utilitas": 1800000,
 *       "marketing": 1200000,
 *       "kurir": 900000,
 *       "totalBeban": 19400000
 *     },
 *     "labaBersih": 16600000,
 *     "marginBersih": 27.67,
 *     "status": "PROFIT"
 *   },
 *   "generatedAt": "2026-09-18T09:30:00.000Z"
 * }
 * ============================================================================
 */

// ============================================================================
// 1. DATA DEFAULT PROFIL TOKO & OUTLET
// ============================================================================
const DEFAULT_COMPANY_SETTINGS = {
  name: "DAPUR KULINER VIRAL",
  tagline: "Spesialis Masakan Nusantara & Catering",
  address: "Jl. Boulevard Raya Blok A No. 12, Kelapa Gading, Jakarta Utara",
  phone: "0812-8888-9999",
  npwp: "98.765.432.1-012.000"
};

// ============================================================================
// 2. HELPER FORMATTING & MAPPING NAMA BULAN
// ============================================================================

const NAMA_BULAN_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

/**
 * Format string "2026-09" menjadi "September 2026"
 */
function formatPeriodeIndo(periodeStr) {
  if (!periodeStr || typeof periodeStr !== 'string') return "Periode Berjalan";
  const parts = periodeStr.split('-');
  if (parts.length < 2) return periodeStr;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const monthName = (monthIdx >= 0 && monthIdx < 12) ? NAMA_BULAN_ID[monthIdx] : parts[1];
  return `${monthName} ${year}`;
}

/**
 * Format angka ke string Rupiah Indonesia (contoh: 25000000 -> "Rp 25.000.000")
 */
function formatRupiah(num) {
  const val = Math.round(Number(num) || 0);
  const isNeg = val < 0;
  const absVal = Math.abs(val);
  const str = absVal.toLocaleString('id-ID');
  return isNeg ? `(Rp ${str})` : `Rp ${str}`;
}

/**
 * Helper escape karakter khusus PDF string literal: ( ) \
 */
function escapePdfText(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// ============================================================================
// 3. AMBIL DATA DARI FIREBASE REALTIME DATABASE LEDGER / ACCOUNTING
// ============================================================================

/**
 * Helper menghitung total saldo dari record ledger/entries
 */
function sumLedgerAmount(ledgerNode) {
  if (!ledgerNode) return 0;
  if (typeof ledgerNode === 'number') return ledgerNode;
  if (typeof ledgerNode === 'object') {
    // Jika format objek daftar transaksi: { entry1: { amount: 50000 }, ... }
    let total = 0;
    if (typeof ledgerNode.balance === 'number') return ledgerNode.balance;
    if (typeof ledgerNode.total === 'number') return ledgerNode.total;

    for (const key of Object.keys(ledgerNode)) {
      const item = ledgerNode[key];
      if (typeof item === 'number') {
        total += item;
      } else if (item && typeof item === 'object') {
        const val = Number(item.amount || item.creditAmount || item.debitAmount || item.total || 0);
        total += val;
      }
    }
    return total;
  }
  return 0;
}

/**
 * Fetch akun ledger tertentu dari Firebase RTDB
 */
async function fetchAccountBalance(accountCode, bulan, databaseUrl, authParam) {
  if (!databaseUrl || databaseUrl.includes("YOUR_PROJECT_ID") || databaseUrl === "local-storage") {
    // Fallback data demo yang realistis untuk testing
    const demoBalances = {
      "401": 38500000, // Pendapatan POS
      "402": 14200000, // Pendapatan Catering
      "501": 21500000, // HPP Bahan Baku
      "601": 9500000,  // Gaji Karyawan
      "602": 3000000,  // Sewa Tempat
      "603": 1450000,  // Listrik & Air
      "604": 850000,   // Marketing & Ads
      "605": 650000    // Biaya Kurir & Logistik
    };
    return demoBalances[accountCode] || 0;
  }

  // Coba ambil dari /accounting/ledger/{accountCode}/{bulan}.json
  // atau /accounting/ledger/{accountCode}01/{bulan}.json (toleransi kode 3/4 digit)
  const codeVariants = [accountCode, accountCode.length === 3 ? accountCode + "1" : accountCode.substring(0, 3)];

  for (const code of codeVariants) {
    try {
      const url = `${databaseUrl}/accounting/ledger/${code}/${encodeURIComponent(bulan)}.json${authParam}`;
      const res = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
      if (res.ok) {
        const val = await res.json();
        if (val !== null && val !== undefined) {
          const calculated = sumLedgerAmount(val);
          if (calculated > 0) return calculated;
        }
      }
    } catch (e) {
      console.warn(`Fetch ledger ${code} error:`, e);
    }
  }

  // Coba ambil dari Ringkasan Pos Monthly Summary jika akun pendapatan (401/402)
  if (accountCode === "401" || accountCode === "4001") {
    try {
      const summaryUrl = `${databaseUrl}/pos/summary/monthly/${encodeURIComponent(bulan)}.json${authParam}`;
      const sRes = await fetch(summaryUrl, { method: "GET", headers: { "Accept": "application/json" } });
      if (sRes.ok) {
        const sData = await sRes.json();
        if (sData && sData.sales) {
          return Number(sData.sales) || 0;
        }
      }
    } catch (sErr) {
      console.warn("Fetch monthly summary fallback note:", sErr);
    }
  }

  return 0;
}

// ============================================================================
// 4. GENERATOR DOKUMEN PDF A4 LAPORAN LABA RUGI (Pure JS Standard PDF 1.4)
// ============================================================================

/**
 * Membuat Dokumen PDF Laba Rugi A4 (595 x 842 pt)
 * Berjalan murni di Cloudflare Edge / V8 Isolate tanpa library eksternal/DOM.
 */
function generatePLReportPDF(plData, company, kasirName) {
  const pageWidth = 595;  // A4 Width in points
  const pageHeight = 842; // A4 Height in points
  const marginX = 45;
  const contentWidth = pageWidth - (marginX * 2); // 505 pt

  const textCommands = [];
  const graphicCommands = [];

  let curY = pageHeight - 50;

  // Helper fungsi teks & layout PDF
  function addText(text, x, y, fontSize = 10, isBold = false, color = [0.1, 0.1, 0.1]) {
    const fontKey = isBold ? '/F2' : '/F1';
    textCommands.push(
      `${color[0].toFixed(2)} ${color[1].toFixed(2)} ${color[2].toFixed(2)} rg`,
      `BT ${fontKey} ${fontSize} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td (${escapePdfText(text)}) Tj ET`
    );
  }

  function addRightAlignedText(text, rightX, y, fontSize = 10, isBold = false, color = [0.1, 0.1, 0.1]) {
    const fontKey = isBold ? '/F2' : '/F1';
    const charWidth = fontSize * (isBold ? 0.55 : 0.51);
    const textWidth = text.length * charWidth;
    const posX = Math.max(marginX, rightX - textWidth);
    textCommands.push(
      `${color[0].toFixed(2)} ${color[1].toFixed(2)} ${color[2].toFixed(2)} rg`,
      `BT ${fontKey} ${fontSize} Tf ${posX.toFixed(1)} ${y.toFixed(1)} Td (${escapePdfText(text)}) Tj ET`
    );
  }

  function addCenterText(text, y, fontSize = 12, isBold = false, color = [0.1, 0.1, 0.1]) {
    const fontKey = isBold ? '/F2' : '/F1';
    const charWidth = fontSize * (isBold ? 0.55 : 0.51);
    const textWidth = text.length * charWidth;
    const posX = Math.max(marginX, (pageWidth - textWidth) / 2);
    textCommands.push(
      `${color[0].toFixed(2)} ${color[1].toFixed(2)} ${color[2].toFixed(2)} rg`,
      `BT ${fontKey} ${fontSize} Tf ${posX.toFixed(1)} ${y.toFixed(1)} Td (${escapePdfText(text)}) Tj ET`
    );
  }

  function drawRect(x, y, w, h, fillColor = [0.95, 0.95, 0.95], strokeColor = null) {
    let cmd = `${fillColor[0].toFixed(2)} ${fillColor[1].toFixed(2)} ${fillColor[2].toFixed(2)} rg ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`;
    if (strokeColor) {
      cmd += ` ${strokeColor[0].toFixed(2)} ${strokeColor[1].toFixed(2)} ${strokeColor[2].toFixed(2)} RG ${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re s`;
    }
    graphicCommands.push(cmd);
  }

  function drawHorizontalLine(y, thickness = 0.8, color = [0.8, 0.8, 0.8]) {
    graphicCommands.push(
      `${thickness} w ${color[0].toFixed(2)} ${color[1].toFixed(2)} ${color[2].toFixed(2)} RG ${marginX} ${y.toFixed(1)} m ${(pageWidth - marginX)} ${y.toFixed(1)} l S`
    );
  }

  // ==========================================
  // 1. HEADER PERUSAHAAN & JUDUL DOKUMEN
  // ==========================================
  // Header Banner Background
  drawRect(marginX, curY - 48, contentWidth, 54, [0.08, 0.13, 0.22]); // Dark Navy Theme

  addText(company.name || "DAPUR KULINER VIRAL", marginX + 16, curY - 18, 14, true, [1, 1, 1]);
  addText(company.tagline || "Laporan Keuangan Resmi F&B & Catering", marginX + 16, curY - 34, 8.5, false, [0.8, 0.85, 0.9]);
  
  addRightAlignedText("LAPORAN LABA RUGI", pageWidth - marginX - 16, curY - 18, 13, true, [1, 1, 1]);
  addRightAlignedText(`Periode: ${plData.periodeText}`, pageWidth - marginX - 16, curY - 34, 9, false, [0.9, 0.9, 0.95]);

  curY -= 65;

  // Metadata Bar
  drawRect(marginX, curY - 18, contentWidth, 22, [0.96, 0.97, 0.98], [0.88, 0.90, 0.92]);
  addText(`Dicetak oleh: ${kasirName || "Admin Keuangan"}`, marginX + 10, curY - 12, 8, false, [0.35, 0.35, 0.35]);
  const dateFormatted = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  addRightAlignedText(`Tanggal Cetak: ${dateFormatted}`, pageWidth - marginX - 10, curY - 12, 8, false, [0.35, 0.35, 0.35]);

  curY -= 32;

  // ==========================================
  // 2. SECTION: PENDAPATAN USAHA (REVENUE)
  // ==========================================
  // Section Header Pill (Hijau Gelap)
  drawRect(marginX, curY - 14, contentWidth, 18, [0.90, 0.96, 0.92]);
  addText("1. PENDAPATAN USAHA (REVENUES)", marginX + 8, curY - 10, 9.5, true, [0.10, 0.50, 0.25]); // Hijau
  curY -= 24;

  // Sub-item 401
  addText("401 - Pendapatan Penjualan Kasir POS", marginX + 16, curY, 9, false, [0.2, 0.2, 0.2]);
  addRightAlignedText(formatRupiah(plData.pendapatan.penjualanPos), pageWidth - marginX - 16, curY, 9, false, [0.15, 0.15, 0.15]);
  curY -= 16;

  // Sub-item 402
  addText("402 - Pendapatan Pesanan Catering & Event", marginX + 16, curY, 9, false, [0.2, 0.2, 0.2]);
  addRightAlignedText(formatRupiah(plData.pendapatan.penjualanCatering), pageWidth - marginX - 16, curY, 9, false, [0.15, 0.15, 0.15]);
  curY -= 18;

  // Total Pendapatan Subtotal Bar
  drawRect(marginX + 8, curY - 12, contentWidth - 16, 16, [0.93, 0.97, 0.94]);
  addText("TOTAL PENDAPATAN BERSIH", marginX + 16, curY - 8, 9, true, [0.08, 0.45, 0.20]);
  addRightAlignedText(formatRupiah(plData.pendapatan.totalPendapatan), pageWidth - marginX - 16, curY - 8, 9.5, true, [0.08, 0.45, 0.20]);
  curY -= 24;

  // ==========================================
  // 3. SECTION: HARGA POKOK PENJUALAN (HPP)
  // ==========================================
  drawRect(marginX, curY - 14, contentWidth, 18, [0.98, 0.94, 0.94]);
  addText("2. HARGA POKOK PENJUALAN (COGS / HPP)", marginX + 8, curY - 10, 9.5, true, [0.65, 0.18, 0.18]); // Merah Bata
  curY -= 24;

  addText("501 - Beban Pokok Bahan Baku Makanan & Minuman", marginX + 16, curY, 9, false, [0.2, 0.2, 0.2]);
  addRightAlignedText(formatRupiah(plData.hpp.bahanBaku), pageWidth - marginX - 16, curY, 9, false, [0.2, 0.2, 0.2]);
  curY -= 18;

  drawRect(marginX + 8, curY - 12, contentWidth - 16, 16, [0.97, 0.92, 0.92]);
  addText("TOTAL HARGA POKOK PENJUALAN", marginX + 16, curY - 8, 9, true, [0.65, 0.18, 0.18]);
  addRightAlignedText(formatRupiah(plData.hpp.totalHpp), pageWidth - marginX - 16, curY - 8, 9.5, true, [0.65, 0.18, 0.18]);
  curY -= 24;

  // ==========================================
  // 4. HIGHLIGHT: LABA KOTOR (GROSS PROFIT)
  // ==========================================
  drawRect(marginX, curY - 16, contentWidth, 22, [0.92, 0.95, 0.99], [0.35, 0.55, 0.85]);
  addText(`LABA KOTOR (GROSS PROFIT) [Margin: ${plData.marginKotor}%]`, marginX + 12, curY - 11, 10, true, [0.10, 0.25, 0.60]);
  addRightAlignedText(formatRupiah(plData.labaKotor), pageWidth - marginX - 12, curY - 11, 10.5, true, [0.10, 0.25, 0.60]);
  curY -= 30;

  // ==========================================
  // 5. SECTION: BEBAN OPERASIONAL (EXPENSES)
  // ==========================================
  drawRect(marginX, curY - 14, contentWidth, 18, [0.98, 0.93, 0.93]);
  addText("3. BEBAN OPERASIONAL (OPERATING EXPENSES)", marginX + 8, curY - 10, 9.5, true, [0.75, 0.15, 0.15]); // Merah
  curY -= 22;

  const bebanList = [
    { code: "601", name: "Beban Gaji Karyawan & Dapur", amount: plData.beban.gaji },
    { code: "602", name: "Beban Sewa Tempat & Outlet", amount: plData.beban.sewa },
    { code: "603", name: "Beban Listrik, Air & Gas (Utilitas)", amount: plData.beban.utilitas },
    { code: "604", name: "Beban Pemasaran & Promosi (Marketing)", amount: plData.beban.marketing },
    { code: "605", name: "Beban Pengiriman, Logistik & Kurir", amount: plData.beban.kurir }
  ];

  bebanList.forEach(b => {
    addText(`${b.code} - ${b.name}`, marginX + 16, curY, 8.5, false, [0.25, 0.25, 0.25]);
    addRightAlignedText(formatRupiah(b.amount), pageWidth - marginX - 16, curY, 8.5, false, [0.25, 0.25, 0.25]);
    curY -= 14;
  });

  curY -= 4;
  drawRect(marginX + 8, curY - 12, contentWidth - 16, 16, [0.97, 0.90, 0.90]);
  addText("TOTAL BEBAN OPERASIONAL", marginX + 16, curY - 8, 9, true, [0.75, 0.15, 0.15]);
  addRightAlignedText(formatRupiah(plData.beban.totalBeban), pageWidth - marginX - 16, curY - 8, 9.5, true, [0.75, 0.15, 0.15]);
  curY -= 28;

  // ==========================================
  // 6. HIGHLIGHT UTAMA: LABA BERSIH (NET INCOME)
  // ==========================================
  const isProfit = plData.labaBersih >= 0;
  const netBgColor = isProfit ? [0.88, 0.96, 0.90] : [0.98, 0.88, 0.88];
  const netBorderColor = isProfit ? [0.15, 0.60, 0.25] : [0.85, 0.20, 0.20];
  const netTextColor = isProfit ? [0.08, 0.45, 0.18] : [0.80, 0.10, 0.10];

  drawRect(marginX, curY - 22, contentWidth, 30, netBgColor, netBorderColor);
  addText(`LABA / (RUGI) BERSIH TAHUN BERJALAN (${isProfit ? 'PROFIT' : 'LOSS'})`, marginX + 14, curY - 14, 11, true, netTextColor);
  addRightAlignedText(formatRupiah(plData.labaBersih), pageWidth - marginX - 14, curY - 14, 12, true, netTextColor);

  curY -= 40;

  // Ringkasan margin info
  addText(`* Net Profit Margin: ${plData.marginBersih}% dari total omzet penjualan bersih`, marginX + 8, curY, 8, false, [0.45, 0.45, 0.45]);

  // ==========================================
  // 7. FOOTER & TANDA TANGAN (SIGNATURE BLOCK)
  // ==========================================
  curY = 120; // Posisikan di bawah halaman A4
  drawHorizontalLine(curY + 15, 0.6, [0.8, 0.8, 0.8]);

  const colWidth = contentWidth / 2;
  // Kolom Kiri: Pembuat Laporan
  addCenterText("Disiapkan Oleh,", marginX + (colWidth / 2), curY, 8.5, false, [0.3, 0.3, 0.3]);
  addCenterText(`( ${kasirName || "Kasir / Bag. Keuangan"} )`, marginX + (colWidth / 2), curY - 45, 9, true, [0.1, 0.1, 0.1]);
  addCenterText("Bagian Keuangan & Kasir", marginX + (colWidth / 2), curY - 56, 7.5, false, [0.4, 0.4, 0.4]);

  // Kolom Kanan: Penanggung Jawab / Owner
  addCenterText("Disetujui & Diperiksa Oleh,", marginX + colWidth + (colWidth / 2), curY, 8.5, false, [0.3, 0.3, 0.3]);
  addCenterText("( ................................................ )", marginX + colWidth + (colWidth / 2), curY - 45, 9, true, [0.1, 0.1, 0.1]);
  addCenterText("Owner / General Manager", marginX + colWidth + (colWidth / 2), curY - 56, 7.5, false, [0.4, 0.4, 0.4]);

  // Dokumen Stream Content
  const allStreams = [...graphicCommands, ...textCommands].join('\n');
  const streamLength = allStreams.length;

  const pdfBody = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<<
  /Type /Page
  /Parent 2 0 R
  /MediaBox [0 0 ${pageWidth} ${pageHeight}]
  /Contents 4 0 R
  /Resources <<
    /Font <<
      /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
      /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>
    >>
  >>
>>
endobj
4 0 obj
<< /Length ${streamLength} >>
stream
${allStreams}
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000318 00000 n 
trailer
<< /Size 5 /Root 1 0 R >>
startxref
${(370 + streamLength)}
%%EOF`;

  const base64Pdf = typeof btoa === 'function'
    ? btoa(pdfBody)
    : Buffer.from(pdfBody).toString('base64');

  return `data:application/pdf;base64,${base64Pdf}`;
}

// ============================================================================
// 5. MAIN CONTROLLER LOGIC (Digunakan oleh Cloudflare & Express)
// ============================================================================

/**
 * Handle Profit & Loss Report Generation Request
 */
export async function handleReportPLRequest(body, env = {}) {
  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      data: { success: false, error: "Request body harus berupa JSON objek yang valid." }
    };
  }

  // 1. Ambil Parameter
  const {
    bulan = new Date().toISOString().substring(0, 7), // YYYY-MM
    kasirName = "Kasir Utama",
    includeCharts = false
  } = body;

  // Validasi Format Bulan (YYYY-MM)
  const regexBulan = /^\d{4}-\d{2}$/;
  if (!regexBulan.test(bulan)) {
    return {
      status: 400,
      data: { success: false, error: "Format 'bulan' harus berupa YYYY-MM (contoh: '2026-09')." }
    };
  }

  const databaseUrl = (
    env?.FIREBASE_DATABASE_URL ||
    env?.VITE_FIREBASE_DATABASE_URL ||
    ""
  ).replace(/\/$/, "");

  const apiKey = env?.FIREBASE_API_KEY || env?.VITE_FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  // 2. Ambil Data Ledger Akuntansi dari Firebase secara Paralel
  const [
    penjualanPos,
    penjualanCatering,
    hppBahanBaku,
    bebanGaji,
    bebanSewa,
    bebanUtilitas,
    bebanMarketing,
    bebanKurir
  ] = await Promise.all([
    fetchAccountBalance("401", bulan, databaseUrl, authParam),
    fetchAccountBalance("402", bulan, databaseUrl, authParam),
    fetchAccountBalance("501", bulan, databaseUrl, authParam),
    fetchAccountBalance("601", bulan, databaseUrl, authParam),
    fetchAccountBalance("602", bulan, databaseUrl, authParam),
    fetchAccountBalance("603", bulan, databaseUrl, authParam),
    fetchAccountBalance("604", bulan, databaseUrl, authParam),
    fetchAccountBalance("605", bulan, databaseUrl, authParam)
  ]);

  // 3. Kalkulasi Standar Akuntansi Laba Rugi
  const totalPendapatan = penjualanPos + penjualanCatering;
  const totalHpp = hppBahanBaku;
  const labaKotor = totalPendapatan - totalHpp;
  const marginKotor = totalPendapatan > 0
    ? Number(((labaKotor / totalPendapatan) * 100).toFixed(2))
    : 0;

  const totalBeban = bebanGaji + bebanSewa + bebanUtilitas + bebanMarketing + bebanKurir;
  const labaBersih = labaKotor - totalBeban;
  const marginBersih = totalPendapatan > 0
    ? Number(((labaBersih / totalPendapatan) * 100).toFixed(2))
    : 0;

  const periodeText = formatPeriodeIndo(bulan);

  // 4. Struktur Data Laba Rugi Terkalkulasi
  const plData = {
    periode: bulan,
    periodeText: periodeText,
    includeCharts: Boolean(includeCharts),
    pendapatan: {
      penjualanPos: penjualanPos,
      penjualanCatering: penjualanCatering,
      totalPendapatan: totalPendapatan
    },
    hpp: {
      bahanBaku: hppBahanBaku,
      totalHpp: totalHpp
    },
    labaKotor: labaKotor,
    marginKotor: marginKotor,
    beban: {
      gaji: bebanGaji,
      sewa: bebanSewa,
      utilitas: bebanUtilitas,
      marketing: bebanMarketing,
      kurir: bebanKurir,
      totalBeban: totalBeban
    },
    labaBersih: labaBersih,
    marginBersih: marginBersih,
    status: labaBersih >= 0 ? "PROFIT" : "LOSS"
  };

  // 5. Generate Dokumen PDF A4 Standar
  const companyInfo = DEFAULT_COMPANY_SETTINGS;
  const pdfBase64 = generatePLReportPDF(plData, companyInfo, kasirName);

  return {
    status: 200,
    data: {
      success: true,
      pdfBase64: pdfBase64,
      data: plData,
      company: companyInfo,
      generatedAt: new Date().toISOString()
    }
  };
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

  // Tolak selain POST
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed. Gunakan POST." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, error: "Format body request tidak valid (wajib JSON)." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await handleReportPLRequest(body, env);

    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Report PL fatal error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || "Gagal menghasilkan laporan Laba Rugi."
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
