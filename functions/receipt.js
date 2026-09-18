/**
 * ============================================================================
 * Cloudflare Pages Function & Node.js API: /functions/receipt.js
 * ============================================================================
 * FUNGSI: Validasi transaksi, normalisasi data toko, dan generate Struk Thermal
 *         80mm PDF (Base64) serta JSON siap render.
 *
 * ENDPOINT: POST /receipt (dan /api/receipt)
 *
 * BODY REQUEST:
 * {
 *   "txId": "TRX-20260918-001",
 *   "items": [
 *     ["ayam-geprek", 2, 25000],          // Format array: [menuId, qty, price, name?]
 *     { "id": "m1", "name": "Es Teh", "qty": 2, "price": 5000 } // Format objek didukung
 *   ],
 *   "subtotal": 60000,
 *   "tax": 6000,
 *   "discount": 0,
 *   "total": 66000,
 *   "paymentMethod": "qris",             // cash, qris, transfer, ewallet
 *   "cashAmount": 100000,                // opsional untuk tunai
 *   "changeAmount": 34000,               // opsional untuk tunai
 *   "customer": { "name": "Budi", "phone": "08123456789" },
 *   "kasir": "kasir1",
 *   "timestamp": 1789718400000
 * }
 *
 * RESPONSE:
 * {
 *   "success": true,
 *   "pdfBase64": "data:application/pdf;base64,...",
 *   "receipt": { ... },                  // Data ternormalisasi lengkap
 *   "company": { ... },                  // Profil outlet / toko
 *   "generatedAt": "2026-09-18T09:21:33.000Z"
 * }
 * ============================================================================
 */

// ============================================================================
// 1. DATA DEFAULT PROFIL TOKO & OUTLET (Fallback jika Firebase kosong)
// ============================================================================
const DEFAULT_COMPANY_SETTINGS = {
  name: "DAPUR KULINER VIRAL",
  tagline: "Spesialis Masakan Nusantara & Catering",
  address: "Jl. Boulevard Raya Blok A No. 12, Kelapa Gading, Jakarta Utara",
  phone: "0812-8888-9999",
  instagram: "@dapurkulinerviral.id",
  npwp: "98.765.432.1-012.000",
  footerMessage: "Terima kasih atas kunjungan Anda!",
  feedbackUrl: "https://dapurkulinerviral.id/feedback"
};

// ============================================================================
// 2. HELPER FORMATTING & NORMALISASI
// ============================================================================

/**
 * Format angka ke string Rupiah (contoh: 25000 -> "Rp 25.000")
 */
function formatRupiah(num) {
  const val = Math.round(Number(num) || 0);
  return 'Rp ' + val.toLocaleString('id-ID');
}

/**
 * Format timestamp ke format tanggal jam lokal Indonesia
 */
function formatDateTime(ts) {
  const d = ts ? new Date(ts) : new Date();
  if (isNaN(d.getTime())) return new Date().toLocaleString('id-ID');
  return d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Normalisasi daftar item baik dari format array [id, qty, price, name?]
 * maupun objek { id, name, qty, price, subtotal }
 */
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];

  return items.map((item, idx) => {
    // Jika format array [menuId, qty, price, optionalName]
    if (Array.isArray(item)) {
      const [menuId, qty, price, optName] = item;
      const quantity = Math.max(1, Number(qty) || 1);
      const unitPrice = Number(price) || 0;
      const cleanName = optName || (typeof menuId === 'string' ? menuId.replace(/[-_]/g, ' ').toUpperCase() : `Item #${idx + 1}`);
      return {
        id: String(menuId || `item-${idx + 1}`),
        name: cleanName.substring(0, 24),
        qty: quantity,
        price: unitPrice,
        subtotal: quantity * unitPrice
      };
    }

    // Jika format objek { id, name, qty, price, total }
    if (item && typeof item === 'object') {
      const quantity = Math.max(1, Number(item.qty || item.quantity) || 1);
      const unitPrice = Number(item.price || item.unitPrice) || 0;
      const rawName = item.name || item.title || item.menuId || item.id || `Item #${idx + 1}`;
      return {
        id: String(item.id || item.menuId || `item-${idx + 1}`),
        name: String(rawName).replace(/[-_]/g, ' ').toUpperCase().substring(0, 24),
        qty: quantity,
        price: unitPrice,
        subtotal: quantity * unitPrice
      };
    }

    return {
      id: `item-${idx + 1}`,
      name: `Item #${idx + 1}`,
      qty: 1,
      price: 0,
      subtotal: 0
    };
  });
}

/**
 * Mengambil setting perusahaan dari Firebase Realtime Database / REST
 */
async function fetchCompanySettings(env) {
  const databaseUrl = (
    env?.FIREBASE_DATABASE_URL ||
    env?.VITE_FIREBASE_DATABASE_URL ||
    ""
  ).replace(/\/$/, "");

  const apiKey = env?.FIREBASE_API_KEY || env?.VITE_FIREBASE_API_KEY || "";

  if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID") && databaseUrl !== "local-storage") {
    try {
      const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
      const url = `${databaseUrl}/settings/company.json${authParam}`;
      const res = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          return { ...DEFAULT_COMPANY_SETTINGS, ...data };
        }
      }
    } catch (e) {
      console.warn("Fetch company settings from Firebase error:", e);
    }
  }

  return DEFAULT_COMPANY_SETTINGS;
}

// ============================================================================
// 3. GENERATOR STRUK THERMAL PDF 80MM STANDAR (Pure JS - Zero Dependency)
// ============================================================================
/**
 * Menghasilkan dokumen PDF 1.4 standar untuk ukuran kertas kasir 80mm
 * (Lebar: 226 pt / 80 mm, Tinggi dinamis berdasarkan jumlah item).
 * Berjalan murni di Cloudflare Edge Isolate & Node.js tanpa C++ binding / DOM.
 */
function generateThermalReceiptPDF(receiptData, company) {
  const items = receiptData.items || [];
  
  // Hitung tinggi kertas proporsional (80mm lebar = 226pt)
  // Tinggi dasar header + footer = ~360pt, ditambah ~24pt per baris item
  const pageHeight = Math.max(480, 360 + items.length * 26);
  const pageWidth = 226; // 80mm

  // Konstruksi stream teks PDF
  const textLines = [];

  // Helper koordinat y (PDF origin 0,0 ada di pojok kiri bawah)
  let curY = pageHeight - 30;

  function addCenterText(text, fontSize = 10, isBold = false) {
    const fontKey = isBold ? '/F2' : '/F1';
    // Perkiraan lebar karakter monospace/helvetica untuk center align
    const charWidth = fontSize * 0.52;
    const textWidth = text.length * charWidth;
    const posX = Math.max(10, (pageWidth - textWidth) / 2);
    textLines.push(`BT ${fontKey} ${fontSize} Tf ${posX.toFixed(1)} ${curY.toFixed(1)} Td (${escapePdfText(text)}) Tj ET`);
    curY -= (fontSize + 4);
  }

  function addLeftRightText(leftText, rightText, fontSize = 8.5, isBold = false) {
    const fontKey = isBold ? '/F2' : '/F1';
    const leftX = 14;
    const charWidth = fontSize * 0.52;
    const rightWidth = rightText.length * charWidth;
    const rightX = Math.max(leftX + 20, pageWidth - 14 - rightWidth);

    textLines.push(`BT ${fontKey} ${fontSize} Tf ${leftX.toFixed(1)} ${curY.toFixed(1)} Td (${escapePdfText(leftText)}) Tj ET`);
    textLines.push(`BT ${fontKey} ${fontSize} Tf ${rightX.toFixed(1)} ${curY.toFixed(1)} Td (${escapePdfText(rightText)}) Tj ET`);
    curY -= (fontSize + 4);
  }

  function addDividerLine(style = '-') {
    const charCount = style === '=' ? 34 : 38;
    const lineStr = style.repeat(charCount);
    addCenterText(lineStr, 8, false);
  }

  // --- 1. HEADER TOKO ---
  addCenterText(company.name || "DAPUR KULINER VIRAL", 12, true);
  if (company.tagline) {
    addCenterText(company.tagline, 7.5, false);
  }
  
  // Alamat di-wrap jika panjang
  const addr = company.address || "";
  if (addr.length > 36) {
    addCenterText(addr.substring(0, 36), 7, false);
    addCenterText(addr.substring(36, 72), 7, false);
  } else if (addr) {
    addCenterText(addr, 7, false);
  }
  
  if (company.phone) {
    addCenterText(`Telp/WA: ${company.phone}`, 7.5, false);
  }

  addDividerLine('=');

  // --- 2. INFORMASI TRANSAKSI ---
  addLeftRightText(`No: ${receiptData.txId}`, receiptData.dateShort || '');
  addLeftRightText(`Waktu: ${receiptData.timeOnly || ''}`, `Kasir: ${receiptData.kasir || 'Kasir'}`);
  
  if (receiptData.customer?.name && receiptData.customer.name !== 'Umum') {
    addLeftRightText(`Pelanggan: ${receiptData.customer.name}`, receiptData.customer.phone || '');
  }

  addDividerLine('-');

  // --- 3. DAFTAR ITEM TRANSAKSI ---
  items.forEach((it) => {
    // Baris 1: Nama item (bold ringkas)
    const itemName = it.name.length > 22 ? it.name.substring(0, 22) + '.' : it.name;
    const itemSubtotal = formatRupiah(it.subtotal);
    addLeftRightText(itemName, itemSubtotal, 8.5, true);

    // Baris 2: Qty x Harga Satuan
    const qtyDetail = `  ${it.qty} x ${formatRupiah(it.price)}`;
    addLeftRightText(qtyDetail, '', 7.5, false);
    curY += 2; // spasi kecil
  });

  addDividerLine('-');

  // --- 4. RINGKASAN TOTAL & PEMBAYARAN ---
  addLeftRightText("Subtotal", formatRupiah(receiptData.subtotal), 8.5, false);

  if (receiptData.discount > 0) {
    addLeftRightText("Diskon Promo", `-${formatRupiah(receiptData.discount)}`, 8.5, false);
  }

  if (receiptData.tax > 0) {
    addLeftRightText("PB1 Resto (10%)", formatRupiah(receiptData.tax), 8.5, false);
  }

  addDividerLine('=');
  addLeftRightText("TOTAL AKHIR", formatRupiah(receiptData.total), 11, true);
  addDividerLine('=');

  // Info Pembayaran
  const methodLabel = receiptData.paymentMethod.toUpperCase();
  addLeftRightText("Metode Bayar", methodLabel, 8.5, true);

  if (receiptData.paymentMethod.toLowerCase().includes('cash') || receiptData.paymentMethod.toLowerCase().includes('tunai')) {
    if (receiptData.cashAmount > 0) {
      addLeftRightText("Tunai Diterima", formatRupiah(receiptData.cashAmount), 8.5, false);
      addLeftRightText("Kembalian", formatRupiah(receiptData.changeAmount), 8.5, true);
    }
  } else if (receiptData.paymentMethod.toLowerCase().includes('qris')) {
    addLeftRightText("Status QRIS", "LUNAS (OTOMATIS)", 8, false);
  }

  addDividerLine('-');

  // --- 5. FOOTER & FEEDBACK ---
  curY -= 4;
  addCenterText(company.footerMessage || "Terima kasih atas kunjungan Anda!", 8.5, true);
  addCenterText("Simpan struk ini sebagai bukti pembayaran sah", 7, false);
  
  if (company.instagram) {
    addCenterText(`IG: ${company.instagram}`, 7.5, false);
  }
  if (company.feedbackUrl) {
    addCenterText(`Feedback: ${company.feedbackUrl}`, 7, false);
  }

  const streamContent = textLines.join('\n');
  const streamLength = streamContent.length;

  // Bangun Objek PDF 1.4 Standar
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
  /MediaBox [0 0 ${pageWidth} ${pageHeight.toFixed(0)}]
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
${streamContent}
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

  // Encode ke Base64 Data URI
  const base64Pdf = typeof btoa === 'function'
    ? btoa(pdfBody)
    : Buffer.from(pdfBody).toString('base64');

  return `data:application/pdf;base64,${base64Pdf}`;
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
// 4. MAIN CONTROLLER LOGIC (Digunakan oleh Cloudflare & Express)
// ============================================================================

/**
 * Handle Receipt Generation Logic
 */
export async function handleReceiptRequest(body, env = {}) {
  // 1. Validasi Input Dasar
  if (!body || typeof body !== 'object') {
    return {
      status: 400,
      data: { success: false, error: "Request body harus berupa JSON yang valid." }
    };
  }

  const {
    txId,
    orderId,
    items = [],
    subtotal,
    tax = 0,
    discount = 0,
    total,
    grandTotal,
    paymentMethod = "cash",
    cashAmount = 0,
    changeAmount = 0,
    customer = {},
    kasir = "Kasir",
    timestamp = Date.now()
  } = body;

  const finalTxId = txId || orderId || `TRX-${Date.now()}`;
  const normalizedItems = normalizeItems(items);

  if (normalizedItems.length === 0) {
    return {
      status: 400,
      data: { success: false, error: "Daftar items transaksi tidak boleh kosong." }
    };
  }

  // Hitung ulang subtotal jika tidak dikirim
  const calcSubtotal = Number(subtotal) || normalizedItems.reduce((acc, cur) => acc + cur.subtotal, 0);
  const calcTax = Number(tax) || 0;
  const calcDiscount = Number(discount) || 0;
  const calcTotal = Number(total || grandTotal) || (calcSubtotal + calcTax - calcDiscount);

  // Normalisasi Data Pelanggan
  const normCustomer = {
    name: customer?.name || "Pelanggan Umum",
    phone: customer?.phone || "-"
  };

  // 2. Ambil Informasi Perusahaan / Toko dari Database atau Default
  const companyInfo = await fetchCompanySettings(env);

  const formattedDate = formatDateTime(timestamp);
  const dateShort = formattedDate.split(' ')[0] || '';
  const timeOnly = formattedDate.split(' ')[1] || '';

  // 3. Buat Objek Struk Ternormalisasi
  const receiptData = {
    txId: finalTxId,
    timestamp: Number(timestamp) || Date.now(),
    dateFormatted: formattedDate,
    dateShort,
    timeOnly,
    kasir: String(kasir || "Kasir Utama"),
    customer: normCustomer,
    items: normalizedItems,
    subtotal: calcSubtotal,
    tax: calcTax,
    discount: calcDiscount,
    total: calcTotal,
    paymentMethod: String(paymentMethod || "cash"),
    cashAmount: Number(cashAmount) || (paymentMethod === 'cash' ? calcTotal : 0),
    changeAmount: Number(changeAmount) || 0
  };

  // 4. Generate Struk Thermal 80mm PDF Base64
  const pdfBase64 = generateThermalReceiptPDF(receiptData, companyInfo);

  return {
    status: 200,
    data: {
      success: true,
      pdfBase64: pdfBase64,
      receipt: receiptData,
      company: companyInfo,
      generatedAt: new Date().toISOString()
    }
  };
}

// ============================================================================
// 5. CLOUDFLARE PAGES / WORKERS EXPORT (onRequest)
// ============================================================================
export async function onRequest(context) {
  const { request, env } = context;

  // Header CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  // Handle preflight OPTIONS
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

    const result = await handleReceiptRequest(body, env);

    return new Response(JSON.stringify(result.data), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("Receipt generation fatal error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || "Gagal memproses struk transaksi."
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
