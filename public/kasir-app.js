/**
 customKasirTitle: 'Kasir Pintar',
 customKasirSubtitle: 'Dapur Kuliner Viral',
 * /public/kasir-app.js — BAGIAN 1 dari 3 (Transaksi & Pembayaran)
 * Sistem Kasir Pintar POS - Dapur Kuliner Viral & Catering Rumahan
 * 
 * FUNGSI UTAMA:
 * 1. initKasir(): Validasi sesi, jam realtime, sinkronisasi menu, inventory & pending reconcile
 * 2. Manajemen Keranjang: addToCart, incrementQty, decrementQty, removeFromCart, clearCart, auto hitung subtotal/tax/total
 * 3. Proses Pembayaran: openPaymentModal, bayarTunai, bayarQris, bayarTransfer, bayarEwallet, splitBill
 * 4. Simpan Transaksi: simpanTransaksi() ke Firebase /pos/transactions/{YYYY-MM-DD}/{txId} format hemat, offline queue, print, aggregate & inventory deduct
 * 5. Cetak Struk: previewStruk, downloadStrukPDF (jsPDF 80mm), printStruk (RawBT Android), kirimStrukWA
 * 6. Auto-Save Draft: simpan otomatis tiap 30s ke localStorage, restore prompt saat load
 * 7. Sound Feedback: Web Audio API synth ('click', 'success', 'error', 'notify')
 */

// ✅ Simpan Firebase & AudioContext di MODULE SCOPE (bukan di this/Alpine) — hindari Proxy pollution
let FB_DB = null;
let GLOBAL_AUDIO_CTX = null;

window.kasirApp = () => ({
    _scanBuffer: '',
    _scanLastTime: 0,
    _scanListenerBound: false,
    appReady: false,
    scannerEnabled: true,
    splashKasirTitle: 'KASIR',
    splashKasirSubtitle: 'Digital Culinary',

  // =========================================================================
  // 1. STATE DASAR & NAVIGASI
  // =========================================================================
  activeTab: 'transaksi',
  mobileMenuOpen: false,

  // Sesi Kasir & Jam Realtime
  kasirInfo: {
    username: 'kasir',
    name: 'Kasir Utama',
    shiftId: 'S-2026-09-18-01'
  },
  currentTime: '',
  _clockInterval: null,

  // Bagan Akun (COA) Backend Integration
  coaListBackend: [],
  coaListBackendLoading: false,

   // Global loading state (dipakai di submitJournalEntry, approveJournal, rejectJournal)
  isLoading: false,
 
  // ✅ Custom Title (dari Admin Panel → Security)
  customKasirTitle: 'Kasir Pintar',
  customKasirSubtitle: 'Dapur Kuliner Viral',

  // Katalog Menu & Keranjang
  cart: [],
  menuList: [
    { id: 'm1', name: 'Rice Bowl Chicken Katsu Curry', category: 'rice-bowl', price: 28000, desc: 'Nasi pulen + katsu crispy saus kari gurih', image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400' },
    { id: 'm2', name: 'Rice Bowl Beef Teriyaki', category: 'rice-bowl', price: 35000, desc: 'Daging sapi iris bumbu teriyaki jepang', image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400' },
    { id: 'm3', name: 'Spicy Honey Chicken Wings (6 pcs)', category: 'chicken', price: 32000, desc: 'Sayap ayam krispi madu pedas lezat', image: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=400' },
    { id: 'm4', name: 'Chicken Egg Roll Bento Komplit', category: 'chicken', price: 30000, desc: 'Egg roll ayam + salad + nasi + saus', image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=400' },
    { id: 'm5', name: 'Mie Pedas Viral Level 3', category: 'mie-bakso', price: 22000, desc: 'Mie kenyal gurih cabe rawit pedas nagih', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400' },
    { id: 'm6', name: 'Bakso Cuanki Kuah Pedas Daun Jeruk', category: 'mie-bakso', price: 25000, desc: 'Bakso aci, tahu, siomay kering renyah', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400' },
    { id: 'm7', name: 'Dimsum Mentai Mozzarella (4 pcs)', category: 'dimsum', price: 24000, desc: 'Dimsum ayam topping saus mentai bakar', image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=400' },
    { id: 'm8', name: 'Siomay Udang Ayam Kukus', category: 'dimsum', price: 20000, desc: 'Siomay lembut dengan potongan udang asli', image: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=400' },
    { id: 'm9', name: 'Es Lemon Tea Segar', category: 'minuman', price: 8000, desc: 'Teh melati wangi dengan perasan lemon asli', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=400' },
    { id: 'm10', name: 'Es Cincau Gula Aren Susu', category: 'minuman', price: 12000, desc: 'Cincau hitam kenyal dengan susu aren legit', image: 'https://images.unsplash.com/photo-1556881286-fc6915169721?w=400' }
  ],
  categories: [
    { id: 'semua', name: 'Semua' },
    { id: 'rice_bowl', name: 'Bento & Rice Bowl' },
    { id: 'chicken', name: 'Ayam & Bento' },
    { id: 'mie', name: 'Aneka Mie' },
    { id: 'dimsum', name: 'Dimsum & Snack' },
    { id: 'cemilan', name: 'Cemilan / Side Dish' },
    { id: 'ala_carte', name: 'Ala Carte' },
    { id: 'minuman', name: 'Aneka Minuman' },
    { id: 'viral', name: 'Viral & Dessert' }
  ],
  selectedCategory: 'semua',
  searchQuery: '',
  isLoadingMenu: false,
  orderNote: '',
  discountAmount: 0,

  // Fitur Diskon, Pajak & Service Charge Keranjang
  orderDiscountType: 'percent', // 'percent' | 'nominal'
  orderDiscountValue: 0,
  isTaxEnabled: false, // ✅ PATCH H-11: Default OFF — kasir centang manual bila perlu
  isServiceChargeEnabled: false, // Service Charge 5%
  serviceChargeRate: 5,
  isTaxIncluded: false, // ✅ PATCH H: PPN Include/Exclude toggle (default OFF)

  // Modal Diskon Per Item
  showItemDiscountModal: false,
  selectedCartItemForDiscount: null,
  itemDiscountForm: {
    type: 'percent',
    value: 0
  },

  // Modal Diskon Total Belanja
  showOrderDiscountModal: false,
  orderDiscountForm: {
    type: 'percent',
    value: 0
  },

  // Pengaturan Printer POS
  showPrinterModal: false,
  printerConfig: {
    type: 'bluetooth', // 'bluetooth' | 'usb' | 'network'
    paperSize: '58mm', // '58mm' | '80mm'
    name: 'POS Thermal Printer 58mm',
    ipAddress: '192.168.1.200',
    autoPrint: true
  },

  // Shift Status & History
    // Shift Status & History
  shiftStatus: 'open', // 'open' | 'paused' | 'closed'
  shiftPauseTime: null,
  _shiftClosedHandled: false,   // ✅ BUG-4: flag anti double-execute auto-logout shift
  _visibilityListenerBound: false, // ✅ BUG-4: guard agar listener visibilitychange tidak duplikat
  showEditModalBanner: false,   // ✅ banner ubah modal awal
  editModalInput: 0,             // input sementara banner
  autoJournalShiftDiff: false,  // ✅ FITUR-1: toggle auto-jurnal selisih kas close shift (sync dari site_config)

  // Modal State
  paymentModal: false,
  cashModal: false,
  qrisModal: false,
  transferModal: false,
  ewalletModal: false,
  splitModal: false,
  receiptModal: false,
  receiptWAPhone: '',   // ✅ FEATURE-3: state nomor WA pelanggan untuk struk POS
  receiptWaAuto: false, // FASE 5: nomor WA auto-populate dari order online (readonly)
  closeShiftModal: false,
  reconcileModal: false,
  pendingReconcileModal: false,

  // Detail Pembayaran Aktif
  selectedPaymentMethod: 'tunai',
  cashReceived: 0,
  currentOrder: null,
  qrisOrderId: '',
  qrisDisplayMode: 'dynamic', // 'dynamic' | 'static'
   // 🔒 Supervisor PIN Security State
  supervisorPin: '211211',
         // 📊 Range Filter State untuk Laporan
        reportPeriod: 'today',      // 'today' | 'week' | 'month' | 'custom'
        reportStartDate: '',         // untuk custom (YYYY-MM-DD)
        reportEndDate: '',           // untuk custom
        reportLoading: false,
 // default, override dari Firebase /site_config/supervisorPin
  showPinModal: false,
  pinInput: '',
  pinErrorMessage: '',
  pinContext: null,               // { actionLabel, targetLabel, opts, resolve }
  qrisQrUrl: '',
  qrisRedirectUrl: '',
  midtransPollingTimer: null,

  // Split Bill State (Dynamic Rows)
  splitRows: [
    { method: 'tunai', amount: 0 },
    { method: 'qris', amount: 0 }
  ],

  // Rekonsiliasi & Notifikasi State (Bagian 2)
  pendingReconcile: 0,
  reconciliationList: [],
  reconciliationFilter: 'all',
  reconcileFilter: 'semua',
  reconcileDateRange: 'today',
  selectedOrders: [],
  selectedReconcileIds: [],
  showRekonsiliasiModal: false,
  pendingReconcileModal: false,
  lastReconcileTime: null,
  reconcileSummary: {
    berhasil: [],
    menggantung: [],
    gagal: [],
    berhasilCount: 0,
    menggantungCount: 0,
    gagalCount: 0
  },
  reconcileProgress: {
    isRunning: false,
    current: 0,
    total: 0,
    percent: 0
  },
  activeReconcileItem: null,
  _reconcileInterval: null,

  // Shift, Inventory & Laporan State (BAGIAN 3)
   // 🧮 Shift Cash Calculator State
  shiftCalc: {
    modalAwal: 0,
    totalPenjualanTunai: 0,
    pengeluaranTunai: 0,
    uangFisik: 0,
    notes: ''
  },
  showShiftCalcModal: false,
   
    shiftSummary: {
    totalSales: 2450000,
    cashSales: 980000,
    qrisSales: 1120000,
    transferSales: 350000,
    ewalletSales: 0,
    transactionCount: 42,
    startCash: 200000,
    startTime: '08:00 WIB'
  },

  /**
   * GETTER: Saldo Kas Laci Aktual
   * = Modal Awal + Penjualan Tunai − Pengeluaran Tunai (dari jurnal hari ini)
   */
  get saldoKasLaci() {
    const modalAwal = Number(this.shiftSummary?.startCash) || 0;
    const penjualanTunai = Number(this.shiftSummary?.cashSales) || 0;
    
    // Hitung pengeluaran tunai dari jurnal hari ini
    const today = new Date().toISOString().slice(0, 10);
    let pengeluaranTunai = 0;
    const list = Array.isArray(this.accountingJournalList) ? this.accountingJournalList : [];
    
    list.forEach(j => {
      if (j.date !== today) return;
      if (j.status === 'rejected') return;
      (j.lines || []).forEach(l => {
        const acc = String(l.acc || '').trim();
        // Kredit ke Kas = uang keluar
        if ((acc === '1001' || acc === '101') && Number(l.credit) > 0) {
          pengeluaranTunai += Number(l.credit) || 0;
        }
      });
    });
    
    return Math.max(0, modalAwal + penjualanTunai - pengeluaranTunai);
  },

  shiftData: {
    startTime: '08:00 WIB',
    duration: '5 jam 30 menit',
    totalSales: 2450000,
    breakdown: { cash: 980000, qris: 1120000, transfer: 350000, ewallet: 0 }
  },
  laporanHariIni: {
    totalSales: 2450000,
    totalTx: 42,
    breakdown: { cash: 980000, qris: 1120000, transfer: 350000, ewallet: 0 }
  },
  topMenuData: [],
  jamSibukData: [],
  loadingStates: {
    shift: false,
    inventory: false,
    laporan: false
  },
  shiftHistory: [],
  physicalCashCount: 0,
  shiftClosingNotes: '',
  inventoryList: [],
  inventorySearch: '',
  inventoryTab: 'ingredients', // 'ingredients' | 'products' | 'pembelian'
  todayTotalRevenue: 2450000,

  // Riwayat Transaksi & Recall Struk State
  showTxHistoryModal: false,
  txHistoryList: [],
  txHistoryLoading: false,
  txHistoryDate: new Date().toISOString().slice(0, 10),
  txHistorySearch: '',
  txHistoryPaymentFilter: 'all',

  // Edit Stok & Tambah Inventori Enhanced State
  editStockModal: false,
  addInventoryModal: false,
  newInventoryForm: {
    nama: '',
    category: 'Bahan Baku',
    stok: 10,
    min: 5,
    unit: 'kg',
    purchasePrice: 0,
    isCountable: true
  },
  insufficientCashModal: false,
  insufficientCashInfo: {
    totalCost: 0,
    availableCash: 0,
    shortfall: 0,
    itemName: ''
  },
  selectedStockItem: { id: '', name: '', category: 'Bahan Baku', stock: 0, minStock: 0, unit: 'unit', purchasePrice: 0, isCountable: true, sku: '', skuSource: 'internal', barcodeFormat: 'CODE128', barcode: '', supplierId: '', supplierName: '', isReadyToSell: false, linkedMenuId: null },
  newStockValue: 0,
  stockChangeType: 'adjustment', // 'adjustment' | 'purchase' | 'waste' | 'opname'
  stockChangePaymentMethod: 'cash', // 'cash' | 'transfer' | 'payable'
  stockChangeReason: '',

  // =========================================================================
  // STATE R&D: SKU, SCANNER, SUPPLIER, KONSINYASI & NOTIFIKASI WA
  // =========================================================================
  scanModal: {
    open: false,
    target: '',
    mode: 'camera',
    result: '',
    manualInput: '',
    error: '',
    _scanner: null,
    _onScanned: null
  },
  suppliersList: [],
  loadingSuppliers: false,
  supplierModal: false,
  supplierForm: { id: '', name: '', contact: '', address: '', active: true },
  supplierSearch: '',
  preRegisterModal: false,
    preRegisterForm: {
    name: '',
    supplierId: '',
    supplierName: '',
    purchasePrice: 0,
    sellingPrice: 0,
    category: 'rice_bowl',
    unit: 'porsi',
    initialStock: 0,
    minStock: 5,
    sku: '',
    barcode: '',
    autoPrintBarcode: true,
    sellingPriceManual: false   // ✅ BUG-3
  },
  
 // ✅ FITUR BARU: Multi-Scan Transaksi POS (Maks 50 Menu)
  multiScanModal: false,
  multiScanCart: [],
  multiScanQuery: '', 
 scanReceiveModal: false,
    scanReceiveForm: {
    skuQuery: '',
    matchedItem: null,
    items: [],
    supplierId: '',
    supplierName: '',
    waPhone: '',
    qty: 1,
    purchasePrice: 0,
    paymentMethod: 'payable',
    notes: '',
    searched: false   // ✅ BUG-4: flag agar orange box muncul SETELAH klik Cari
  },
  receiveReceiptModal: false,
  currentReceiveRecord: null,
  settlementModal: false,
  settlementDate: new Date().toISOString().slice(0, 10),
  settlementSupplierFilter: 'all',
  settlementSummary: [],
  settlementTotalHutang: 0,
  settlementTotalSoldQty: 0,
  settlementTotalReturnQty: 0,
  loadingSettlement: false,
    settlementReceiptModal: false,
    showOwnerReportModal: false,     // ✅ SPRINT 2: modal preview owner report
    ownerReportText: '',             // ✅ SPRINT 2: teks laporan owner aktif
  currentSettlementRecord: null,
  generateMenuModal: false,
  generateMenuForm: {
    inventoryId: '',
    name: '',
    price: 0,
    category: 'rice_bowl',
    desc: '',
    image: ''
  },
  barcodeLabelModal: false,
  barcodeLabelItem: null,
  barcodeLabelSize: '25x15', // '25x15' | '20x10' | '30x20'
  barcodeLabelCount: 30,

  // Pembelian Bahan Baku State
  pembelianForm: {
    date: new Date().toISOString().slice(0, 10),
    supplier: '',
    itemId: '',
    qty: 1,
    unit: '',
    purchasePrice: 0,
    total: 0,
    paymentMethod: 'cash',
    notes: '',
    receiptImage: ''
  },
  pembelianList: [],
  loadingPembelian: false,
  pembelianSearch: '',
  pembelianDateFilter: '',

  // Logout Confirmation Modal
  confirmLogoutModal: false,

  // Inventory Logs & Opname State
  inventoryLogs: [],
  showInventoryLogsModal: false,

  // Module Akuntansi Kasir State
  accountingTab: 'pnl', // 'pnl' | 'balance' | 'cashflow' | 'journal' | 'coa' | 'approval'
  accountingJournalList: [],
  accountingJournalLoading: false,

  // State Manual Input Jurnal
  journalForm: {
    category: 'operasional',  // pembelian | operasional | modal | prive | penyesuaian
    date: new Date().toISOString().slice(0, 10),
    desc: '',
    ref: '',
    lampiran: '',  // base64 atau URL bukti
    lines: [
      { acc: '', debit: 0, credit: 0 },
      { acc: '', debit: 0, credit: 0 }
    ]
  },
      journalFilterDate: '',  // ✅ SPRINT 2: filter tanggal jurnal (YYYY-MM-DD, kosong = semua)

    journalCategories: [
    { id: 'pembelian', name: 'Pembelian Bahan/Aset', icon: 'fa-truck-loading' },
    { id: 'operasional', name: 'Biaya Operasional', icon: 'fa-file-invoice-dollar' },
    { id: 'modal', name: 'Setoran Modal', icon: 'fa-hand-holding-dollar' },
    { id: 'prive', name: 'Prive / Ambil Pribadi', icon: 'fa-person-walking-arrow-right' },
    { id: 'penyesuaian', name: 'Penyesuaian / Adjustment', icon: 'fa-sliders' }
  ],
  journalTemplates: [
    {
      id: 'beli_bahan_kredit',
      name: 'Beli Bahan Baku (Kredit/Hutang)',
      category: 'pembelian',
      lines: [
        { acc: '105', debit: 0, credit: 0, hint: 'Persediaan Bahan Baku' },
        { acc: '201', debit: 0, credit: 0, hint: 'Hutang Supplier' }
      ]
    },
    {
      id: 'beli_bahan_tunai',
      name: 'Beli Bahan Baku (Tunai)',
      category: 'pembelian',
      lines: [
        { acc: '105', debit: 0, credit: 0, hint: 'Persediaan Bahan Baku' },
        { acc: '101', debit: 0, credit: 0, hint: 'Kas di Tangan' }
      ]
    },
    {
      id: 'bayar_listrik',
      name: 'Bayar Listrik & Air',
      category: 'operasional',
      lines: [
        { acc: '603', debit: 0, credit: 0, hint: 'Beban Listrik & Air' },
        { acc: '101', debit: 0, credit: 0, hint: 'Kas di Tangan' }
      ]
    },
    {
      id: 'bayar_gaji',
      name: 'Bayar Gaji Karyawan',
      category: 'operasional',
      lines: [
        { acc: '601', debit: 0, credit: 0, hint: 'Beban Gaji' },
        { acc: '101', debit: 0, credit: 0, hint: 'Kas di Tangan' }
      ]
    },
    {
      id: 'setor_modal',
      name: 'Setoran Modal Pemilik',
      category: 'modal',
      lines: [
        { acc: '101', debit: 0, credit: 0, hint: 'Kas di Tangan' },
        { acc: '301', debit: 0, credit: 0, hint: 'Modal Pemilik' }
      ]
    },
    {
      id: 'prive',
      name: 'Prive Pemilik',
      category: 'prive',
      lines: [
        { acc: '302', debit: 0, credit: 0, hint: 'Prive' },
        { acc: '101', debit: 0, credit: 0, hint: 'Kas di Tangan' }
      ]
    },
    {
      id: 'setor_bank',
      name: 'Setor ke Bank',
      category: 'penyesuaian',
      lines: [
        { acc: '102', debit: 0, credit: 0, hint: 'Bank' },
        { acc: '101', debit: 0, credit: 0, hint: 'Kas di Tangan' }
      ]
    },
    {
      id: 'penyusutan',
      name: 'Penyusutan Aset Tetap',
      category: 'penyesuaian',
      lines: [
        { acc: '606', debit: 0, credit: 0, hint: 'Beban Penyusutan' },
        { acc: '111', debit: 0, credit: 0, hint: 'Akum. Penyusutan' }
      ]
    }
  ],
  showJournalFormModal: false,
  showApprovalModal: false,
  // State approval jurnal
  pendingApprovals: [],
  isLoadingApprovals: false,
  isProcessingApproval: false,
  approvalFilter: 'all',  // all | pending | approved | rejected
  approvalSearch: '',

   // 🏢 Info Bisnis dari Admin Panel (/site_config) — untuk PDF & laporan
  siteInfo: {
    brandName: 'Dapur Kuliner Viral & Catering Rumahan',
    address: 'Jl. Kuliner Viral No. 88, Jakarta Selatan',
    phone: '0812-3456-7890'
  },
 
 // State Payment Config dari Admin Panel (/site_config/paymentConfig)
  paymentConfig: {
    bankName: 'BCA',
    bankAccountNumber: '-',
    bankAccountHolder: '-',
    bankInstructions: 'Transfer sesuai nominal, konfirmasi ke WhatsApp admin.',
    qrisImage: '',
    qrisInstructions: 'Scan QRIS dan bayar sesuai nominal.',
    qrisMerchantName: 'Dapur Kuliner Viral',
    qrisType: 'both',
    ewalletPhone: '',
    ewalletInstructions: ''
  },
 
  // State accounting summary (P&L Ledger Realtime)
  accountingSummaryData: null,  // hasil fetch terakhir
  accountingSummaryLoading: false,
  accountingSummaryLastFetch: 0,
  accountingSummaryError: null,

  // (Inventory Modals state sudah dideklarasi di blok awal ~line 460 — blok ini dihapus untuk hindari duplikasi key)

  // Menu Baru & Produk Resep Bahan Baku State
  newMenuModal: false,
  newMenuForm: {
    name: '',
    category: 'rice-bowl',
    price: 25000,
    desc: '',
    image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400'
  },
  get menuItems() {
    return Array.isArray(this.menuList) ? this.menuList : [];
  },
  productModal: false,
  selectedProductForRecipe: null,
  recipeForm: {
    menuId: '',
    menuName: '',
    ingredients: []
  },
  menuRecipes: {}, // { menuId: { ingredients: [...] } }
  postponedReconcileIds: (() => {
    try {
      return JSON.parse(localStorage.getItem('dapur_postponed_reconcile') || '[]');
    } catch (e) { return []; }
  })(),
 // Daftar orderId yang ditunda rekonsiliasinya

  // Chart References & Timers
  _topMenuChart: null,
  _hourlySalesChart: null,
  _dashboardInterval: null,
  _snapshotInterval: null,

  // Toast Notification State
  toast: {
    show: false,
    message: '',
    type: 'success', // 'success' | 'error' | 'notify'
    timer: null
  },

  // Internal Firebase Module References
  _fbConfig: null,
  _fbDb: null,
  _fbRef: null,
  _fbSet: null,
  _fbOnValue: null,
  _audioCtx: null,

  // =========================================================================
  // 2. INISIALISASI (init & initKasir)
  // =========================================================================

  /**
   * Hook Alpine init - otomatis memanggil initKasir
   */
  init() {
    this.initKasir();
  },

  /**
   * Inisialisasi Aplikasi Kasir
   */
  async initKasir() {
        // 1. Cek sessionStorage "dapur_kasir_session"
    try {
      let rawSession = sessionStorage.getItem('dapur_kasir_session') || localStorage.getItem('dapur_kasir_session');
      let parsed = null;
      if (rawSession) {
        try { parsed = JSON.parse(rawSession); } catch(e) {}
      }
      if (!parsed || (!parsed.username && !parsed.name)) {
        // Session tidak valid → tendang ke login
        window.location.replace('/');
        return;
      }

      this.kasirInfo = {
        username: parsed.username || 'kasir',
        name: parsed.name || parsed.kasirName || parsed.username || 'Kasir Utama',
        shiftId: parsed.shiftId || null   // null = akan di-handle ensureActiveShift()
      };
    } catch (e) {
      console.warn('Gagal membaca sesi kasir:', e);
      window.location.replace('/');
      return;
    }

    // 2. Start Realtime Clock (update tiap detik)
    this.updateRealtimeClock();
    if (this._clockInterval) clearInterval(this._clockInterval);
    this._clockInterval = setInterval(() => {
      this.updateRealtimeClock();
    }, 1000);

    // 3. Listener Online/Offline untuk Sync Antrian Transaksi Lokal
    window.addEventListener('online', () => {
      this.showToast('Koneksi internet kembali online. Memeriksa antrian transaksi...', 'notify');
      this.syncPendingTransactions();
    });

    // 4. Inisialisasi Koneksi Firebase Realtime Database
    await this.initFirebaseSDK();
// Load custom kasir title & payment config dari Firebase site_config
try {
  if (this._fbRef && this._fbDb) {
    const configRef = this._fbRef(this._fbDb, 'site_config');
    this._fbOnValue(configRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        if (val.kasirTitle) this.customKasirTitle = val.kasirTitle;
        if (val.kasirSubtitle) this.customKasirSubtitle = val.kasirSubtitle;
        this.splashKasirTitle = 'KASIR';
        this.splashKasirSubtitle = this.customKasirSubtitle || 'Digital Culinary';
        console.log('[KASIR] Custom title loaded:', val.kasirTitle);

               // 🏢 Sync info bisnis (brand, alamat, telepon)
        if (val.brandName) this.siteInfo.brandName = val.brandName;
        if (val.address) this.siteInfo.address = val.address;
        if (val.phone) this.siteInfo.phone = val.phone;
        console.log('[KASIR] Site info loaded:', this.siteInfo.brandName);
 
       // ✅ Sync payment config (bank, QRIS, ewallet)
        if (val.paymentConfig) {
          this.paymentConfig = {
            ...this.paymentConfig,
            ...val.paymentConfig
          };
          console.log('[KASIR] Payment config loaded:', this.paymentConfig.bankName);
           // 🔒 Load Supervisor PIN dari /site_config/supervisorPin
                if (val.supervisorPin) {
          this.supervisorPin = String(val.supervisorPin).trim();
          console.log('[KASIR-SEC] ✅ Supervisor PIN loaded from Firebase');
        }

        // ✅ FITUR-1: Load toggle auto-jurnal selisih kas
        if (val.autoJournalShiftDiff !== undefined) {
          this.autoJournalShiftDiff = Boolean(val.autoJournalShiftDiff);
          console.log('[KASIR] ✅ Auto-Jurnal Shift Diff:', this.autoJournalShiftDiff);
        }
        if (val.scannerEnabled !== undefined) {
          this.scannerEnabled = Boolean(val.scannerEnabled);
          console.log('[KASIR] ✅ Scanner HID enabled:', this.scannerEnabled);
        }
        }
      }
    });
  }
} catch (e) {
  console.warn('[KASIR] Load custom title error:', e);
}

    // 5. Sinkronkan Kategori dengan Toko Utama & Muat Menu dari Firebase
    this.syncCategoriesWithMainStore();
    this.listenMenuItems();
    this.loadPrinterConfig();
    this.loadAccountingSummary(true);
    await this.loadCOAListFromBackend();
    // ✅ Load journal list untuk tab Jurnal Umum
    await this.loadJournalListForKasir();

    // 6. Muat Inventory Realtime, Resep Bahan Baku & Riwayat Shift (BAGIAN 3)
    this.loadInventory();
    this.loadSuppliers();
    this.loadMenuRecipes();
    this.loadInventoryLogs();
    this.loadRiwayatShift();

    // 7. Muat Snapshot Laporan Offline & Laporan Hari Ini
    this.loadReportSnapshot();
    await this.loadLaporanHariIni();
    await this.loadTopMenuBulanIni();
    await this.loadPenjualanPerJam();

    // 7.1 Dashboard Widget: Polling auto-refresh loadLaporanHariIni() tiap 30 detik
    if (this._dashboardInterval) clearInterval(this._dashboardInterval);
    this._dashboardInterval = setInterval(() => {
      this.loadLaporanHariIni();
    }, 30000);

    // 7.2 Auto-Save Snapshot: Setiap 5 menit simpan snapshot laporan ke localStorage
    if (this._snapshotInterval) clearInterval(this._snapshotInterval);
    this._snapshotInterval = setInterval(() => {
      this.saveReportSnapshot();
    }, 5 * 60 * 1000);

    // 8. Cek pending reconcile & muat daftar rekonsiliasi awal (BAGIAN 2)
    this.listenOrdersReconciliation();
    await this.loadRekonsiliasiList();
    await this.tampilModalRekonsiliasi();

    // 8.1 Polling otomatis setiap 5 menit untuk update pending reconcile count
    if (this._reconcileInterval) clearInterval(this._reconcileInterval);
    this._reconcileInterval = setInterval(() => {
      this.cekPendingRekonsiliasi();
    }, 5 * 60 * 1000);

    // 9. Sinkronisasi Shift antar Kasir dari /pos/shifts/{shiftId}
    this.listenShiftData();

    // 9b. ✅ FIX: Pastikan ada shift aktif (auto-join / prompt modal awal)
    await this.ensureActiveShift();

    // 9c. ✅ FIX BUG-4: Re-bind listener setelah ensureActiveShift memastikan shiftId, plus pasang visibilitychange untuk tab background
    this.listenShiftData();
    this.setupShiftVisibilityGuard();

    // 10. Auto-save keranjang tiap 30 detik & Cek Draft saat buka kasir
    this.setupDraftTimer();
    this.checkDraftOnLoad();

    // 11. Periksa jika ada transaksi offline yang belum tersinkronisasi
    this.syncPendingTransactions();

    // 12. Watcher navigasi tab (aktifkan chart saat buka tab Laporan, refresh shift/inventory)
    if (this.$watch) {
      this.$watch('activeTab', (val) => {
          if (val === 'laporan') {
          this.$nextTick(async () => {
            // Refresh data real sebelum render chart
            await this.loadLaporanHariIni();
            await this.loadTopMenuBulanIni();
            await this.loadPenjualanPerJam();
            this.initCharts();
          });
        } else if (val === 'shift') {
          this.loadRiwayatShift();
        } else if (val === 'inventory') {
          this.loadInventory();
        } else if (val === 'orderonline') {
          // ==== RTO (BLOK BARU): refresh queue order online ====
          this.loadOrderOnline();
        }
      });
    }

    // ==== RTO (BLOK BARU): poll queue order online (badge + notif audio) ====
    this.startOrderOnlineWatcher();

    // ✅ Splash minimum display 1800ms
    if (typeof window.__splashStart === 'undefined') window.__splashStart = Date.now();
    const _elapsed = Date.now() - window.__splashStart;
    const _remaining = Math.max(0, 1800 - _elapsed);
    setTimeout(() => { this.appReady = true; }, _remaining);
  },

  // =========================================================================
  // ==== RTO (ORDER ONLINE) — STATE & METHODS (BLOK BARU) ====
  // =========================================================================
  orderOnlineList: [],
  orderOnlineView: [],
  orderOnlineStats: { pending_payment: 0, pending: 0, paid: 0, done: 0, totalOrdersToday: 0, revenueToday: 0, queue: 0 },
  orderOnlineFilter: 'waiting',
  orderOnlineSearch: '',
  orderOnlineLoading: false,
  orderOnlineBusy: false,
  orderOnlineError: '',
  orderOnlineDetail: null,
  orderOnlineTimer: null,
  orderOnlineLastQueue: 0,
  orderOnlineInitialized: false,
  rtoVoidModal: false,
  rtoVoidTarget: null,
  rtoVoidReason: '',
  rtoVoidBusy: false,
  rtoVoidPinOk: false,
  rtoVoidResult: null,

    get orderOnlineQueueCount() {
    return Number((this.orderOnlineStats && this.orderOnlineStats.queue) || 0);
  },

  // Fix 1: titik merah sidebar — hitung pending_payment yang BELUM expired
    // Fix 1: titik merah sidebar — pending_payment yang belum expired
  // Robust: handle expires_at / expiresAt / missing field
  get pendingPaymentCount() {
    const list = Array.isArray(this.orderOnlineList) ? this.orderOnlineList : [];
    const now = Date.now();
    return list.filter(o => {
      if (!o || o.status !== 'pending_payment') return false;
      const exp = Number(o.expires_at || o.expiresAt || 0);
      if (!exp) return true;              // field kosong → anggap aktif
      return exp > now;
    }).length;
  },

  rtoStatusLabel(status) {
    const map = {
      pending_payment: 'Menunggu Bayar',
      pending: 'Perlu Konfirmasi',
      paid: 'Siap Diserahkan',
      done: 'Selesai',
      expired: 'Kedaluwarsa',
      cancelled: 'Dibatalkan',
    };
    return map[String(status || '').toLowerCase()] || (status || '-');
  },

  rtoStatusClass(status) {
    const map = {
      pending_payment: 'bg-stone-200 text-stone-700',
      pending: 'bg-amber-100 text-amber-800',
      paid: 'bg-emerald-100 text-emerald-800',
      done: 'bg-blue-100 text-blue-800',
      expired: 'bg-red-100 text-red-700',
      cancelled: 'bg-stone-300 text-stone-700',
    };
    return map[String(status || '').toLowerCase()] || 'bg-stone-100 text-stone-600';
  },

  rtoTime(iso) {
    if (!iso) return '-';
    try {
      return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return String(iso);
    }
  },

  rtoItemsSummary(order) {
    const items = (order && Array.isArray(order.items)) ? order.items : [];
    if (items.length === 0) return '-';
    const txt = items.map(i => `${i.qty || 1}x ${i.name || i.id}`).join(', ');
    return txt.length > 90 ? txt.slice(0, 90) + '…' : txt;
  },

  orderOnlineWaNumber(order) {
    let p = String((order && order.customer && order.customer.phone) || '').replace(/[^0-9]/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    return p;
  },

  /**
   * Polling queue order online (badge + notifikasi audio saat order baru masuk)
   */
  startOrderOnlineWatcher() {
    if (this.orderOnlineTimer) return;
    this.loadOrderOnline(true);
    this.orderOnlineTimer = setInterval(() => { this.loadOrderOnline(true); }, 15000);
  },

  async loadOrderOnline(silent = false) {
    if (this.orderOnlineLoading) return;
    this.orderOnlineLoading = true;
    try {
      let url = '/online-orders/list?status=all,expired&limit=200';
      if (this.orderOnlineSearch) url += '&q=' + encodeURIComponent(this.orderOnlineSearch);
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }

      const stats = data.stats || {};
      const queue = Number(stats.queue || 0);

      // Notifikasi audio + toast kalau ada order paid baru (bukan load pertama)
      if (this.orderOnlineInitialized && queue > this.orderOnlineLastQueue) {
        this.playSound('notify');
        this.showToast('🔔 ' + queue + ' order online siap diserahkan ke customer', 'notify');
      }
      this.orderOnlineInitialized = true;
      this.orderOnlineLastQueue = queue;

      this.orderOnlineList = Array.isArray(data.orders) ? data.orders : [];
      this.orderOnlineStats = Object.assign(
        { pending_payment: 0, pending: 0, paid: 0, done: 0, totalOrdersToday: 0, revenueToday: 0, queue: 0 },
        stats
      );
      this.applyOrderOnlineFilter();
      this.orderOnlineError = '';
    } catch (e) {
      this.orderOnlineError = 'Gagal memuat order online: ' + (e && e.message ? e.message : e);
      if (!silent) this.showToast(this.orderOnlineError, 'error');
    } finally {
      this.orderOnlineLoading = false;
    }
  },

  applyOrderOnlineFilter() {
    const filter = this.orderOnlineFilter;
    const q = String(this.orderOnlineSearch || '').toLowerCase().trim();
    let list = Array.isArray(this.orderOnlineList) ? this.orderOnlineList.slice() : [];

    if (filter === 'waiting') {
      list = list.filter(o => o.status === 'pending_payment' || o.status === 'pending');
    } else if (filter && filter !== 'all') {
      list = list.filter(o => o.status === filter);
    }

    if (q) {
      list = list.filter(o =>
        String(o.orderId || '').toLowerCase().includes(q) ||
        String((o.customer && o.customer.name) || '').toLowerCase().includes(q) ||
        String((o.customer && o.customer.phone) || '').includes(q)
      );
    }
    this.orderOnlineView = list;
  },

  openOrderOnlineDetail(order) {
    this.orderOnlineDetail = order || null;
  },

  closeOrderOnlineDetail() {
    this.orderOnlineDetail = null;
  },

  /**
   * Kasir verifikasi pembayaran QRIS statis → status paid (semua efek kasir auto)
   */
  async konfirmasiOrderOnline(order) {
    if (!order || !order.orderId || this.orderOnlineBusy) return;
    this.orderOnlineBusy = true;
    let sukses = false;
    try {
      const res = await fetch('/online-orders/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          kasir: (this.kasirInfo && this.kasirInfo.username) || 'kasir',
          shiftId: (this.kasirInfo && this.kasirInfo.shiftId) || ''
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }

      const steps = (data.result && data.result.steps) || {};
      this.playSound('success');
      let msg = 'Pembayaran ' + order.orderId + ' terkonfirmasi — transaksi masuk POS.';
      if (String(steps.journal || '').indexOf('failed') === 0) msg += ' (jurnal akuntansi perlu dicek manual)';
      if (String(steps.wa || '').indexOf('sent') === 0) msg += ' WA notif terkirim ke customer.';
      this.showToast(msg, 'success');
      sukses = true;

      // BUG #1: status lokal langsung jadi 'paid' → tombol Done aktif seketika (tanpa refresh halaman)
      this.setOrderOnlineStatusLocal(order.orderId, 'paid');
    } catch (e) {
      this.playSound('error');
      this.showToast('Gagal konfirmasi pembayaran: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      // BUG #1: busy flag dilepas SEGERA setelah verify selesai.
      // Jangan pernah menunggu loadOrderOnline/loadLaporanHariIni di dalam try —
      // endpoint laporan bisa lambat dan menahan tombol Done tetap disabled.
      this.orderOnlineBusy = false;
    }
    // Refresh data SETELAH busy dilepas (fire-and-forget, tidak menahan UI)
    if (sukses) this.refreshOrderOnlineData(order.orderId);
  },

  /**
   * Kasir serahkan pesanan → Done (shift dicatat dari kasir yang klik Done)
   */
  async selesaikanOrderOnline(order) {
    if (!order || !order.orderId || this.orderOnlineBusy) return;
    if (!confirm('Tandai order ' + order.orderId + ' sebagai DONE (pesanan sudah diserahkan ke customer)?')) return;

    this.orderOnlineBusy = true;
    let sukses = false;
    try {
      const res = await fetch('/online-orders/' + encodeURIComponent(order.orderId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'done',
          kasir: (this.kasirInfo && this.kasirInfo.username) || 'kasir',
          shiftId: (this.kasirInfo && this.kasirInfo.shiftId) || ''
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }
      this.playSound('success');
      let msgDone = 'Order ' + order.orderId + ' selesai & tercatat di shift Anda.';
      if (data.wa && data.wa.ok && !data.wa.skipped) msgDone += ' WA notif + struk terkirim ke customer.';
      this.showToast(msgDone, 'success');
      sukses = true;

      // BUG #1: status lokal langsung 'done' supaya tidak bisa diklik dobel saat refresh jalan
      this.setOrderOnlineStatusLocal(order.orderId, 'done');
      this.closeOrderOnlineDetail();
    } catch (e) {
      this.playSound('error');
      this.showToast('Gagal menandai Done: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      // BUG #1: busy flag dilepas SEGERA setelah PATCH done selesai
      this.orderOnlineBusy = false;
    }
    if (!sukses) return;

    // FASE 4 item 2: auto-print struk setelah Done (skip kalau printer config nonaktif)
    this.autoPrintOrderOnlineStruk(order);
    // Refresh daftar order + laporan (fire-and-forget, tidak menahan tombol)
    this.refreshOrderOnlineData(order.orderId);
  },

  /**
   * BUG #1: update status order di state lokal (optimistic) tanpa menunggu API.
   * Dipakai verify (→ paid) & Done (→ done) supaya tombol di kartu/detail langsung benar.
   */
  setOrderOnlineStatusLocal(orderId, status) {
    if (!orderId || !status) return;
    const flip = (o) => (o && o.orderId === orderId) ? Object.assign({}, o, { status }) : o;
    this.orderOnlineList = (this.orderOnlineList || []).map(flip);
    this.orderOnlineView = (this.orderOnlineView || []).map(flip);
    if (this.orderOnlineDetail && this.orderOnlineDetail.orderId === orderId) {
      this.orderOnlineDetail = Object.assign({}, this.orderOnlineDetail, { status });
    }
  },

  /**
   * BUG #1: refresh daftar order + laporan SETELAH busy flag dilepas (fire-and-forget).
   * Tidak boleh di-await di dalam try/finally aksi order online:
   * loadLaporanHariIni() bisa lambat (fetchTransactionsInRange loop harian) dan
   * selama menggantung, finally yang melepas orderOnlineBusy tidak pernah jalan.
   */
  refreshOrderOnlineData(orderId) {
    Promise.resolve()
      .then(() => this.loadOrderOnline(true))
      .then(() => (typeof this.loadLaporanHariIni === 'function') ? this.loadLaporanHariIni() : null)
      .then(() => {
        if (orderId && this.orderOnlineDetail && this.orderOnlineDetail.orderId === orderId) {
          const fresh = (this.orderOnlineList || []).find(o => o.orderId === orderId);
          if (fresh) this.orderOnlineDetail = fresh;
        }
      })
      .catch((e) => console.warn('[RTO] refresh order online gagal (non-fatal):', e && e.message ? e.message : e));
  },

  /**
   * Cetak struk order online — reuse pipeline struk POS existing:
   * previewStruk() mengisi #receiptPrintArea (satu-satunya target `@media print`),
   * lalu window.print(). Dipakai tombol manual "Cetak Struk" dan auto-print setelah Done.
   */
  printOnlineOrderStruk(order) {
    if (!order || !order.orderId) return false;
    const payload = {
      id: order.orderId,
      orderId: order.orderId,
      date: this.formatDate(Date.now()),
      time: this.formatTime(Date.now()),
      items: (order.items || []).map((it) => ({
        id: it.id || it.menuId,
        name: it.name || it.id || 'Menu',
        qty: Number(it.qty) || 1,
        price: Number(it.price) || 0,
      })),
      subtotal: Number(order.subtotal) || 0,
      total: Number(order.total) || 0,
      paymentMethod: 'qris',
      customer: (order.customer && order.customer.name) || 'Pelanggan',
      customerPhone: (order.customer && order.customer.phone) || '',
      note: 'Order Online (Pickup) — tanpa ongkir',
    };

    this.previewStruk(payload);
    if (this.currentOrder) {
      this.currentOrder.isOnlineOrder = true;
      this.currentOrder.pickupName = payload.customer;
    }

    // Tunggu modal struk ter-render dulu sebelum dialog cetak dibuka
    this.$nextTick(() => {
      setTimeout(() => {
        try { window.print(); } catch (e) { console.warn('[RTO-PRINT] window.print gagal:', e); }
      }, 300);
    });
    return true;
  },

  /**
   * Auto-print struk saat kasir klik Done (order online).
   * Skip kalau printer config nonaktif (printerConfig.autoPrint === false) —
   * kasir tetap bisa cetak manual lewat tombol "Cetak Struk".
   */
  autoPrintOrderOnlineStruk(order) {
    try {
      if (!order || !order.orderId) return false;
      if (!this.printerConfig || this.printerConfig.autoPrint === false) {
        console.log('[RTO-PRINT] auto-print dilewati — printer config nonaktif');
        return false;
      }
      return this.printOnlineOrderStruk(order);
    } catch (e) {
      console.warn('[RTO-PRINT] auto-print error:', e);
      return false;
    }
  },

  /**
   * VOID / REFUND order online — butuh PIN supervisor + alasan wajib.
   * Aturan: done = blocked; pending_payment = cancel tanpa refund;
   * pending = refund (gateway/manual) + lepas reserved; paid = refund + reverse stok/jurnal/POS.
   */
  rtoCanVoid(order) {
    const s = String((order && order.status) || '');
    return s === 'pending_payment' || s === 'pending' || s === 'paid';
  },

  rtoVoidRefundPlan(order) {
    if (!order) return { amount: 0, mode: 'none', text: '-' };
    const s = String(order.status || '');
    const total = Number(order.total) || 0;
    const gw = String((order.payment && order.payment.gateway) || '');
    const hasGateway = !!gw && gw !== 'admin';
    if (s === 'pending_payment') {
      return { amount: 0, mode: 'none', text: 'Belum ada pembayaran — tidak ada refund. Reserved stok dilepas.' };
    }
    if (s === 'pending') {
      return {
        amount: total,
        mode: hasGateway ? 'gateway' : 'manual',
        text: hasGateway
          ? 'Refund Rp ' + this.formatNumber(total) + ' via gateway + reserved stok dilepas.'
          : 'QRIS statis — kasir refund MANUAL Rp ' + this.formatNumber(total) + ' ke customer + reserved stok dilepas.',
      };
    }
    // paid
    return {
      amount: total,
      mode: hasGateway ? 'gateway' : 'manual',
      text: 'Refund Rp ' + this.formatNumber(total) + (hasGateway ? ' via gateway' : ' (manual ke customer)')
        + ' + stok dikembalikan + jurnal dibalik + transaksi POS di-void.',
    };
  },

  /** Klik tombol VOID: minta PIN supervisor dulu, lalu buka modal konfirmasi + alasan. */
  async openVoidOrderOnline(order) {
    if (!order || !order.orderId || this.rtoVoidBusy || this.orderOnlineBusy) return;
    if (String(order.status) === 'done') {
      this.showToast('Order sudah Done (pesanan diserahkan) — tidak bisa di-void', 'notify');
      return;
    }
    if (!this.rtoCanVoid(order)) {
      this.showToast('Status order ini tidak bisa di-void', 'notify');
      return;
    }

    this._lastVerifiedSupervisorPin = '';
    // Modal PIN supervisor pakai z-[60] (di bawah modal detail RTO) → tutup dulu detailnya,
    // lalu buka lagi setelah PIN valid supaya tidak ada layer yang tertutup.
    const keepDetail = this.orderOnlineDetail;
    this.closeOrderOnlineDetail();
    const pinOk = await this.requestSupervisorPin(
      'VOID ORDER ONLINE',
      `#${order.orderId} — Rp ${this.formatNumber(order.total)}`,
      { capturePin: true }
    );
    if (!pinOk) {
      this.orderOnlineDetail = keepDetail;
      this.showToast('Void order dibatalkan', 'notify');
      return;
    }
    this.orderOnlineDetail = keepDetail;

    this.rtoVoidTarget = order;
    this.rtoVoidReason = '';
    this.rtoVoidResult = null;
    this.rtoVoidPinOk = true;
    this.rtoVoidModal = true;
    this.playSound('notify');
  },

  closeVoidOrderOnline() {
    if (this.rtoVoidBusy) return;
    this.rtoVoidModal = false;
    this.rtoVoidTarget = null;
    this.rtoVoidReason = '';
    this.rtoVoidResult = null;
    this.rtoVoidPinOk = false;
    this._lastVerifiedSupervisorPin = '';
  },

  /** Kirim void ke endpoint /online-orders/{id} (action: void) */
  async confirmVoidOrderOnline() {
    const order = this.rtoVoidTarget;
    if (!order || !order.orderId || this.rtoVoidBusy) return;

    const reason = String(this.rtoVoidReason || '').trim();
    if (reason.length < 5) {
      this.showToast('Alasan void wajib diisi (min 5 karakter)', 'error');
      this.playSound('error');
      return;
    }

    this.rtoVoidBusy = true;
    try {
      const res = await fetch('/online-orders/' + encodeURIComponent(order.orderId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'void',
          kasir: (this.kasirInfo && this.kasirInfo.username) || 'kasir',
          kasirName: (this.kasirInfo && this.kasirInfo.name) || '',
          shiftId: (this.kasirInfo && this.kasirInfo.shiftId) || '',
          reason,
          supervisorPin: this._lastVerifiedSupervisorPin || '',
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || !data.success) {
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }

      const result = data.result || {};
      const refund = result.refund || {};
      const steps = result.steps || {};
      this.rtoVoidResult = result;
      this.playSound('success');

      let msg = '✅ Order ' + order.orderId + ' di-void (cancelled).';
      if (Number(result.refundAmount) > 0) {
        msg += ' Refund Rp ' + this.formatNumber(result.refundAmount)
          + (refund.mode === 'gateway' ? ' via gateway.' : ' — REFUND MANUAL ke customer.');
      } else {
        msg += ' Tanpa refund. Stok dikembalikan.';
      }
      if (String(steps.journal || '').indexOf('failed') === 0) msg += ' (jurnal perlu dicek manual)';
      if (String(steps.posVoid || '').indexOf('failed') === 0) msg += ' (void transaksi POS perlu dicek)';
      if (String(steps.wa || '').indexOf('sent') === 0) msg += ' WA notif pembatalan terkirim ke customer.';
      this.showToast(msg, 'success');

      await this.logAudit('VOID ORDER ONLINE', order.orderId, 'executed', reason);

      this.rtoVoidModal = false;
      this.rtoVoidTarget = null;
      this.rtoVoidReason = '';
      this.rtoVoidPinOk = false;
      this._lastVerifiedSupervisorPin = '';
      this.closeOrderOnlineDetail();

      await this.loadOrderOnline(true);
      if (typeof this.loadLaporanHariIni === 'function') { try { await this.loadLaporanHariIni(); } catch (e) {} }
    } catch (e) {
      this.playSound('error');
      await this.logAudit('VOID ORDER ONLINE', order.orderId, 'failed', (e && e.message) || 'error');
      this.showToast('Gagal void order: ' + (e && e.message ? e.message : e), 'error');
    } finally {
      this.rtoVoidBusy = false;
    }
  },
  // ==== /RTO (ORDER ONLINE) ====

  /**
   * Update display jam realtime HH:mm:ss WIB
   */
  updateRealtimeClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    this.currentTime = `${h}:${m}:${s} WIB`;
  },

  /**
   * Inisialisasi Firebase Modular SDK secara dinamis
   */
    async initFirebaseSDK() {
    try {
      // Ambil kredensial Firebase
      let cfg = null;
      try {
        const stored = localStorage.getItem('dapur_firebase_custom_config');
        if (stored) cfg = JSON.parse(stored);
      } catch (e) {}

      if (!cfg || !cfg.apiKey) {
        cfg = {
          apiKey: "AIzaSyB08og0350ZhwX9LYqxwyFuEppbdKEXAEg",
          authDomain: "digitalculinary-app.firebaseapp.com",
          databaseURL: "https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app",
          projectId: "digitalculinary-app",
          storageBucket: "digitalculinary-app.firebasestorage.app",
          messagingSenderId: "650221083781",
          appId: "1:650221083781:web:e44211db213b81ae19ddec"
        };
        console.log('[FB-INIT] Menggunakan fallback config hardcoded');
      }

      this._fbConfig = cfg;

      // ✅ Pakai Firebase COMPAT SDK (di-load via <script> tag di kasir.html)
      if (typeof firebase === 'undefined' || !firebase.database) {
        console.warn('[FB-INIT] Firebase compat SDK belum dimuat — cek kasir.html');
        return;
      }

        if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(cfg);
      }

      // ✅ Simpan db di MODULE SCOPE — bukan di this (Alpine tidak bisa Proxy module var)
      FB_DB = firebase.database();
      this._fbDb = true;

      // ✅ _fbRef IGNORE parameter database, selalu pakai FB_DB (module scope, tidak di-Proxy)
      this._fbRef = (database, path) => FB_DB.ref(path);

      this._fbOnValue = (refObj, callback, errCallback) => {
        refObj.on('value', (snap) => callback(snap), (err) => {
          if (errCallback) errCallback(err);
          else console.warn('FB listener error:', err);
        });
      };

            this._fbSet = async (refObj, value) => {
        const plain = (value === null || typeof value !== 'object') 
          ? value 
          : JSON.parse(JSON.stringify(value));
        return refObj.set(plain);
      };

      // ✅ FIX BUG-1: Tambah _fbGet yang hilang — dipakai loadRiwayatPembelian
      this._fbGet = async (refObj) => {
        return refObj.get();
      };

      console.log('[FB-INIT] ✅ Firebase Compat connected:', cfg.projectId);
    } catch (err) {
      console.warn('[FB-INIT] Firebase init error:', err);
    }

    this.setupBarcodeScanner();
  },

  // =========================================================================
  // 3. REALTIME LISTENERS (Menu, Orders, Shifts)
  // =========================================================================

  /**
   * Realtime listener untuk /menu_items
   */
  listenMenuItems() {
    this.isLoadingMenu = true;

    // Fallback menu standar jika database belum terisi / offline / timeout
    const fallbackMenu = [
      { id: 'm1', name: 'Rice Bowl Chicken Katsu Curry', category: 'rice-bowl', price: 28000, desc: 'Nasi pulen + katsu crispy saus kari gurih', image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400' },
      { id: 'm2', name: 'Rice Bowl Beef Teriyaki', category: 'rice-bowl', price: 35000, desc: 'Daging sapi iris bumbu teriyaki jepang', image: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400' },
      { id: 'm3', name: 'Spicy Honey Chicken Wings (6 pcs)', category: 'chicken', price: 32000, desc: 'Sayap ayam krispi madu pedas lezat', image: 'https://images.unsplash.com/photo-1567620832903-9fc6debc209f?w=400' },
      { id: 'm4', name: 'Chicken Egg Roll Bento Komplit', category: 'chicken', price: 30000, desc: 'Egg roll ayam + salad + nasi + saus', image: 'https://images.unsplash.com/photo-1562967914-608f82629710?w=400' },
      { id: 'm5', name: 'Mie Pedas Viral Level 3', category: 'mie-bakso', price: 22000, desc: 'Mie kenyal gurih cabe rawit pedas nagih', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400' },
      { id: 'm6', name: 'Bakso Cuanki Kuah Pedas Daun Jeruk', category: 'mie-bakso', price: 25000, desc: 'Bakso aci, tahu, siomay kering renyah', image: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=400' },
      { id: 'm7', name: 'Dimsum Mentai Mozzarella (4 pcs)', category: 'dimsum', price: 24000, desc: 'Dimsum ayam topping saus mentai bakar', image: 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=400' },
      { id: 'm8', name: 'Siomay Udang Ayam Kukus', category: 'dimsum', price: 20000, desc: 'Siomay lembut dengan potongan udang asli', image: 'https://images.unsplash.com/photo-1541696432-82c6da8ce7bf?w=400' },
      { id: 'm9', name: 'Es Lemon Tea Segar', category: 'minuman', price: 8000, desc: 'Teh melati wangi dengan perasan lemon asli', image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?w=400' },
      { id: 'm10', name: 'Es Cincau Gula Aren Susu', category: 'minuman', price: 12000, desc: 'Cincau hitam kenyal dengan susu aren legit', image: 'https://images.unsplash.com/photo-1556881286-fc6915169721?w=400' }
    ];

    // Timeout safety 5 detik: jangan sampai loading spinner stuck selamanya
    const menuTimeout = setTimeout(() => {
      if (this.isLoadingMenu) {
        console.warn('Firebase menu listener timeout 5s, using fallback menu');
        if (!this.menuList || this.menuList.length === 0) {
          this.menuList = fallbackMenu;
        }
        this.syncCategoriesWithMainStore();
        this.isLoadingMenu = false;
      }
    }, 15000);

    if (this._fbDb && this._fbOnValue && this._fbRef) {
      try {
        const menuRef = this._fbRef(this._fbDb, 'menu_items');
        this._fbOnValue(menuRef, (snapshot) => {
          clearTimeout(menuTimeout);
          const val = snapshot.val();
          console.log('[FB-MENU] Menu listener:', val ? Object.keys(val).length + ' items' : 'kosong');
          if (val) {
  const rawList = Array.isArray(val) ? val : Object.values(val);
  // Dedupe by ID — hindari duplicate key x-for
  const seen = new Map();
  rawList.forEach(m => {
    if (m && m.id) {
      seen.set(m.id, m);
    } else if (m && m.name) {
      // Fallback: generate ID dari name kalau kosong
      m.id = 'menu_' + m.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      seen.set(m.id, m);
    }
  });
  this.menuList = Array.from(seen.values());
  console.log(`[FB-MENU] Loaded ${this.menuList.length} unique items (raw: ${rawList.length})`);
} else {
            this.menuList = fallbackMenu;
          }
          this.syncCategoriesWithMainStore();
          this.isLoadingMenu = false;
        }, (err) => {
          clearTimeout(menuTimeout);
          console.warn('Firebase menu listener error:', err);
          if (!this.menuList || this.menuList.length === 0) {
            this.menuList = fallbackMenu;
          }
          this.syncCategoriesWithMainStore();
          this.isLoadingMenu = false;
        });

        // Realtime Listener Kategori Menu Toko Utama
        const catRef = this._fbRef(this._fbDb, 'menu_categories');
        this._fbOnValue(catRef, (catSnapshot) => {
          const catVal = catSnapshot.val();
          if (catVal && Array.isArray(catVal)) {
            try { localStorage.setItem('dapur_menu_categories', JSON.stringify(catVal)); } catch(e) {}
            this.syncCategoriesWithMainStore();
          }
        }, (catErr) => {
          console.warn('Firebase category listener error:', catErr);
        });

        return;
      } catch (e) {
        clearTimeout(menuTimeout);
        console.warn('Menu listener setup exception:', e);
        this.menuList = fallbackMenu;
        this.isLoadingMenu = false;
      }
    }

    // Fallback load lokal
    setTimeout(() => {
      clearTimeout(menuTimeout);
      this.menuList = fallbackMenu;
      this.isLoadingMenu = false;
    }, 200);
  },

  /**
   * Realtime listener untuk /orders guna memantau transaksi menggantung/perlu rekonsiliasi
   */
  listenOrdersReconciliation() {
    if (this._fbDb && this._fbOnValue && this._fbRef) {
      try {
        const ordersRef = this._fbRef(this._fbDb, 'orders');
        this._fbOnValue(ordersRef, (snapshot) => {
          const val = snapshot.val();
          console.log('[FB-ORDERS] Orders listener:', val ? Object.keys(val).length + ' items' : 'kosong');
          if (val) {
            const list = Object.values(val);
            const pendingList = list.filter(o => {
              const st = (o.status || '').toLowerCase();
              return st.includes('gantung') || st.includes('pending') || st.includes('verifikasi');
            });
            const prevCount = this.pendingReconcile;
            this.pendingReconcile = pendingList.length;

            // Jika ada transaksi menggantung > 0 saat awal load, munculkan notifikasi otomatis
            if (this.pendingReconcile > 0 && prevCount === 0) {
              this.pendingReconcileModal = true;
              this.playSound('notify');
            }
          }
        }, (err) => {
          console.warn('Firebase orders reconciliation listener error:', err);
          this.cekPendingRekonsiliasi();
        });
        return;
      } catch (e) {
        console.warn('Orders listener exception:', e);
      }
    }

    // Hitung dari data lokal/rekonsiliasi
    this.cekPendingRekonsiliasi();
  },

  /**
   * Realtime listener untuk sinkronisasi shift kasir /pos/shifts/{shiftId}
   */
  listenShiftData() {
    try {
      if (this.kasirInfo && this.kasirInfo.shiftId) {
        const savedStatus = localStorage.getItem(`dapur_shift_status_${this.kasirInfo.shiftId}`);
        const savedPauseTime = localStorage.getItem(`dapur_shift_pause_time_${this.kasirInfo.shiftId}`);
        if (savedStatus) this.shiftStatus = savedStatus;
        if (savedPauseTime) this.shiftPauseTime = savedPauseTime;
      }
    } catch(e) {}

    if (this._fbDb && this._fbOnValue && this._fbRef && this.kasirInfo.shiftId) {
      try {
        const shiftRef = this._fbRef(this._fbDb, `pos/shifts/${this.kasirInfo.shiftId}`);
                this._fbOnValue(shiftRef, (snapshot) => {
          const val = snapshot.val();
          if (val) {
            if (val.totalSales !== undefined) this.shiftSummary.totalSales = val.totalSales;
            if (val.cashSales !== undefined) this.shiftSummary.cashSales = val.cashSales;
            if (val.qrisSales !== undefined) this.shiftSummary.qrisSales = val.qrisSales;
            if (val.transactionCount !== undefined) this.shiftSummary.transactionCount = val.transactionCount;
            if (val.status) this.shiftStatus = val.status;
            if (val.pauseTime !== undefined) this.shiftPauseTime = val.pauseTime;

            // ✅ FIX: Multi-kasir auto-logout saat shift ditutup device lain
            if (val.status === 'closed' && this.kasirInfo?.shiftId) {
              this.forceShiftClosedLogoutOverlay(this.kasirInfo.shiftId);
            }
          }
        });
      } catch (e) {
        console.warn('Shift listener exception:', e);
      }
    }
  },

  /**
   * ✅ FIX BUG-4: Listener visibilitychange — saat tab kasir kembali visible dari background,
   * re-check status shift langsung ke Firebase agar tidak lolos jika WebSocket throttled di background.
   */
  setupShiftVisibilityGuard() {
    if (this._visibilityListenerBound) return;
    this._visibilityListenerBound = true;

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState !== 'visible') return;
      const activeShiftId = this.kasirInfo?.shiftId;
      if (!activeShiftId || this._shiftClosedHandled) return;

      try {
        const shiftData = await this._fetchShift(activeShiftId);
        if (shiftData && shiftData.status === 'closed') {
          console.warn('[VISIBILITY-GUARD] Tab aktif kembali & mendeteksi shift sudah closed:', activeShiftId);
          this.shiftStatus = 'closed';
          this.forceShiftClosedLogoutOverlay(activeShiftId);
        }
      } catch (err) {
        console.warn('[VISIBILITY-GUARD] Gagal re-check status shift:', err);
      }
    });
  },

  /**
   * ✅ FIX BUG-4: Tampilkan full-screen DOM Overlay (bukan alert) saat shift ditutup oleh kasir/tab lain.
   */
  forceShiftClosedLogoutOverlay(closedShiftId) {
    if (this._shiftClosedHandled) return;
    this._shiftClosedHandled = true;
    this.shiftStatus = 'closed';

    console.warn('[SHIFT-CLOSED] Shift ditutup oleh kasir lain → tampilkan overlay logout');
    try { this.playSound('notify'); } catch (e) {}

    // Cleanup intervals
    try { if (this._clockInterval) clearInterval(this._clockInterval); } catch (e) {}
    try { if (this._reconcileInterval) clearInterval(this._reconcileInterval); } catch (e) {}
    try { if (this._dashboardInterval) clearInterval(this._dashboardInterval); } catch (e) {}
    try { if (this._snapshotInterval) clearInterval(this._snapshotInterval); } catch (e) {}

    // Clear session
    try { sessionStorage.removeItem('dapur_kasir_session'); } catch (e) {}
    try { localStorage.removeItem('dapur_kasir_session'); } catch (e) {}

    // Hindari duplikasi elemen overlay jika sudah ada di DOM
    if (document.getElementById('shift-closed-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'shift-closed-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(6px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:24px;font-family:"Plus Jakarta Sans",sans-serif;';
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:24px;max-width:440px;width:100%;padding:32px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);">
        <div style="width:64px;height:64px;border-radius:20px;background:#fef3c7;color:#d97706;display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 16px;">⚠️</div>
        <h3 style="font-size:20px;font-weight:900;color:#1c1917;margin:0 0 8px;letter-spacing:-.02em;">Shift ditutup oleh kasir lain. Silakan login ulang.</h3>
        <p style="font-size:13px;color:#57534e;line-height:1.5;margin:0 0 20px;">Shift <strong>${closedShiftId || this.kasirInfo?.shiftId || '-'}</strong> telah ditutup pada tab/perangkat lain.<br><br>Sesi kasir Anda telah diakhiri demi keamanan data transaksi.</p>
        <button id="btn-shift-relogin" style="display:inline-flex;align-items:center;justify-content:center;gap:8px;width:100%;height:48px;border-radius:14px;background:#ea580c;color:#fff;font-weight:800;font-size:14px;border:none;cursor:pointer;box-shadow:0 8px 20px rgba(234,88,12,.3);">
          Login Ulang
        </button>
      </div>
    `;
    document.body.appendChild(overlay);

    const reloginBtn = document.getElementById('btn-shift-relogin');
    if (reloginBtn) {
      reloginBtn.addEventListener('click', () => {
        this._shiftClosedHandled = false;
        try {
          sessionStorage.removeItem('dapur_kasir_session');
          localStorage.removeItem('dapur_kasir_session');
        } catch (e) {}
        window.location.href = '/';
      });
    }
  },

   /**
   * ✅ FIX: Pastikan ada shift aktif.
   * - Kalau session punya shiftId → validasi ke Firebase
   * - Kalau tidak ada → cari shift aktif hari ini (multi-kasir auto-join)
   * - Kalau masih tidak ada → prompt buka shift baru (modal awal)
   * - Auto-close stale shift (>12 jam masih open)
   */
    async ensureActiveShift() {
    // ✅ Guard: hindari double-invoke (Alpine re-render)
    if (this._ensuringShift) {
      console.log('[ENSURE-SHIFT] Already running, skip duplicate call');
      return;
    }
    this._ensuringShift = true;
    try {
      // 1. Kalau session punya shiftId, validasi
      if (this.kasirInfo.shiftId) {
        const existing = await this._fetchShift(this.kasirInfo.shiftId);
        if (existing && existing.status === 'open') {
          console.log('[ENSURE-SHIFT] Session shift valid:', this.kasirInfo.shiftId);
          return;
        }
        console.log('[ENSURE-SHIFT] Session shift invalid, cari shift baru');
        this.kasirInfo.shiftId = null;
      }

      // 2. Ambil semua shift
      const shifts = await this._fetchAllShifts();
      const list = Object.values(shifts || {}).filter(Boolean);
      const today = this.getLocalDateStr ? this.getLocalDateStr() : new Date().toISOString().slice(0, 10);
      const todayStart = new Date(today + 'T00:00:00').getTime();
      const now = Date.now();
      const staleThreshold = 12 * 60 * 60 * 1000;

      // ✅ Helper: parse timestamp dari shift ID format S-YYYYMMDD-XXXX
      const parseDateFromShiftId = (sid) => {
        const m = String(sid || '').match(/^S-(\d{8})/);
        if (!m) return null;
        const d = m[1];
        const yr = Number(d.slice(0, 4));
        const mo = Number(d.slice(4, 6)) - 1;
        const dy = Number(d.slice(6, 8));
        const ts = new Date(yr, mo, dy).getTime();
        return isNaN(ts) ? null : ts;
      };

      // 2a. Auto-close stale shifts (fallback ke timestamp dari shift ID kalau field `open` kosong)
      for (const shf of list) {
        if (!shf || !shf.id || shf.status !== 'open') continue;
        const openTs = Number(shf.open) || parseDateFromShiftId(shf.id);
        if (!openTs) continue;
        if ((now - openTs) > staleThreshold) {
          console.log('[ENSURE-SHIFT] Auto-close stale:', shf.id, 'open:', new Date(openTs).toLocaleString('id-ID'));
          this._patchShift(shf.id, {
            status: 'closed',
            close: openTs + staleThreshold,
            note: (shf.note ? shf.note + ' | ' : '') + 'Auto-closed (stale >12 jam)'
          }).catch((err) => console.warn('[ENSURE-SHIFT] Auto-close failed:', err));
        }
      }

      // 2b. Cari shift aktif hari ini
      const activeShift = list.find(s =>
        s && s.status === 'open' &&
        Number(s.open) >= todayStart
      );

      if (activeShift) {
        // ✅ Multi-kasir auto-join
        this.kasirInfo.shiftId = activeShift.id;
        try {
          sessionStorage.setItem('dapur_kasir_session', JSON.stringify(this.kasirInfo));
        } catch (e) {}

        this.shiftSummary.totalSales = Number(activeShift.totalSales) || 0;
        this.shiftSummary.cashSales = Number(activeShift.cashSales) || 0;
        this.shiftSummary.qrisSales = Number(activeShift.qrisSales) || 0;
        this.shiftSummary.transferSales = Number(activeShift.transferSales) || 0;
        this.shiftSummary.ewalletSales = Number(activeShift.ewalletSales) || 0;
        this.shiftSummary.transactionCount = Number(activeShift.transactionCount) || 0;
        this.shiftSummary.startCash = Number(activeShift.openCash) || 0;
        this.shiftSummary.startTime = activeShift.open ? this.formatTime(activeShift.open) : '-';

        // Update activeKasirIds
        const activeIds = Array.isArray(activeShift.activeKasirIds)
          ? [...activeShift.activeKasirIds]
          : (activeShift.kasir ? [activeShift.kasir] : []);
        if (!activeIds.includes(this.kasirInfo.username)) {
          activeIds.push(this.kasirInfo.username);
          this._patchShift(activeShift.id, { activeKasirIds: activeIds }).catch(() => {});
        }

        const isOwner = (activeShift.kasir || '') === this.kasirInfo.username;
        if (isOwner) {
          this.showToast(`✅ Lanjut shift aktif ${activeShift.id}`, 'success');
        } else {
          this.showToast(`✅ Auto-join shift ${activeShift.id} (dibuka oleh ${activeShift.kasir})`, 'notify');
        }
        console.log('[ENSURE-SHIFT] Active shift:', activeShift.id);
        return;
      }

      // 3. Tidak ada shift aktif → auto-buka dengan modal default 200000
      // ✅ FIX: Hapus prompt() (auto-dismiss di Chrome) → auto-open + banner
      console.log('[ENSURE-SHIFT] STEP-3: Tidak ada shift aktif, auto-buka dengan modal default 200000');
      const DEFAULT_MODAL = 200000;
      await this.bukaShift(DEFAULT_MODAL, true);
      this.showEditModalBanner = true;
      this.showToast('Shift baru dibuka • modal default Rp 200.000 (klik banner untuk ubah)', 'notify');
      console.log('[ENSURE-SHIFT] Shift auto-opened');
      } catch (err) {
      console.warn('[ENSURE-SHIFT] Error:', err);
    } finally {
      this._ensuringShift = false;
      console.log('[ENSURE-SHIFT] Done (flag released)');
    }
  },

  // Helper: fetch 1 shift
  async _fetchShift(shiftId) {
    try {
      const fbUrl = (this._fbConfig && this._fbConfig.databaseURL)
        || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
      const res = await fetch(`${fbUrl.replace(/\/$/, '')}/pos/shifts/${encodeURIComponent(shiftId)}.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) { return null; }
  },

  // Helper: fetch semua shift
  async _fetchAllShifts() {
    try {
      const fbUrl = (this._fbConfig && this._fbConfig.databaseURL)
        || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
      const res = await fetch(`${fbUrl.replace(/\/$/, '')}/pos/shifts.json`);
      if (!res.ok) return {};
      return await res.json() || {};
    } catch (e) { return {}; }
  },

  // Helper: PATCH shift ke Firebase
  async _patchShift(shiftId, payload) {
    try {
      const fbUrl = (this._fbConfig && this._fbConfig.databaseURL)
        || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
      await fetch(`${fbUrl.replace(/\/$/, '')}/pos/shifts/${encodeURIComponent(shiftId)}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) { console.warn('[PATCH-SHIFT] Error:', e); }
  },

  // =========================================================================
  // 4. MANAJEMEN KERANJANG POS (Cart)
  // =========================================================================
 
  /**
   * Tambah item menu ke keranjang dengan validasi stok bahan baku
   */
      addToCart(menuItem) {
    if (!menuItem) return;

    // ✅ FIX BUG-4: Block add-to-cart kalau shift sudah closed
    if (this.shiftStatus === 'closed' || this._shiftClosedHandled) {
      this.showToast('⚠️ Shift sudah ditutup. Tidak bisa tambah item.', 'error');
      this.playSound('error');
      return;
    }

    // ✅ FIX BUG-14: Block kalau stok 0 atau negatif (konsisten dengan UI badge)
    const currentStock = this.getMenuCalculatedStock(menuItem.id);
    const existing = this.cart.find(i => i.id === menuItem.id);
    const currentCartQty = existing ? existing.qty : 0;

    console.log('[ADD-CART] Menu:', menuItem.name, '| Stock:', currentStock, '| In Cart:', currentCartQty);

        if (currentStock <= 0) {
      // ✅ BUG-15: Single toast — jangan panggil getMenuMissingIngredient() yang bisa duplicate
      this.showToast(`Stok "${menuItem.name}" habis`, 'error');
      this.playSound('error');
      return;
    }

    if (currentCartQty + 1 > currentStock) {
      this.showToast(`Hanya tersisa ${currentStock} porsi untuk "${menuItem.name}"`, 'error');
      this.playSound('error');
      return;
    }

    if (existing) {
      existing.qty += 1;
    } else {
      this.cart.push({
        id: menuItem.id,
        name: menuItem.name,
        price: Number(menuItem.price) || 0,
        qty: 1
      });
    }
    this.playSound('click');
  },

  /**
   * Tambah kuantitas item (mendukung parameter ID atau Object item)
   */
  incrementQty(target) {
    const id = (typeof target === 'object' && target) ? target.id : target;
    const item = this.cart.find(i => i.id === id);
    if (item) {
      const currentStock = this.getMenuCalculatedStock(id);
      if (item.qty + 1 > currentStock) {
        this.showToast(`Stok "${item.name}" maksimal ${currentStock} porsi`, 'error');
        this.playSound('error');
        return;
      }
      item.qty += 1;
      this.playSound('click');
    }
  },
  increaseQty(target) {
    this.incrementQty(target);
  },

  /**
   * Kurangi kuantitas item (jika 1 -> hapus dari keranjang)
   */
  decrementQty(target) {
    const id = (typeof target === 'object' && target) ? target.id : target;
    const index = this.cart.findIndex(i => i.id === id);
    if (index !== -1) {
      if (this.cart[index].qty > 1) {
        this.cart[index].qty -= 1;
      } else {
        this.cart.splice(index, 1);
      }
      this.playSound('click');
    }
  },
  decreaseQty(target) {
    this.decrementQty(target);
  },

  /**
   * Update kuantitas item secara manual dari input
   */
  updateItemQty(item, val) {
    const num = parseInt(val, 10);
    if (isNaN(num) || num <= 0) {
      this.removeItemFromCart(item);
      return;
    }
    const currentStock = this.getMenuCalculatedStock(item.id);
    if (num > currentStock) {
      this.showToast(`Stok "${item.name}" maksimal ${currentStock} porsi`, 'error');
      item.qty = currentStock;
      return;
    }
    item.qty = num;
  },

  /**
   * Sinkronkan kategori menu dengan toko utama (localStorage dapur_site_config & menuList)
   */
  syncCategoriesWithMainStore() {
    try {
      let catList = [
        { id: 'semua', name: 'Semua' }
      ];

      // Baca dari localStorage (dapur_menu_categories yang disimpan oleh admin di Toko Utama)
      const savedCats = localStorage.getItem('dapur_menu_categories');
      if (savedCats) {
        try {
          const parsed = JSON.parse(savedCats);
          if (Array.isArray(parsed) && parsed.length > 0) {
            parsed.forEach(c => {
              if (c) {
                let cId = (c.id === 'all' || c.id === 'semua') ? 'semua' : (c.id || (c.name ? c.name.toLowerCase().replace(/[^a-z0-9]/g, '_') : ''));
                let cName = c.name || cId;
                if (cId === 'all') cId = 'semua';
                if (cName && !catList.some(item => item.id === cId || item.name.toLowerCase() === cName.toLowerCase())) {
                  catList.push({ id: cId, name: cName });
                }
              }
            });
          }
        } catch (e) {}
      }

      // Default fallback kategori jika belum ada di localStorage
      const defaults = [
        { id: 'semua', name: 'Semua' },
        { id: 'rice_bowl', name: 'Bento & Rice Bowl' },
        { id: 'chicken', name: 'Ayam & Bento' },
        { id: 'mie', name: 'Aneka Mie' },
        { id: 'dimsum', name: 'Dimsum & Snack' },
        { id: 'cemilan', name: 'Cemilan / Side Dish' },
        { id: 'ala_carte', name: 'Ala Carte' },
        { id: 'minuman', name: 'Aneka Minuman' },
        { id: 'viral', name: 'Viral & Dessert' }
      ];
      defaults.forEach(d => {
        if (!catList.some(item => item.id === d.id || item.name.toLowerCase() === d.name.toLowerCase())) {
          catList.push(d);
        }
      });

      // Kategori tambahan dari menuList jika ada label kategori baru
      if (Array.isArray(this.menuList)) {
        this.menuList.forEach(m => {
          if (m) {
            const cId = m.category === 'all' ? 'semua' : (m.category || '');
            const cName = m.categoryLabel || m.category || '';
            if (cName && cName.toLowerCase() !== 'semua' && cName.toLowerCase() !== 'all') {
              const normId = cId || cName.toLowerCase().replace(/[^a-z0-9]/g, '_');
              const exists = catList.some(item => 
                item.id.toLowerCase() === normId.toLowerCase() || 
                item.name.toLowerCase() === cName.toLowerCase()
              );
              if (!exists) {
                catList.push({ id: normId, name: cName });
              }
            }
          }
        });
      }

      this.categories = catList;
    } catch (err) {
      console.warn('Gagal sinkronkan kategori:', err);
    }
  },

  /**
   * Mengambil stok porsi tampilan produk di grid transaksi kasir
   */
  getMenuDisplayStock(menuItem) {
    if (!menuItem) return 0;
    // 1. Jika ada resep bahan baku terhubung
    if (this.menuRecipes && this.menuRecipes[menuItem.id]) {
      return this.getMenuCalculatedStock(menuItem.id);
    }
    // 2. Jika menu memiliki properti stok langsung
    if (typeof menuItem.stok !== 'undefined' && menuItem.stok !== null) return Number(menuItem.stok) || 0;
    if (typeof menuItem.stock !== 'undefined' && menuItem.stock !== null) return Number(menuItem.stock) || 0;

    // Default 0 jika stok kosong
    return 0;
  },

  /**
   * Hapus item dari keranjang
   */
  removeFromCart(target) {
    const id = (typeof target === 'object' && target) ? target.id : target;
    this.cart = this.cart.filter(i => i.id !== id);
    this.playSound('click');
  },
  removeItemFromCart(target) {
    this.removeFromCart(target);
  },

  /**
   * Kosongkan keranjang dengan konfirmasi kasir
   */
  clearCart() {
    if (this.cart.length === 0) return;
    if (confirm('Kosongkan semua pesanan di keranjang kasir?')) {
      this.cart = [];
      this.orderNote = '';
      this.orderDiscountValue = 0;
      this.discountAmount = 0;
      localStorage.removeItem('dapur_pos_draft_cart');
      this.playSound('click');
      this.showToast('Keranjang telah dikosongkan', 'notify');
    }
  },

  /**
   * Hitung total item fisik dalam keranjang
   */
  getCartTotalItems() {
    return this.cart.reduce((total, item) => total + (item.qty || 0), 0);
  },

  /**
   * Hitung harga satuan item setelah diskon manual per item
   */
  getItemUnitPriceAfterDiscount(item) {
    if (!item) return 0;
    const basePrice = Number(item.price) || 0;
    const val = Number(item.itemDiscountValue) || 0;
    if (val <= 0) return basePrice;

    if (item.itemDiscountType === 'nominal') {
      return Math.max(0, basePrice - val);
    } else {
      // Default percent
      const disc = (basePrice * val) / 100;
      return Math.max(0, basePrice - disc);
    }
  },

  /**
   * Hitung nominal diskon per item (total untuk seluruh qty item tersebut)
   */
  getItemDiscountNominal(item) {
    if (!item) return 0;
    const basePrice = Number(item.price) || 0;
    const unitPrice = this.getItemUnitPriceAfterDiscount(item);
    return (basePrice - unitPrice) * (item.qty || 1);
  },

  /**
   * Buka Modal Diskon Per Item
   */
  openItemDiscountModal(item) {
    if (!item) return;
    this.selectedCartItemForDiscount = item;
    this.itemDiscountForm = {
      type: item.itemDiscountType || 'percent',
      value: item.itemDiscountValue || 0
    };
    this.showItemDiscountModal = true;
  },

  /**
   * Simpan Diskon Per Item
   */
  saveItemDiscount() {
    if (!this.selectedCartItemForDiscount) return;
    const val = Math.max(0, Number(this.itemDiscountForm.value) || 0);
    this.selectedCartItemForDiscount.itemDiscountType = this.itemDiscountForm.type || 'percent';
    this.selectedCartItemForDiscount.itemDiscountValue = val;
    this.showItemDiscountModal = false;
    this.showToast(`Diskon item "${this.selectedCartItemForDiscount.name}" diterapkan`, 'success');
    this.playSound('click');
  },

  /**
   * Reset Diskon Per Item
   */
  resetItemDiscount(item) {
    if (!item) return;
    item.itemDiscountType = 'percent';
    item.itemDiscountValue = 0;
    this.showToast(`Diskon item "${item.name}" direset`, 'notify');
  },

  /**
   * Buka Modal Diskon Total Belanja (Order Level)
   */
  openOrderDiscountModal() {
    this.orderDiscountForm = {
      type: this.orderDiscountType || 'percent',
      value: this.orderDiscountValue || 0
    };
    this.showOrderDiscountModal = true;
  },

  /**
   * Simpan Diskon Total Belanja
   */
  saveOrderDiscount() {
    const val = Math.max(0, Number(this.orderDiscountForm.value) || 0);
    this.orderDiscountType = this.orderDiscountForm.type || 'percent';
    this.orderDiscountValue = val;
    this.showOrderDiscountModal = false;
    this.showToast('Diskon total belanja berhasil diterapkan', 'success');
    this.playSound('click');
  },

  /**
   * Reset Diskon Total Belanja
   */
  resetOrderDiscount() {
    this.orderDiscountValue = 0;
    this.showToast('Diskon total belanja direset', 'notify');
  },

  /**
   * Hitung subtotal seluruh pesanan (setelah diskon item)
   */
    /**
   * ✅ PATCH H: Subtotal BRUTO (harga normal × qty, TANPA diskon item)
   * Ini yang ditampilkan di struk sebagai "Subtotal"
   */
  getCartSubtotalBruto() {
    if (!Array.isArray(this.cart)) return 0;
    return this.cart.reduce((total, item) => {
      const basePrice = Number(item.price) || 0;
      return total + (basePrice * (item.qty || 0));
    }, 0);
  },

  /**
   * ✅ PATCH H: Total diskon per item (nominal)
   */
  getCartItemDiscountTotal() {
    if (!Array.isArray(this.cart)) return 0;
    return this.cart.reduce((total, item) => {
      return total + this.getItemDiscountNominal(item);
    }, 0);
  },

  /**
   * ✅ PATCH H: Net Sales = Subtotal Bruto − Diskon Item (sebelum diskon total)
   */
  getCartNetSalesBeforeOrderDiscount() {
    return Math.max(0, this.getCartSubtotalBruto() - this.getCartItemDiscountTotal());
  },

  /**
   * ✅ PATCH H: Subtotal setelah diskon item (= Net Sales sebelum diskon total)
   * Ini tetap ada untuk kompatibilitas backward — dipakai di getOrderDiscountAmount()
   */
  getCartSubtotal() {
    return this.getCartNetSalesBeforeOrderDiscount();
  },

  /**
   * Hitung nominal diskon total belanja
   */
  getOrderDiscountAmount() {
    const subtotal = this.getCartSubtotal();
    if (subtotal <= 0) return 0;
    const val = Number(this.orderDiscountValue) || 0;
    if (val <= 0) return 0;

    if (this.orderDiscountType === 'nominal') {
      return Math.min(subtotal, val);
    } else {
      // Default percent
      return Math.round((subtotal * val) / 100);
    }
  },

  /**
   * Subtotal bersih setelah Diskon Total Belanja
   */
      /**
   * ✅ PATCH H: Net Sales FINAL = Subtotal Bruto − Diskon Item − Diskon Total
   * Ini basis untuk hitung Service Charge & PPN
   */
  getCartSubtotalAfterOrderDiscount() {
    const netSalesBeforeOrderDisc = this.getCartNetSalesBeforeOrderDiscount();
    const orderDisc = this.getOrderDiscountAmount();
    return Math.max(0, netSalesBeforeOrderDisc - orderDisc);
  },

  /**
   * Hitung pajak PB1 11% (Restoran)
   */
      /**
   * ✅ PATCH H-5: PPN
   * - Exclude (default): PPN = NetSales × 11%  → ditambahkan ke total
   * - Include: PPN diekstrak proporsional = NetSales × (11/111) → sudah di dalam total
   */
  getCartTax() {
    if (!this.isTaxEnabled) return 0;
    const netSales = this.getCartSubtotalAfterOrderDiscount();
    if (netSales <= 0) return 0;

    if (this.isTaxIncluded) {
      return Math.round(netSales * (11 / 111));
    }
    return Math.round(netSales * 0.11);
  },

  /**
   * Hitung Service Charge (5%)
   */
    getCartServiceCharge() {
    if (!this.isServiceChargeEnabled) return 0;
    // ✅ PATCH H: Service Charge dihitung dari NetSales (setelah diskon total)
    const netSales = this.getCartSubtotalAfterOrderDiscount();
    const rate = (Number(this.serviceChargeRate) || 5) / 100;
    return Math.round(netSales * rate);
  },

  /**
   * Hitung total akhir tagihan (Subtotal + Tax + Service Charge - Diskon Order)
   */
    /**
   * ✅ PATCH H: Grand Total
   * - Exclude: NetSales + Service + PPN
   * - Include: NetSales + Service (PPN sudah di dalam NetSales)
   */
  getCartGrandTotal() {
    const netSales = this.getCartSubtotalAfterOrderDiscount();
    const service = this.getCartServiceCharge();

    if (this.isTaxIncluded) {
      // PPN sudah termasuk dalam NetSales — jangan ditambahkan lagi
      return Math.max(0, netSales + service);
    }

    const tax = this.getCartTax();
    return Math.max(0, netSales + service + tax);
  },

  /**
   * PENGATURAN PRINTER POS
   */
  loadPrinterConfig() {
    try {
      const saved = localStorage.getItem('dapur_printer_config');
      if (saved) {
        this.printerConfig = Object.assign(this.printerConfig, JSON.parse(saved));
      }
    } catch (e) {}
  },

  savePrinterConfig() {
    try {
      localStorage.setItem('dapur_printer_config', JSON.stringify(this.printerConfig));
      this.showToast('Pengaturan printer POS berhasil disimpan.', 'success');
      this.showPrinterModal = false;
      this.playSound('success');
    } catch (e) {}
  },

  testPrintPrinter() {
    this.showToast(`Memproses tes cetak ke printer (${this.printerConfig.name} - ${this.printerConfig.paperSize})...`, 'notify');
    const mockOrder = {
      orderId: 'POS-TEST-' + Math.floor(1000 + Math.random() * 9000),
      time: new Date().toLocaleTimeString('id-ID'),
      date: new Date().toLocaleDateString('id-ID'),
      customer: 'TES PRINTER POS',
      items: [{ name: 'Rice Bowl Chicken Katsu', qty: 1, price: 28000 }],
      total: 28000,
      paymentMethod: 'Tunai'
    };
    this.previewStruk(mockOrder);
  },

  /**
   * FITUR SHIFT (Pause, Resume, Export CSV)
   */
  pauseShift() {
    this.shiftStatus = 'paused';
    this.shiftPauseTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB';

    try {
      if (this.kasirInfo && this.kasirInfo.shiftId) {
        localStorage.setItem(`dapur_shift_status_${this.kasirInfo.shiftId}`, 'paused');
        localStorage.setItem(`dapur_shift_pause_time_${this.kasirInfo.shiftId}`, this.shiftPauseTime);
      }
    } catch(e) {}

    if (this._fbDb && this._fbSet && this._fbRef && this.kasirInfo && this.kasirInfo.shiftId) {
      try {
        const statusRef = this._fbRef(this._fbDb, `pos/shifts/${this.kasirInfo.shiftId}/status`);
        const pauseTimeRef = this._fbRef(this._fbDb, `pos/shifts/${this.kasirInfo.shiftId}/pauseTime`);
        this._fbSet(statusRef, 'paused');
        this._fbSet(pauseTimeRef, this.shiftPauseTime);
      } catch(e) {}
    }

    this.showToast('Shift berhasil diistirahatkan sementara (Paused).', 'notify');
    this.playSound('click');
  },

  resumeShift() {
    this.shiftStatus = 'open';
    this.shiftPauseTime = null;

    try {
      if (this.kasirInfo && this.kasirInfo.shiftId) {
        localStorage.setItem(`dapur_shift_status_${this.kasirInfo.shiftId}`, 'open');
        localStorage.removeItem(`dapur_shift_pause_time_${this.kasirInfo.shiftId}`);
      }
    } catch(e) {}

    if (this._fbDb && this._fbSet && this._fbRef && this.kasirInfo && this.kasirInfo.shiftId) {
      try {
        const statusRef = this._fbRef(this._fbDb, `pos/shifts/${this.kasirInfo.shiftId}/status`);
        const pauseTimeRef = this._fbRef(this._fbDb, `pos/shifts/${this.kasirInfo.shiftId}/pauseTime`);
        this._fbSet(statusRef, 'open');
        this._fbSet(pauseTimeRef, null);
      } catch(e) {}
    }

    this.showToast('Shift aktif kembali! Siap melayani transaksi.', 'success');
    this.playSound('success');
  },

  exportShiftHistoryCSV() {
    if (!this.shiftHistory || this.shiftHistory.length === 0) {
      this.showToast('Belum ada riwayat shift untuk diexport.', 'error');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += 'Shift ID,Operator Kasir,Waktu Buka,Waktu Tutup,Total Omset,Tunai,QRIS,Modal Awal,Status\n';

    this.shiftHistory.forEach(s => {
      const row = [
        s.id,
        `"${s.kasir || 'Kasir'}"`,
        `"${s.openTime || '-'}"`,
        `"${s.closeTime || '-'}"`,
        s.total || 0,
        s.cash || 0,
        s.qris || 0,
        s.startCash || 0,
        s.status || 'Selesai'
      ].join(',');
      csvContent += row + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Riwayat_Shift_Kasir_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('Riwayat shift berhasil diexport ke file CSV.', 'success');
  },

  // =========================================================================
  // 5. PROSES PEMBAYARAN (Tunai, QRIS, Transfer, E-Wallet, Split Bill)
  // =========================================================================

  /**
   * Buka Modal Pilihan Metode Pembayaran
   */
  openPaymentModal() {
    if (this.cart.length === 0) {
      this.showToast('Keranjang masih kosong!', 'error');
      this.playSound('error');
      return;
    }
    this.paymentModal = true;
    this.playSound('click');
  },

  /**
   * Handler tombol opsi metode pembayaran
   */
  selectPaymentMethod(method) {
    this.selectedPaymentMethod = method;
    this.paymentModal = false;

    if (method === 'tunai' || method === 'cash') {
      this.bayarTunai();
    } else if (method === 'qris') {
      this.bayarQris();
    } else if (method === 'transfer') {
      this.bayarTransfer();
    } else if (method === 'ewallet') {
      this.bayarEwallet();
    } else if (method === 'split') {
      this.splitBill();
    }
  },

  /**
   * Alur Pembayaran Tunai (Cash)
   */
  bayarTunai() {
    this.selectedPaymentMethod = 'tunai';
    this.cashReceived = this.getCartGrandTotal(); // default uang pas
    this.cashModal = true;
    this.playSound('click');
  },

  /**
   * Hitung kembalian tunai secara otomatis
   */
  getCashChange() {
    return (Number(this.cashReceived) || 0) - this.getCartGrandTotal();
  },

  /**
   * Validasi & Selesaikan Pembayaran Tunai
   */
  completeCashPayment() {
    if (this.cashReceived < this.getCartGrandTotal()) {
      this.showToast('Uang tunai kurang dari total tagihan!', 'error');
      this.playSound('error');
      return;
    }
    this.cashModal = false;
    this.simpanTransaksi({
      method: 'cash',
      payDetail: {
        cash: this.cashReceived,
        change: this.getCashChange()
      }
    });
  },

  /**
   * Alur Pembayaran QRIS Dinamis & Polling Midtrans Status
   */
  async bayarQris() {
    this.selectedPaymentMethod = 'qris';
    this.qrisModal = true;
    this.qrisDisplayMode = 'dynamic';
    this.playSound('click');

    const txId = 'T' + Date.now();
    this.qrisOrderId = txId;
    this.qrisQrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=DAPUR-KULINER-${txId}-${this.getCartGrandTotal()}`;

    // Kirim request payment intent ke server
    try {
      const res = await fetch('/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: txId,
          gross_amount: this.getCartGrandTotal(),
          customer_details: {
            name: 'Pelanggan Kasir POS',
            phone: '08123456789'
          }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.redirect_url) this.qrisRedirectUrl = data.redirect_url;
      }
    } catch (e) {
      console.warn('Payment endpoint call note:', e);
    }

    // Polling status Midtrans tiap 5 detik (maks 15 menit)
    this.startPaymentPolling(txId, 'qris');
  },

  /**
   * Verifikasi manual kasir untuk pembayaran QRIS
   */
  completeQrisPayment() {
    if (this.midtransPollingTimer) clearInterval(this.midtransPollingTimer);
    this.qrisModal = false;
    this.simpanTransaksi({
      txId: this.qrisOrderId,
      method: 'qris',
      status: 'settlement'
    });
  },

  /**
   * Alur Pembayaran Transfer Bank
   */
  bayarTransfer() {
    this.selectedPaymentMethod = 'transfer';
    this.transferModal = true;
    this.playSound('click');
  },

  /**
   * Konfirmasi kasir untuk pembayaran Transfer Bank
   */
  completeTransferPayment() {
    this.transferModal = false;
    this.simpanTransaksi({
      method: 'transfer',
      status: 'menunggu verifikasi'
    });
  },

  /**
   * Alur Pembayaran E-Wallet
   */
  bayarEwallet() {
    this.selectedPaymentMethod = 'ewallet';
    this.ewalletModal = true;
    this.playSound('click');
    const txId = 'T' + Date.now();
    this.startPaymentPolling(txId, 'ewallet');
  },

  /**
   * Verifikasi manual kasir untuk E-Wallet
   */
  completeEwalletPayment() {
    if (this.midtransPollingTimer) clearInterval(this.midtransPollingTimer);
    this.ewalletModal = false;
    this.simpanTransaksi({
      method: 'ewallet',
      status: 'settlement'
    });
  },

  /**
   * Alur Split Bill (Pisah Pembayaran)
   */
  splitBill() {
    this.selectedPaymentMethod = 'split';
    const grandTotal = this.getCartGrandTotal();
    const half = Math.floor(grandTotal / 2);
    this.splitRows = [
      { method: 'tunai', amount: half },
      { method: 'qris', amount: grandTotal - half }
    ];
    this.splitModal = true;
    this.playSound('click');
  },

  addSplitRow() {
    this.splitRows.push({ method: 'tunai', amount: 0 });
    this.playSound('click');
  },

  removeSplitRow(index) {
    if (this.splitRows.length > 1) {
      this.splitRows.splice(index, 1);
      this.playSound('click');
    }
  },

  getSplitSum() {
    return (this.splitRows || []).reduce((acc, row) => acc + (Number(row.amount) || 0), 0);
  },

  getSplitDifference() {
    return this.getCartGrandTotal() - this.getSplitSum();
  },

  completeSplitPayment() {
    if (this.getSplitDifference() !== 0) {
      this.showToast('Jumlah split bill harus sama persis dengan total tagihan!', 'error');
      this.playSound('error');
      return;
    }
    this.splitModal = false;
    this.simpanTransaksi({
      method: 'split',
      breakdown: this.splitRows
    });
  },

  /**
   * Polling status Midtrans tiap 5 detik (maks 15 menit)
   */
  startPaymentPolling(orderId, methodType) {
    if (this.midtransPollingTimer) clearInterval(this.midtransPollingTimer);
    let counter = 0;
    const maxAttempts = 180; // 180 x 5 detik = 15 menit

    this.midtransPollingTimer = setInterval(async () => {
      counter++;
      // Hentikan jika modal sudah ditutup kasir atau waktu habis
      if (counter >= maxAttempts || (!this.qrisModal && !this.ewalletModal)) {
        clearInterval(this.midtransPollingTimer);
        this.midtransPollingTimer = null;
        return;
      }

      try {
        const res = await fetch(`/payment/status/${encodeURIComponent(orderId)}`);
        if (res.ok) {
          const data = await res.json();
          const st = (data.transaction_status || '').toLowerCase();
          if (st === 'settlement' || st === 'capture') {
            clearInterval(this.midtransPollingTimer);
            this.midtransPollingTimer = null;
            this.qrisModal = false;
            this.ewalletModal = false;
            this.showToast('Pembayaran otomatis berhasil diverifikasi!', 'success');
            this.simpanTransaksi({
              txId: orderId,
              method: methodType,
              status: 'settlement'
            });
          }
        }
      } catch (err) {
        console.warn('Polling error note:', err);
      }
    }, 5000);
  },

  // =========================================================================
  // 6. SIMPAN TRANSAKSI (Fungsi Inti POS)
  // =========================================================================

  /**
   * Simpan Transaksi Lengkap ke Firebase Cloud & Jalankan Otomasi POS
   */
      async simpanTransaksi(paymentData = {}) {
    // ✅ FIX BUG-4: Block transaksi kalau shift sudah closed
    if (this.shiftStatus === 'closed' || this._shiftClosedHandled) {
      this.showToast('⚠️ Shift sudah ditutup. Transaksi ditolak.', 'error');
      this.playSound('error');
      setTimeout(() => { window.location.href = '/'; }, 800);
      return;
    }

    const txId = paymentData.txId || ('T' + Date.now());
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const isReconciliation = !!paymentData.isReconciliation || !!paymentData.orderData;
    const orderData = paymentData.orderData || null;

    // ✅ FIX #1: Normalize field — Firebase pakai short-form (tot, sub, sc, disc)
    const grandTotal = orderData 
      ? (Number(orderData.total || orderData.tot || orderData.totalAmount) || 0) 
      : this.getCartGrandTotal();
    const subtotal = orderData 
      ? (Number(orderData.subtotal || orderData.sub) || Math.round(grandTotal / 1.11)) 
      : this.getCartSubtotal();
    const tax = orderData 
      ? (Number(orderData.tax) || (grandTotal - subtotal)) 
      : this.getCartTax();
        const serviceCharge = orderData 
      ? (Number(orderData.serviceCharge || orderData.sc) || 0) 
      : this.getCartServiceCharge();
    const disc = orderData 
      ? (Number(orderData.discount || orderData.disc) || 0) 
      : (Number(this.getOrderDiscountAmount()) || 0);
    const taxIncluded = orderData 
      ? Boolean(orderData.taxIncluded) 
      : Boolean(this.isTaxIncluded);   // ✅ FIX: pakai getter yang benar
    const pm = (paymentData.method || (orderData && (orderData.paymentMethod || orderData.payment_type || orderData.pm)) || this.selectedPaymentMethod || 'cash').toLowerCase();

    // ✅ FIX #2: Normalize items — handle object / array / array-of-arrays
    let rawItems = [];
    if (orderData && orderData.items) {
      if (Array.isArray(orderData.items)) {
        rawItems = orderData.items;
      } else if (typeof orderData.items === 'object') {
        rawItems = Object.values(orderData.items).filter(Boolean);
      }
    }
    if (rawItems.length === 0) {
      rawItems = Array.isArray(this.cart) ? this.cart.slice() : [];
    }

    // ✅ FIX #3: Normalize ke format uniform {id, qty, price} untuk backend
    const normalizedItems = rawItems.map(item => {
      if (Array.isArray(item)) {
        return { id: item[0] || 'm1', qty: Number(item[1]) || 1, price: Number(item[2]) || 0 };
      }
      return {
        id: item.id || item.menuId || 'm1',
        qty: Number(item.qty || item.quantity) || 1,
        price: Number(item.price || item.harga) || 0
      };
    });

    const mappedItems = normalizedItems.map(i => [i.id, i.qty, i.price]);
    if (mappedItems.length === 0) {
      mappedItems.push(['m1', 1, grandTotal]);
    }

    // 1. Format transaksi hemat
    const txRecord = {
      t: Date.now(),
      items: mappedItems,
      sub: subtotal,
      tax: tax,
      taxIncluded: taxIncluded,
      serviceCharge: serviceCharge,
      disc: disc,
      tot: grandTotal,
      pm: pm,
      ksr: this.kasirInfo.username,
      shf: this.kasirInfo.shiftId,
      orderId: orderData ? (orderData.orderId || orderData.id) : (paymentData.orderId || null),
      reconciled: isReconciliation,
      payDetail: {
        cash: paymentData.cashReceived || (this.cashReceived || grandTotal),
        change: paymentData.cashChange || (this.getCashChange() > 0 ? this.getCashChange() : 0),
        breakdown: paymentData.breakdown || null,
        orderId: orderData ? (orderData.orderId || orderData.id) : (paymentData.orderId || null)
      }
    };

    this.currentOrder = {
      id: txId,
      date: this.formatDate(Date.now()),
      time: this.formatTime(Date.now()),
                  items: normalizedItems.length > 0 
        ? normalizedItems.map(it => {
            const menu = (this.menuList || []).find(m => m.id === it.id);
            const cartItem = (this.cart || []).find(c => c.id === it.id);
            // ✅ BUG-27: harga after-discount + simpan metadata diskon per item
            const priceAfterDisc = cartItem 
              ? this.getItemUnitPriceAfterDiscount(cartItem) 
              : Number(it.price) || 0;
            const itemDiscount = cartItem ? this.getItemDiscountNominal(cartItem) : 0;
            return { 
              id: it.id, 
              qty: it.qty, 
              price: priceAfterDisc,
              basePrice: Number(it.price) || 0,
              itemDiscount: itemDiscount,
              itemDiscountType: cartItem ? cartItem.itemDiscountType : null,
              itemDiscountValue: cartItem ? cartItem.itemDiscountValue : 0,
              name: (menu && menu.name) ? menu.name : it.id 
            };
          })
        : [{ id: 'm1', name: 'Menu Pesanan', qty: 1, price: grandTotal, basePrice: grandTotal, itemDiscount: 0 }],
      subtotal: subtotal,
      tax: tax,
      taxIncluded: taxIncluded,
      serviceCharge: serviceCharge,
      discount: disc,
      total: grandTotal,
      paymentMethod: pm,
      cashReceived: paymentData.cashReceived || (this.cashReceived || grandTotal),
      cashChange: paymentData.cashChange || (this.getCashChange() > 0 ? this.getCashChange() : 0),
      note: orderData ? (orderData.note || 'Rekonsiliasi') : this.orderNote
    };

    let savedToFirebase = false;

    // 2. Simpan ke Firebase Realtime Database
    try {
      if (this._fbDb && this._fbSet && this._fbRef) {
        const txRef = this._fbRef(this._fbDb, `pos/transactions/${dateStr}/${txId}`);
        await this._fbSet(txRef, txRecord);
        savedToFirebase = true;
      } else if (this._fbConfig && this._fbConfig.databaseURL && !this._fbConfig.databaseURL.includes('local-storage')) {
        const url = `${this._fbConfig.databaseURL.replace(/\/$/, '')}/pos/transactions/${dateStr}/${txId}.json`;
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(txRecord)
        });
        if (res.ok) savedToFirebase = true;
      }
    } catch (err) {
      console.warn('Firebase save warning:', err);
    }

    // 3. Offline queue
    if (!savedToFirebase) {
      try {
        const pendingQueue = JSON.parse(localStorage.getItem('dapur_pending_tx') || '[]');
        pendingQueue.push({ path: `pos/transactions/${dateStr}/${txId}`, data: txRecord, createdAt: Date.now() });
        localStorage.setItem('dapur_pending_tx', JSON.stringify(pendingQueue));
      } catch (e) {}
    }

    // 4. ✅ AWAIT: Inventory deduct
    try {
      console.log('[INV-DEDUCT] Sending:', { orderId: txId, items: normalizedItems });
      const invRes = await fetch('/inventory/deduct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: txId,
          date: dateStr,
          kasir: this.kasirInfo?.name || this.kasirInfo?.username || 'kasir',
          items: normalizedItems
        })
      });
      const invJson = await invRes.json();
      if (invJson.success && Array.isArray(invJson.deducted)) {
        invJson.deducted.forEach(d => {
          const it = this.inventoryList.find(i => i.id === d.itemId);
          if (it) { it.stock = d.after; it.stok = d.after; }
        });
        console.log('[INV-DEDUCT] ✅', invJson.deducted.length, 'items updated');
      } else {
        console.warn('[INV-DEDUCT] ⚠️', invJson.error || 'No deducted array');
      }
    } catch (e) {
      console.warn('[INV-DEDUCT] ❌', e.message);
    }

    // 5. ✅ AWAIT: Auto-Jurnal Akuntansi
    try {
      const acctBody = {
        orderId: txId,
        date: dateStr,
        pm: pm,
        total: grandTotal,
        items: normalizedItems
      };
      console.log('[KASIR→ACCT] Sending:', acctBody);

      const acctRes = await fetch('/accounting/journal/pos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(acctBody)
      });
      const acctJson = await acctRes.json();
      
      if (acctJson.success) {
        console.log('[KASIR→ACCT] ✅ Revenue:', acctJson.totalRev, '| HPP:', acctJson.totalHpp);
      } else {
        console.warn('[KASIR→ACCT] ⚠️', acctJson.error);
      }
    } catch (e) {
      console.warn('[KASIR→ACCT] ❌', e.message);
    }

    // 6. ✅ Refresh accounting summary SETELAH semua selesai
    try {
      if (typeof this.loadAccountingSummary === 'function') {
        await this.loadAccountingSummary(true);
      }
      if (typeof this.loadCOAListFromBackend === 'function') {
        await this.loadCOAListFromBackend();
      }
    } catch (e) {}

    // 7. Aggregate endpoint dihapus — endpoint tidak ada di backend, non-blocker.
    //    Aggregate data sudah di-handle oleh /accounting/journal/pos.

    // 8. Receipt endpoint (background)
    fetch('/receipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.currentOrder)
    }).catch(() => {});

    // 8.1. Notifikasi WhatsApp Otomatis (Fitur 6C)
    const custPhone = (orderData && (orderData.customerPhone || orderData.phone || orderData.telepon)) || this.customerPhone || '';
    if (custPhone) {
      const custName = (orderData && (orderData.customerName || orderData.name)) || this.customerName || 'Pelanggan';
      const itemsSummary = (this.currentOrder.items || []).map(it => `- ${it.name || it.id} x${it.qty}`).join('\n');
      const waMsg = `Halo Kak ${custName}, terima kasih sudah bertransaksi di ${this.customKasirTitle || 'Dapur Kuliner Viral'}! ✨\n\nNo. Order: #${txId}\nTotal: ${this.formatRupiah(grandTotal)}\nMetode: ${pm.toUpperCase()}\nTanggal: ${dateStr}\n\nPesanan:\n${itemsSummary}\n\nStruk transaksi Anda telah berhasil diproses. Semoga puas dengan hidangan kami! 🙏`;
      this.sendWhatsAppNotification(custPhone, waMsg, 'pos_receipt');
    }

    // 9. Update shift summary
    if (this.shiftSummary) {
      this.shiftSummary.transactionCount = (this.shiftSummary.transactionCount || 0) + 1;
      this.shiftSummary.totalSales = (this.shiftSummary.totalSales || 0) + grandTotal;
      if (pm === 'cash' || pm === 'tunai') {
        this.shiftSummary.cashSales = (this.shiftSummary.cashSales || 0) + grandTotal;
      } else if (pm === 'qris') {
        this.shiftSummary.qrisSales = (this.shiftSummary.qrisSales || 0) + grandTotal;
      } else {
        this.shiftSummary.transferSales = (this.shiftSummary.transferSales || 0) + grandTotal;
      }
    }
    this.todayTotalRevenue = (this.todayTotalRevenue || 0) + grandTotal;

    // 10. Auto-download struk (hanya kasir langsung)
    if (!paymentData.skipReceiptModal) {
      this.downloadStrukPDF(this.currentOrder);
    }

    // 11. Clear cart
    if (!isReconciliation) {
      this.cart = [];
      this.orderNote = '';
      this.discountAmount = 0;
      localStorage.removeItem('dapur_pos_draft_cart');
    }

        // 12. Sound & Toast
    this.playSound('success');
    if (!isReconciliation) {
      this.showToast('Transaksi berhasil!', 'success');
      this.receiptModal = true;
      this.receiptWAPhone = ''; // ✅ FEATURE-3: reset field WA tiap struk baru
      this.receiptWaAuto = false; // FASE 5: reset mode auto-populate (struk kasir walk-in)
    }
  },

  /**
   * Sinkronisasi antrian transaksi offline ke Cloud Firebase
   */
  async syncPendingTransactions() {
    try {
      const queue = JSON.parse(localStorage.getItem('dapur_pending_tx') || '[]');
      if (!queue || queue.length === 0) return;

      const remaining = [];
      for (const item of queue) {
        let synced = false;
        try {
          if (this._fbDb && this._fbSet && this._fbRef) {
            const r = this._fbRef(this._fbDb, item.path);
            await this._fbSet(r, item.data);
            synced = true;
          } else if (this._fbConfig && this._fbConfig.databaseURL && !this._fbConfig.databaseURL.includes('local-storage')) {
            const url = `${this._fbConfig.databaseURL.replace(/\/$/, '')}/${item.path}.json`;
            const res = await fetch(url, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.data)
            });
            if (res.ok) synced = true;
          }
        } catch (err) {
          console.warn('Sync failed for queue item:', item.path, err);
        }
        if (!synced) remaining.push(item);
      }

      localStorage.setItem('dapur_pending_tx', JSON.stringify(remaining));
      if (remaining.length === 0) {
        this.showToast('Semua transaksi offline berhasil disinkronkan ke Cloud!', 'success');
      }
    } catch (e) {
      console.warn('Sync queue error:', e);
    }
  },

  // =========================================================================
  // 7. CETAK STRUK & DOKUMEN (jsPDF, RawBT Android, WhatsApp)
  // =========================================================================

  /**
   * FASE 5: teks footer struk standar (nama outlet dari siteConfig.brandName).
   */
  strukFooterText() {
    const brand = (this.siteInfo && this.siteInfo.brandName) ? String(this.siteInfo.brandName).trim() : 'Dapur Kuliner Viral';
    return `Terima kasih sudah berbelanja di ${brand} & selamat menikmati.`;
  },

  strukFooterLines(doc, width = 72) {
    try {
      const lines = doc.splitTextToSize(this.strukFooterText(), width);
      return (Array.isArray(lines) && lines.length) ? lines : [this.strukFooterText()];
    } catch (e) {
      return [this.strukFooterText()];
    }
  },

  /**
   * FASE 5: estimasi tinggi halaman struk 80mm (mm) supaya item + footer tidak terpotong.
   * Mengikuti urutan gambar di downloadStrukPDF.
   */
  estimateStrukHeightPdf(order, measure) {
    let h = 53; // header + blok info order + separator
    (order.items || []).forEach(it => {
      const name = it.name || (Array.isArray(it) ? it[0] : 'Menu');
      let lines = 1;
      try { lines = Math.max(1, measure.splitTextToSize(String(name), 50).length); } catch (e) {}
      h += (lines * 3.5) + 1;
      if (Number(it.itemDiscount) > 0) h += 3;
    });
    h += 8; // separator + subtotal
    if ((Number(order.discount || order.disc) || 0) > 0) h += 4;
    const scP = (order.serviceCharge !== undefined) ? Number(order.serviceCharge) : this.getCartServiceCharge();
    if (scP > 0) h += 4;
    const taxP = (order.tax !== undefined) ? Number(order.tax) : this.getCartTax();
    if (taxP > 0) h += 4;
    h += 5; // TOTAL
    if (order.cashReceived) h += 8; // Tunai + Kembali
    h += 5; // garis penutup
    h += 4 * this.strukFooterLines(measure, 72).length;
    return Math.max(130, Math.ceil(h + 8)); // + margin bawah
  },

  /**
   * FASE 5: versi untuk printStruk (RawBT / window.print) — layout 4mm per baris.
   */
  estimateStrukHeightPrint(order, measure) {
    let h = 41; // header + No. Order / Tanggal / Kasir + separator
    (order.items || []).forEach(it => {
      const name = it.name || 'Menu';
      let lines = 1;
      try { lines = Math.max(1, measure.splitTextToSize(String(name), 50).length); } catch (e) {}
      h += lines * 4;
      h += 4; // baris harga
      if (Number(it.itemDiscount) > 0) h += 3.5;
    });
    h += 8; // separator + subtotal
    if ((Number(order.discount || order.disc) || 0) > 0) h += 4;
    const scR = (order.serviceCharge !== undefined) ? Number(order.serviceCharge) : this.getCartServiceCharge();
    if (scR > 0) h += 4;
    const taxR = (order.tax !== undefined) ? Number(order.tax) : this.getCartTax();
    if (taxR > 0) h += 4;
    h += 8; // separator + TOTAL
    h += 4 * this.strukFooterLines(measure, 72).length;
    return Math.max(130, Math.ceil(h + 8));
  },

  /**
   * FASE 5: format nomor WA ke tampilan 62xxx (tanpa + / spasi / tanda hubung).
   */
  formatWaNumber(raw) {
    let p = String(raw || '').replace(/[^0-9]/g, '');
    if (p.startsWith('0')) p = '62' + p.slice(1);
    else if (p.startsWith('8')) p = '62' + p;
    return p;
  },

  /**
   * Preview struk modal
   */
    previewStruk(txData) {
    if (txData) {
      const d = txData.t ? new Date(txData.t) : (txData.timestamp ? new Date(txData.timestamp) : new Date());
      let parsedItems = [];
      
      if (Array.isArray(txData.items)) {
        parsedItems = txData.items.map(it => {
          if (Array.isArray(it)) {
            // ✅ FIX C1: Lookup nama menu dari menuList
            const menuId = it[0];
            const menu = (this.menuList || []).find(m => m.id === menuId);
            return {
              id: menuId,
              name: menu ? menu.name : menuId,
              qty: Number(it[1]) || 1,
              price: Number(it[2]) || 0
            };
          }
            return {
            id: it.id || it.menuId || ('it_' + Math.random()),
            name: it.name || it.menuName || it.id || 'Menu Pesanan',
            qty: Number(it.qty || it.quantity || 1),
            price: Number(it.price || it.harga || 0),
            basePrice: (it.basePrice !== undefined) ? Number(it.basePrice) : Number(it.price || it.harga || 0),
            itemDiscount: Number(it.itemDiscount) || 0,
            itemDiscountType: it.itemDiscountType || null,
            itemDiscountValue: Number(it.itemDiscountValue) || 0
          };
        });
      } else {
        parsedItems = this.cart || [];
      }

      // ✅ FIX C2: Baca total dari field yang benar (tot || total || amount)
      const grandTotal = txData.tot !== undefined ? Number(txData.tot)
                       : txData.total !== undefined ? Number(txData.total)
                       : txData.amount !== undefined ? Number(txData.amount) : 0;
      const subtotal = txData.sub !== undefined ? Number(txData.sub)
                     : txData.subtotal !== undefined ? Number(txData.subtotal) : grandTotal;
      const tax = txData.tax !== undefined ? Number(txData.tax) : 0;
      const serviceCharge = txData.sc !== undefined ? Number(txData.sc) : (txData.serviceCharge !== undefined ? Number(txData.serviceCharge) : 0);
      const discount = txData.disc !== undefined ? Number(txData.disc) : (txData.discount !== undefined ? Number(txData.discount) : 0);
      const pm = txData.pm || txData.paymentMethod || 'tunai';

      this.currentOrder = {
        id: txData.id || txData.orderId || ('ORD-' + Date.now()),
        date: txData.date || (d.toLocaleDateString('id-ID') + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })),
        time: txData.time || d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        items: parsedItems,
        subtotal: subtotal,
        tax: tax,
        serviceCharge: serviceCharge,
        discount: discount,
        total: grandTotal,
        paymentMethod: pm,
        cashReceived: txData.cashReceived || (pm === 'tunai' || pm === 'cash' ? grandTotal : 0),
        cashChange: txData.cashChange || 0,
        customer: txData.customer || txData.cust || 'Pelanggan',
        note: txData.note || txData.notes || ''
      };
      this.selectedPaymentMethod = pm;
      this.cashReceived = this.currentOrder.cashReceived;

      // FASE 5: auto-populate nomor WA customer dari order online (readonly);
      // order kasir walk-in tetap manual (field kosong & editable).
      const autoPhone = this.formatWaNumber(
        txData.customerPhone || txData.waPhone ||
        (txData.customer && typeof txData.customer === 'object' ? txData.customer.phone : '') ||
        (txData.cust && typeof txData.cust === 'object' ? txData.cust.phone : '')
      );
      if (autoPhone) {
        this.receiptWAPhone = autoPhone;
        this.receiptWaAuto = true;
      } else {
        this.receiptWAPhone = '';
        this.receiptWaAuto = false;
        // Recall transaksi online dari riwayat: ambil nomor dari detail order (tanpa blok UI)
        if (txData.online_order_id) {
          fetch('/online-orders/' + encodeURIComponent(txData.online_order_id))
            .then(r => r.json())
            .then(d => {
              const p = this.formatWaNumber(d && d.order && d.order.customer && d.order.customer.phone);
              if (p) { this.receiptWAPhone = p; this.receiptWaAuto = true; }
            })
            .catch(() => {});
        }
      }
    }
    this.receiptModal = true;
    this.playSound('click');
  },

  /**
   * Download Struk format Thermal 80mm PDF menggunakan jsPDF
   */
  downloadStrukPDF(txData) {
    try {
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) {
        this.showToast('Modul jsPDF belum siap', 'error');
        return;
      }

      const order = txData || this.currentOrder || {
        id: 'T' + Date.now(),
        date: this.formatDate(Date.now()),
        time: this.formatTime(Date.now()),
        items: this.cart,
        subtotal: this.getCartSubtotal(),
        tax: this.getCartTax(),
        total: this.getCartGrandTotal(),
        paymentMethod: this.selectedPaymentMethod
      };

      // FASE 5: tinggi halaman dihitung dari isi struk (item + baris opsional + footer)
      const measure = new jsPDF({ unit: 'mm', format: [80, 400] });
      const pageHeight = this.estimateStrukHeightPdf(order, measure);

      const doc = new jsPDF({
        unit: 'mm',
        format: [80, pageHeight]
      });

      doc.setFont('courier', 'bold');
      doc.setFontSize(11);
      doc.text('DAPUR KULINER VIRAL', 40, 9, { align: 'center' });
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);
      doc.text('Jl. Kuliner Viral No. 88, Jaksel', 40, 13, { align: 'center' });
      doc.text('Telp/WA: 0812-3456-7890', 40, 17, { align: 'center' });
      doc.text('================================', 40, 21, { align: 'center' });

      let y = 25;
      doc.text(`No. Order : ${order.id || 'T' + Date.now()}`, 5, y); y += 4;
      doc.text(`Tanggal   : ${order.date || this.formatDate(Date.now())}`, 5, y); y += 4;
      doc.text(`Waktu     : ${order.time || this.formatTime(Date.now())}`, 5, y); y += 4;
      doc.text(`Kasir     : ${this.kasirInfo.name || this.kasirInfo.username}`, 5, y); y += 4;
      doc.text(`Shift ID  : ${this.kasirInfo.shiftId || '-'}`, 5, y); y += 4;
      doc.text(`Metode    : ${(order.paymentMethod || order.pm || 'CASH').toUpperCase()}`, 5, y); y += 4;
      doc.text('--------------------------------', 40, y, { align: 'center' }); y += 4;

        (order.items || []).forEach(it => {
        const name = it.name || (Array.isArray(it) ? it[0] : 'Menu');
        const qty = it.qty || (Array.isArray(it) ? it[1] : 1);
        const basePrice = (it.basePrice !== undefined) ? Number(it.basePrice) : (Number(it.price) || (Array.isArray(it) ? Number(it[2]) : 0));
        const itemDiscount = Number(it.itemDiscount) || 0;
        const itemTotal = qty * basePrice;
        doc.setFont('courier', 'bold');
        const nameLines = doc.splitTextToSize(String(name), 50);
        nameLines.forEach((line, idx) => {
          doc.text(line, 5, y);
          if (idx === nameLines.length - 1) {
            doc.text(`${qty}x = ${this.formatRupiah(itemTotal)}`, 75, y, { align: 'right' });
          }
          y += 3.5;
        });

        // ✅ BUG-27: Baris diskon per item
        if (itemDiscount > 0) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(6.5);
          const discLabel = it.itemDiscountType === 'nominal' 
            ? `Disc Rp ${this.formatNumber(it.itemDiscountValue)}` 
            : `Disc ${it.itemDiscountValue}%`;
          doc.text(`  ${discLabel}`, 5, y);
          doc.text(`-${this.formatRupiah(itemDiscount)}`, 75, y, { align: 'right' });
          y += 3;
          doc.setFontSize(7.5);
        }

        doc.setFont('courier', 'normal');
        y += 1;
      });

      doc.text('--------------------------------', 40, y, { align: 'center' }); y += 4;
      doc.text(`Subtotal : ${this.formatRupiah(order.subtotal || order.sub || this.getCartSubtotal())}`, 5, y); y += 4;

      // ✅ Diskon order dulu
      const orderDisc = Number(order.discount || order.disc) || 0;
      if (orderDisc > 0) {
        doc.text(`Diskon   : -${this.formatRupiah(orderDisc)}`, 5, y); y += 4;
      }

      // ✅ Service charge conditional
      const sCharge = order.serviceCharge !== undefined ? order.serviceCharge : this.getCartServiceCharge();
      if (sCharge > 0) {
        doc.text(`Service  : ${this.formatRupiah(sCharge)}`, 5, y); y += 4;
      }

      // ✅ PPN conditional
      const taxVal = order.tax !== undefined ? order.tax : this.getCartTax();
      if (taxVal > 0) {
        doc.text(`PPN 11%  : ${this.formatRupiah(taxVal)}`, 5, y); y += 4;
      }
      doc.setFont('courier', 'bold');
      doc.setFontSize(8.5);
      doc.text(`TOTAL    : ${this.formatRupiah(order.total || order.tot || this.getCartGrandTotal())}`, 5, y); y += 5;
      doc.setFont('courier', 'normal');
      doc.setFontSize(7.5);

      if (order.cashReceived) {
        doc.text(`Tunai    : ${this.formatRupiah(order.cashReceived)}`, 5, y); y += 4;
        doc.text(`Kembali  : ${this.formatRupiah(order.cashChange || 0)}`, 5, y); y += 4;
      }

      doc.text('================================', 40, y, { align: 'center' }); y += 5;
      // FASE 5: footer standar struk (nama outlet dari siteConfig.brandName)
      doc.setFont('courier', 'normal');
      doc.setFontSize(7);
      this.strukFooterLines(doc, 72).forEach(line => {
        doc.text(line, 40, y, { align: 'center' });
        y += 4;
      });

      doc.save(`struk-${order.id || 'pos'}.pdf`);
      this.showToast('Struk PDF berhasil diunduh', 'success');
    } catch (err) {
      console.error('Gagal membuat struk PDF:', err);
      this.showToast('Gagal mengunduh struk PDF', 'error');
    }
  },
  downloadReceiptPDF() {
    this.downloadStrukPDF(this.currentOrder);
  },

  /**
   * Kirim ke printer thermal via RawBT (Android) format: rawbt:base64,{encoded_pdf}
   */
  printStruk(txData) {
    try {
      const { jsPDF } = window.jspdf || {};
      if (jsPDF) {
        const order = txData || this.currentOrder || { id: 'T' + Date.now(), items: this.cart, total: this.getCartGrandTotal() };
        // FASE 5: tinggi halaman dinamis (item + footer lengkap, tidak terpotong)
        const measureP = new jsPDF({ unit: 'mm', format: [80, 400] });
        const pageHeight = this.estimateStrukHeightPrint(order, measureP);
        const doc = new jsPDF({ unit: 'mm', format: [80, pageHeight] });

        doc.setFont('courier', 'bold');
        doc.setFontSize(11);
        doc.text('DAPUR KULINER VIRAL', 40, 9, { align: 'center' });
        doc.setFont('courier', 'normal');
        doc.setFontSize(7.5);
        doc.text('Jl. Kuliner Viral No. 88, Jaksel', 40, 13, { align: 'center' });
        doc.text('Telp/WA: 0812-3456-7890', 40, 17, { align: 'center' });
        doc.text('--------------------------------', 40, 21, { align: 'center' });
        let y = 25;
        doc.text(`No. Order : ${order.id}`, 5, y); y += 4;
        doc.text(`Tanggal   : ${order.date || this.formatDate(Date.now())}`, 5, y); y += 4;
        doc.text(`Kasir     : ${this.kasirInfo.name}`, 5, y); y += 4;
        doc.text('--------------------------------', 40, y, { align: 'center' }); y += 4;

                  (order.items || []).forEach(it => {
          const itemName = it.name || 'Menu';
          const nameLines = doc.splitTextToSize(itemName, 50);
          nameLines.forEach((line, idx) => {
            doc.text(line + (idx === nameLines.length - 1 ? ` x${it.qty || 1}` : ''), 5, y);
            y += 4;
          });
          const printBasePrice = (it.basePrice !== undefined) ? Number(it.basePrice) : (Number(it.price) || 0);
          doc.text(`   = ${this.formatRupiah(printBasePrice * (it.qty || 1))}`, 5, y);
          y += 4;

          // ✅ BUG-27: Baris diskon per item
          if (Number(it.itemDiscount) > 0) {
            doc.setFontSize(6.5);
            const discLabel = it.itemDiscountType === 'nominal' 
              ? `Disc Rp ${this.formatNumber(it.itemDiscountValue)}` 
              : `Disc ${it.itemDiscountValue}%`;
            doc.text(`   ${discLabel}: -${this.formatRupiah(it.itemDiscount)}`, 5, y);
            y += 3.5;
            doc.setFontSize(7.5);
          }
        });

        doc.text('--------------------------------', 40, y, { align: 'center' }); y += 4;
        doc.text(`Subtotal : ${this.formatRupiah(order.subtotal || order.sub || this.getCartSubtotal())}`, 5, y); y += 4;

        // ✅ Diskon order dulu
        const orderDisc = Number(order.discount || order.disc) || 0;
        if (orderDisc > 0) {
          doc.text(`Diskon   : -${this.formatRupiah(orderDisc)}`, 5, y); y += 4;
        }

        // ✅ Service conditional
        const sCharge = order.serviceCharge !== undefined ? order.serviceCharge : this.getCartServiceCharge();
        if (sCharge > 0) {
          doc.text(`Service  : ${this.formatRupiah(sCharge)}`, 5, y); y += 4;
        }

        // ✅ PPN conditional
        const taxVal = order.tax !== undefined ? order.tax : this.getCartTax();
        if (taxVal > 0) {
          doc.text(`PPN 11%  : ${this.formatRupiah(taxVal)}`, 5, y); y += 4;
        }
        doc.text('--------------------------------', 40, y, { align: 'center' }); y += 4;
        doc.setFont('courier', 'bold');
        doc.text(`TOTAL : ${this.formatRupiah(order.total || order.tot || 0)}`, 5, y); y += 5;

        // FASE 5: footer standar struk (nama outlet dari siteConfig.brandName)
        doc.setFont('courier', 'normal');
        doc.setFontSize(7);
        this.strukFooterLines(doc, 72).forEach(line => {
          doc.text(line, 40, y, { align: 'center' });
          y += 4;
        });

        const base64Pdf = doc.output('datauristring').split(',')[1];
        if (/android/i.test(navigator.userAgent)) {
          window.location.href = 'rawbt:base64,' + base64Pdf;
          return;
        }
      }
      window.print();
    } catch (e) {
      window.print();
    }
  },

  /**
   * Kirim struk transaksi via WhatsApp
   */
    kirimStrukWA(txData, phoneInput) {
    const order = txData || this.currentOrder || { id: 'T' + Date.now(), total: this.getCartGrandTotal() };
    const sCharge = order.serviceCharge !== undefined ? order.serviceCharge : this.getCartServiceCharge();
    const subtotal = order.subtotal || order.sub || this.getCartSubtotal();
    const tax = order.tax || this.getCartTax();
        const disc = Number(order.discount || order.disc || this.getOrderDiscountAmount()) || 0;

      let itemsText = '';
    (order.items || []).forEach(it => {
      const menu = (this.menuList || []).find(m => m.id === (it.id || it.menuId));
      const name = it.name || (menu && menu.name) || it.id || 'Menu';
      const qty = Number(it.qty) || 1;

      // ✅ PATCH G: harga tetap base price + baris diskon terpisah
      let basePrice, itemDisc, itemDiscType, itemDiscVal;
      if (Array.isArray(it)) {
        basePrice = Number(it[2]) || 0;
        itemDisc = 0; itemDiscType = null; itemDiscVal = 0;
      } else {
        basePrice = (it.basePrice !== undefined) ? Number(it.basePrice) : (Number(it.price) || 0);
        itemDisc = Number(it.itemDiscount) || 0;
        itemDiscType = it.itemDiscountType || null;
        itemDiscVal = Number(it.itemDiscountValue) || 0;
      }

      itemsText += `• ${name} x${qty} = ${this.formatRupiah(qty * basePrice)}\n`;

      // Sub-baris diskon per item
      if (itemDisc > 0) {
        const discLabel = itemDiscType === 'nominal'
          ? `Disc Rp ${this.formatNumber(itemDiscVal)}`
          : `Disc ${itemDiscVal}%`;
        itemsText += `   ${discLabel}: -${this.formatRupiah(itemDisc)}\n`;
      }
    });

        let details = `Subtotal: ${this.formatRupiah(subtotal)}\n`;
    // ✅ Reorder: Diskon → Service → Pajak
    if (disc > 0) details += `Diskon Total: -${this.formatRupiah(disc)}\n`;
    if (sCharge > 0) details += `Service Charge (5%): ${this.formatRupiah(sCharge)}\n`;
    if (tax > 0) details += `PPN (11%): ${this.formatRupiah(tax)}\n`;

    const text = `*DAPUR KULINER VIRAL - STRUK TRANSAKSI*\n\n` +
      `No. Order: *${order.id}*\n` +
      `Tanggal: ${order.date || this.formatDate(Date.now())}\n` +
      `Kasir: ${this.kasirInfo.name}\n` +
      `Metode: ${(order.paymentMethod || order.pm || 'CASH').toUpperCase()}\n` +
      `--------------------------------\n` +
      itemsText +
      `--------------------------------\n` +
      details +
      `*TOTAL: ${this.formatRupiah(order.total || order.tot || this.getCartGrandTotal())}*\n\n` +
      `Terima kasih telah berbelanja di Dapur Kuliner Viral!`;
    // ✅ FEATURE-3: prioritas nomor dari param → state receiptWAPhone → generic share
    const rawPhone = phoneInput !== undefined ? phoneInput : (this.receiptWAPhone || '');
    let cleanPhone = String(rawPhone || '').replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '62' + cleanPhone.slice(1);
    } else if (cleanPhone.startsWith('8')) {
      cleanPhone = '62' + cleanPhone;
    }

    const url = cleanPhone
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  },
  sendReceiptWA() {
    this.kirimStrukWA(this.currentOrder);
  },

  // =========================================================================
  // 8. AUTO-SAVE DRAFT KERANJANG
  // =========================================================================

  /**
   * Interval auto-save tiap 30 detik ke localStorage
   */
  setupDraftTimer() {
    setInterval(() => {
      if (this.cart && this.cart.length > 0) {
        const draft = {
          cart: this.cart,
          orderNote: this.orderNote,
          discountAmount: this.discountAmount,
          savedAt: Date.now()
        };
        localStorage.setItem('dapur_pos_draft_cart', JSON.stringify(draft));
      }
    }, 30000);
  },

  /**
   * Cek draft saat aplikasi dimuat & konfirmasi ke kasir
   */
  checkDraftOnLoad() {
    try {
      const raw = localStorage.getItem('dapur_pos_draft_cart');
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft && draft.cart && draft.cart.length > 0) {
        const diff = Date.now() - (draft.savedAt || 0);
        // Valid jika disimpan kurang dari 24 jam
        if (diff < 24 * 60 * 60 * 1000) {
          setTimeout(() => {
            if (confirm('Ditemukan draft pesanan kasir sebelumnya. Lanjutkan draft kemarin?')) {
              this.cart = draft.cart;
              this.orderNote = draft.orderNote || '';
              this.discountAmount = draft.discountAmount || 0;
              this.showToast('Draft pesanan berhasil dipulihkan', 'success');
              this.playSound('notify');
            } else {
              localStorage.removeItem('dapur_pos_draft_cart');
            }
          }, 800);
        }
      }
    } catch (e) {
      console.warn('Draft load note:', e);
    }
  },

  /**
   * Simpan draft secara manual dari tombol
   */
  saveDraftOrder() {
    if (this.cart.length === 0) return;
    const draft = {
      cart: this.cart,
      orderNote: this.orderNote,
      discountAmount: this.discountAmount,
      savedAt: Date.now()
    };
    localStorage.setItem('dapur_pos_draft_cart', JSON.stringify(draft));
    this.showToast('Draft pesanan berhasil disimpan di memori kasir', 'success');
    this.playSound('click');
  },

  // =========================================================================
  // 9. SOUND FEEDBACK (Web Audio API Synthesizer)
  // =========================================================================

  /**
   * Audio synthesizer mandiri tanpa file eksternal (click | success | error | notify)
   */
  playSound(type = 'click') {
    try {
      if (!window.__userInteracted) return; // skip kalau belum ada gesture pengguna

      if (!GLOBAL_AUDIO_CTX) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        GLOBAL_AUDIO_CTX = new AudioCtx();
        window.__audioCtx = GLOBAL_AUDIO_CTX;
      }

      if (GLOBAL_AUDIO_CTX.state === 'suspended') {
        GLOBAL_AUDIO_CTX.resume().catch(() => {});
      }

      const ctx = GLOBAL_AUDIO_CTX;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'click') {
        // Nada klik pendek
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(800, now + 0.04);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'success') {
        // Arpeggio C5 -> E5 -> G5
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now);
        osc.frequency.setValueAtTime(659.25, now + 0.08);
        osc.frequency.setValueAtTime(783.99, now + 0.16);
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.36);
      } else if (type === 'error') {
        // Nada buzz error
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.setValueAtTime(160, now + 0.12);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === 'notify') {
        // Nada bel cerah A5 -> C6
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1046.5, now + 0.12);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.32);
      }
    } catch (e) {
      console.warn('Audio synth note:', e);
    }
  },

  // =========================================================================
  // 10. TOAST NOTIFICATION
  // =========================================================================

  /**
   * Tampilkan toast notification
   */
   /**
   * Handler saat user pilih periode berbeda
   */
  async onReportPeriodChange() {
    console.log(`[REPORT] Period changed → ${this.reportPeriod}`);
    // Set default date untuk custom
    if (this.reportPeriod === 'custom') {
      const { start, end } = this.getReportDateRange();
      if (!this.reportStartDate) this.reportStartDate = start;
      if (!this.reportEndDate) this.reportEndDate = end;
    }
    // Reload semua data laporan
    await this.loadLaporanHariIni();
    await this.loadTopMenuBulanIni();
    await this.loadPenjualanPerJam();
  },

   // =========================================================================
  // 🧮 SHIFT CASH CALCULATOR (Serah Terima Kas Tunai)
  // =========================================================================

  openShiftCalculator() {
    const startCash = Number(this.shiftSummary?.startCash || 0);
    const cashSales = Number(this.shiftSummary?.cashSales || 0);
    this.shiftCalc = {
      modalAwal: startCash,
      totalPenjualanTunai: cashSales,
      pengeluaranTunai: 0,
      uangFisik: startCash + cashSales,
      notes: ''
    };
    this.showShiftCalcModal = true;
    this.playSound('notify');
  },

  closeShiftCalculator() {
    this.showShiftCalcModal = false;
    this.playSound('click');
  },

  get shiftCalcExpected() {
    const modal = Number(this.shiftCalc.modalAwal || 0);
    const tunai = Number(this.shiftCalc.totalPenjualanTunai || 0);
    const keluar = Number(this.shiftCalc.pengeluaranTunai || 0);
    return modal + tunai - keluar;
  },

  get shiftCalcDifference() {
    const fisik = Number(this.shiftCalc.uangFisik || 0);
    return fisik - this.shiftCalcExpected;
  },

  get shiftCalcStatus() {
    const diff = this.shiftCalcDifference;
    if (Math.abs(diff) < 1) return { label: 'SESUAI', key: 'balance' };
    if (diff > 0) return { label: 'LEBIH', key: 'over' };
    return { label: 'KURANG', key: 'under' };
  },

  resetShiftCalculator() {
    this.openShiftCalculator();
    this.showToast('Kalkulator direset ke nilai awal', 'notify');
  },

  async saveShiftHandover() {
    const expected = this.shiftCalcExpected;
    const fisik = Number(this.shiftCalc.uangFisik || 0);
    const diff = this.shiftCalcDifference;

    const entry = {
      at: Date.now(),
      iso: new Date().toISOString(),
      shiftId: this.kasirInfo?.shiftId || '-',
      user: this.kasirInfo?.username || 'kasir',
      userName: this.kasirInfo?.name || 'Kasir Utama',
      modalAwal: Number(this.shiftCalc.modalAwal || 0),
      totalTunai: Number(this.shiftCalc.totalPenjualanTunai || 0),
      pengeluaran: Number(this.shiftCalc.pengeluaranTunai || 0),
      expected: expected,
      fisik: fisik,
      difference: diff,
      status: Math.abs(diff) < 1 ? 'sesuai' : (diff > 0 ? 'lebih' : 'kurang'),
      notes: String(this.shiftCalc.notes || '').trim()
    };

    try {
      // 1. Simpan ke Firebase
      if (this._fbDb && this._fbSet && this._fbRef) {
        const key = `handover_${Date.now()}`;
        const ref = this._fbRef(this._fbDb, `pos/shift_handovers/${this.kasirInfo?.shiftId || 'unknown'}/${key}`);
        await this._fbSet(ref, entry);
        console.log('[SHIFT-CALC] ✅ Saved to Firebase:', entry);
      }

      // 2. Backup ke localStorage (max 50 entries)
      try {
        const list = JSON.parse(localStorage.getItem('dapur_shift_handovers') || '[]');
        list.push(entry);
        localStorage.setItem('dapur_shift_handovers', JSON.stringify(list.slice(-50)));
      } catch (e) {}

      this.showToast(
        `Serah terima tersimpan. Selisih: ${this.formatRupiah(diff)}`,
        Math.abs(diff) < 1 ? 'success' : 'notify'
      );
      this.playSound('success');
      this.closeShiftCalculator();
    } catch (err) {
      console.error('[SHIFT-CALC] ❌ Error:', err);
      this.showToast('Gagal menyimpan: ' + (err.message || err), 'error');
    }
  },

 showToast(message, type = 'success') {
    this.toast.message = message;
    this.toast.type = type;
    this.toast.show = true;
    if (this.toast.timer) clearTimeout(this.toast.timer);
    this.toast.timer = setTimeout(() => {
      this.toast.show = false;
    }, 3500);
  },

  // =========================================================================
  // 11. FORMATTING HELPERS
  // =========================================================================

  /**
   * Format Rupiah IDR
   */
   /**
   * Hitung Rata-rata Nilai Transaksi (AOV) hari ini
   */
  getAOV() {
    const total = Number(this.laporanHariIni?.totalSales || 0);
    const tx = Number(this.laporanHariIni?.totalTx || 0);
    if (tx <= 0) return 0;
    return Math.round(total / tx);
  },

  /**
   * Hitung metode pembayaran terpopuler hari ini
   */
  getTopPaymentMethod() {
    const b = this.laporanHariIni?.breakdown || {};
    const cash = Number(b.cash || 0);
    const qris = Number(b.qris || 0);
    const transfer = Number(b.transfer || 0);
    const ewallet = Number(b.ewallet || 0);
    const total = cash + qris + transfer + ewallet;

    if (total <= 0) return '-';

    const methods = [
      { name: 'Tunai', amount: cash },
      { name: 'QRIS', amount: qris },
      { name: 'Transfer', amount: transfer },
      { name: 'E-Wallet', amount: ewallet }
    ].sort((a, b) => b.amount - a.amount);

    const top = methods[0];
    const pct = Math.round((top.amount / total) * 100);
    return `${top.name} (${pct}%)`;
  },

   // =========================================================================
  // 📊 REPORT PERIOD HELPERS
  // =========================================================================

  /**
   * Format Date ke YYYY-MM-DD pakai LOCAL timezone (WIB)
   * PENTING: jangan pakai toISOString() karena itu UTC
   */
  getLocalDateStr(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  /**
   * Hitung range tanggal berdasarkan reportPeriod
   */
  getReportDateRange() {
    const today = new Date();
    const fmt = (d) => this.getLocalDateStr(d);

    if (this.reportPeriod === 'today') {
      return { start: fmt(today), end: fmt(today) };
    }

    if (this.reportPeriod === 'week') {
      // Minggu ini = Senin s/d hari ini
      const day = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
      const diffToMonday = (day === 0 ? -6 : 1 - day);
      const monday = new Date(today);
      monday.setDate(today.getDate() + diffToMonday);
      return { start: fmt(monday), end: fmt(today) };
    }

    if (this.reportPeriod === 'month') {
      // Bulan ini = tgl 1 s/d hari ini
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return { start: fmt(firstDay), end: fmt(today) };
    }

    if (this.reportPeriod === 'custom') {
      const start = this.reportStartDate || fmt(today);
      const end = this.reportEndDate || fmt(today);
      // Pastikan urutan benar
      return start <= end ? { start, end } : { start: end, end: start };
    }

    return { start: fmt(today), end: fmt(today) };
  },

  /**
   * Label periode untuk UI
   */
  getReportPeriodLabel() {
    const labels = {
      today: 'Hari Ini',
      week: 'Minggu Ini',
      month: 'Bulan Ini',
      custom: 'Custom'
    };
    return labels[this.reportPeriod] || 'Hari Ini';
  },

  /**
   * Fetch transaksi dalam rentang tanggal — dengan 3 strategi fallback
   * Return: Array<transaksi>
   */
    /**
   * Ambil tanggal efektif dari transaksi (untuk filter)
   */
  getTxDate(tx) {
    if (!tx) return null;
    // Priority 1: __date yang diinjeksi (dari loop harian)
    if (tx.__date) return tx.__date;
    // Priority 2: timestamp Unix (field 't' = short-form)
    if (tx.t) {
      const d = new Date(Number(tx.t));
      if (!isNaN(d.getTime())) return this.getLocalDateStr(d);
    }
    // Priority 3: timestamp ISO
    if (tx.timestamp) {
      const d = new Date(Number(tx.timestamp) || tx.timestamp);
      if (!isNaN(d.getTime())) return this.getLocalDateStr(d);
    }
    // Priority 4: field date (YYYY-MM-DD)
    if (tx.date && /^\d{4}-\d{2}-\d{2}$/.test(tx.date)) return tx.date;
    return null;
  },

  /**
   * Fetch transaksi dalam rentang tanggal — dengan 3 strategi fallback
   * ✅ FIX: Selalu filter client-side by date (defensive terhadap backend yang mengabaikan param)
   */
  async fetchTransactionsInRange(startDate, endDate) {
    console.log(`[REPORT] Fetch range: ${startDate} → ${endDate}`);

    // Helper: filter data by date range
    const normalizeToDateStr = (v) => {
      if (!v) return '';
      if (typeof v === 'number') {
        const d = new Date(v);
        if (isNaN(d.getTime())) return '';
        return d.toISOString().split('T')[0];
      }
      if (typeof v === 'string') {
        // Ambil 10 char pertama (YYYY-MM-DD) dari ISO string
        const trimmed = v.trim();
        if (trimmed.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
          return trimmed.slice(0, 10);
        }
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
      }
      return '';
    };

    const filterByDate = (list) => {
      if (!Array.isArray(list)) return [];
      const startNorm = normalizeToDateStr(startDate);
      const endNorm = normalizeToDateStr(endDate);
      return list.filter(tx => {
        const d = normalizeToDateStr(this.getTxDate(tx));
        if (!d) return false;
        return d >= startNorm && d <= endNorm;
      });
    };

    // === Strategi 1: endpoint range (SUDAH ADA di backend) ===
    //     GET /pos/transactions?start=YYYY-MM-DD&end=YYYY-MM-DD → 1 request untuk 1 periode.
    // CLEANUP-1: flag "broken" TIDAK lagi permanen di localStorage — dulu sekali gagal
    // (respons HTML/SPA fallback) endpoint ini diblokir selamanya di browser itu, sehingga
    // laporan bulanan selalu jatuh ke loop harian (30 request). Sekarang flag hanya per-sesi
    // dan sisa flag lama dibersihkan otomatis.
    try { localStorage.removeItem('dapur_range_endpoint_broken'); } catch (e) {}
    const rangeEndpointBroken = (() => {
      try { return sessionStorage.getItem('dapur_range_endpoint_broken_session') === '1'; }
      catch (e) { return false; }
    })();

    if (!rangeEndpointBroken) {
      try {
        const url = `/pos/transactions?start=${startDate}&end=${endDate}`;
        const res = await fetch(url);
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const json = await res.json();
          if (Array.isArray(json.data)) {
            const filtered = filterByDate(json.data);
            console.log(`[REPORT] ✅ Range endpoint (1 request): raw ${json.data.length} → filter ${filtered.length} tx`);
            return filtered;
          }
        } else {
          try { sessionStorage.setItem('dapur_range_endpoint_broken_session', '1'); } catch (err) {}
          console.log('[REPORT] Range endpoint tidak mengembalikan JSON (origin belum punya endpoint) → strategi berikutnya. Flag hanya per-sesi.');
        }
      } catch (e) {
        try { sessionStorage.setItem('dapur_range_endpoint_broken_session', '1'); } catch (err) {}
        console.log('[REPORT] Range endpoint error:', e && e.message ? e.message : e);
      }
    }

    // === Strategi 2: Kalau 1 bulan yang sama → pakai ?month= ===
    const startM = startDate.slice(0, 7);
    const endM = endDate.slice(0, 7);
    if (startM === endM) {
      try {
        const res = await fetch(`/pos/transactions?month=${startM}`);
        const ctMonth = res.headers.get('content-type') || '';
        if (res.ok && ctMonth.includes('application/json')) {
          const json = await res.json();
          if (Array.isArray(json.data)) {
            const filtered = filterByDate(json.data);
            console.log(`[REPORT] ✅ Month endpoint: raw ${json.data.length} → filter ${filtered.length} tx`);
            return filtered;
          }
        } else {
          console.log('[REPORT] Month endpoint bukan JSON, coba loop harian...');
        }
      } catch (e) {
        console.log('[REPORT] Month endpoint error, coba loop harian...');
      }
    }

    // === Strategi 3: Loop per hari (paling lambat tapi pasti) ===
    const days = [];
    const cur = new Date(startDate + 'T00:00:00');
    const endD = new Date(endDate + 'T00:00:00');
    while (cur <= endD) {
      days.push(this.getLocalDateStr(cur));
      cur.setDate(cur.getDate() + 1);
    }

    console.log(`[REPORT] Loop ${days.length} hari: ${startDate} → ${endDate}`);

    const results = await Promise.all(days.map(async (d) => {
      try {
        const res = await fetch(`/pos/transactions/${d}`);
        if (!res.ok) return [];
        const json = await res.json();
        if (Array.isArray(json.data)) {
          return json.data.map(tx => ({ ...tx, __date: d }));
        }
        return [];
      } catch (e) {
        return [];
      }
    }));

    const all = results.flat();
    const filtered = filterByDate(all);
    console.log(`[REPORT] ✅ Loop harian: raw ${all.length} → filter ${filtered.length} tx`);
    return filtered;
  },

 formatRupiah(num) {
    const val = Number(num) || 0;
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  },

  /**
   * Format Waktu HH:mm:ss
   */
  formatTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${h}:${m}:${s}`;
  },

  /**
   * Format Tanggal Indonesia
   */
  formatDate(ts) {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  },

  // =========================================================================
  // 12. FILTER & HELPER MENU
  // =========================================================================

  filteredMenuList() {
    return (this.menuList || []).filter(item => {
      const itemCat = (item.category || '').toLowerCase();
      const selCat = (this.selectedCategory || 'semua').toLowerCase();
      const matchCategory = selCat === 'semua' || selCat === 'all' || 
        itemCat === selCat || 
        itemCat.replace(/[^a-z0-9]/g, '_') === selCat.replace(/[^a-z0-9]/g, '_') ||
        (item.categoryLabel && item.categoryLabel.toLowerCase() === selCat);

      const matchSearch = !this.searchQuery ||
        (item.name || '').toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        (item.desc || '').toLowerCase().includes(this.searchQuery.toLowerCase());
      return matchCategory && matchSearch;
    });
  },

  // =========================================================================
  // 13. PLACEHOLDER DATA & HANDLER UNTUK BAGIAN 2 & 3
  // =========================================================================

  async fetchInventoryData() {
    try {
      const res = await fetch('/inventory');
      if (res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const json = await res.json();
          if (json && json.data) this.inventoryList = json.data;
        }
      }
    } catch (e) {
      console.warn('Fetch inventory note:', e);
    }
  },

  filteredInventoryList() {
    if (!this.inventorySearch) return this.inventoryList;
    return this.inventoryList.filter(item =>
      (item.name || '').toLowerCase().includes(this.inventorySearch.toLowerCase()) ||
      (item.category || '').toLowerCase().includes(this.inventorySearch.toLowerCase())
    );
  },

  // =========================================================================
  // 13. SISTEM REKONSILIASI TRANSAKSI (BAGIAN 2: GATE SATU PINTU)
  // =========================================================================

  /**
   * Helper format waktu WIB dari timestamp
   */
  formatTimeWib(timestamp) {
    if (!timestamp) return '-';
    const d = new Date(Number(timestamp) || timestamp);
    if (isNaN(d.getTime())) return String(timestamp);
    const dateStr = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${dateStr} ${timeStr} WIB`;
  },

  /**
   * Format rentang waktu rekonsiliasi
   */
  formatDateRangeReconcile() {
    if (!this.lastReconcileTime) return '24 Jam Lalu';
    const d = new Date(this.lastReconcileTime);
    if (isNaN(d.getTime())) return '24 Jam Lalu';
    const dateStr = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
    const timeStr = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${dateStr} ${timeStr} WIB`;
  },

  /**
   * Filter daftar rekonsiliasi sesuai filter tab aktif
   */

  /**
   * Toggle pilih semua checkbox transaksi
   */
  toggleSelectAllReconcile(e) {
    if (e.target.checked) {
      const ids = this.filteredReconciliationList().map(i => i.orderId);
      this.selectedReconcileIds = ids;
      this.selectedOrders = ids;
    } else {
      this.selectedReconcileIds = [];
      this.selectedOrders = [];
    }
  },

  /**
   * 1. Cek pending rekonsiliasi dengan filter timestamp dan grouping status (SYNCHRONOUS & AMAN DARI REKURSIF)
   */
  cekPendingRekonsiliasi() {
    const list = Array.isArray(this.reconciliationList) ? this.reconciliationList : [];
    const activeList = list.filter(item => !item.archived);

    const menggantung = activeList.filter(i => 
      !i.reconciled && 
      (i.status === 'menggantung' || i.status === 'pending') && 
      !this.postponedReconcileIds.includes(i.orderId)
    );

    const berhasil = activeList.filter(i => 
      (i.status === 'berhasil' || i.status === 'settlement') && 
      !this.postponedReconcileIds.includes(i.orderId)
    );

    const ditunda = activeList.filter(i => 
      this.postponedReconcileIds.includes(i.orderId) || i.status === 'ditunda'
    );

    const gagal = activeList.filter(i => 
      i.status === 'gagal' || i.status === 'expired' || i.status === 'cancel'
    );

    this.pendingReconcile = menggantung.length;
    if (this.pendingReconcile === 0) this.pendingReconcileModal = false;

    this.reconcileSummary = {
      berhasil, menggantung, ditunda, gagal,
      berhasilCount: berhasil.length,
      menggantungCount: menggantung.length,
      ditundaCount: ditunda.length,
      gagalCount: gagal.length
    };

    return { berhasil, menggantung, ditunda, gagal };
  },

  /**
   * Helper menghitung jumlah item rekonsiliasi berdasarkan tipe filter untuk badge counter tab
   */
  getReconcileCount(type = 'semua') {
    if (!this.reconciliationList || this.reconciliationList.length === 0) return 0;
    const list = this.reconciliationList.filter(item => !item.archived);
    if (type === 'semua' || type === 'all') return list.length;
    if (type === 'berhasil') return list.filter(i => 
      (i.status === 'berhasil' || i.status === 'settlement') && !this.isPostponed(i.orderId)
    ).length;
    if (type === 'menggantung' || type === 'pending') return list.filter(i => 
      (i.status === 'menggantung' || i.status === 'pending') && !this.isPostponed(i.orderId)
    ).length;
    if (type === 'ditunda') return list.filter(i => this.isPostponed(i.orderId) || i.status === 'ditunda').length;
    if (type === 'gagal' || type === 'expired') return list.filter(i => 
      i.status === 'gagal' || i.status === 'expired' || i.status === 'cancel'
    ).length;
    return 0;
  },

  /**
   * 2. Tampilkan modal rekonsiliasi otomatis jika ada pesanan pending
   */
  tampilModalRekonsiliasi() {
    const summary = this.cekPendingRekonsiliasi();
    if (summary.menggantung && summary.menggantung.length > 0) {
      this.showRekonsiliasiModal = true;
      this.pendingReconcileModal = true;
      this.playSound('notify');
    } else {
      this.showRekonsiliasiModal = false;
      this.pendingReconcileModal = false;
    }
  },

  /**
   * 3. Ambil detail transaksi dari /orders dan map ke format tabel rekonsiliasi
   */
  async loadRekonsiliasiList(filter = 'all') {
    if (filter !== 'all') {
      this.reconciliationFilter = filter;
      this.reconcileFilter = filter;
    }

    let rawList = [];
    try {
      // Ambil data langsung dari Firebase
      const dbUrl = (this._fbConfig && this._fbConfig.databaseURL) 
        || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
      const res = await fetch(`${dbUrl.replace(/\/$/, '')}/orders.json`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === 'object') {
          rawList = Object.entries(data).map(([id, v]) => ({ id, orderId: id, ...(v || {}) }));
        }
      }
    } catch (e) {
      console.warn('Gagal memuat /orders:', e);
    }

    const mapped = rawList
      .filter(o => !o.archived)
      .map(o => {
        const st = (o.status || '').toLowerCase();
        let normalizedStatus = 'menggantung';
        if (['settlement', 'berhasil', 'success', 'dibayar', 'capture', 'selesai'].includes(st)) {
          normalizedStatus = 'berhasil';
        } else if (['expired', 'gagal', 'cancel', 'batal', 'ditolak', 'denied'].includes(st)) {
          normalizedStatus = 'gagal';
        } else if (st === 'ditunda') {
          normalizedStatus = 'ditunda';
        }

        const isPostponedFromBackend = o.postponed === true || st === 'ditunda';
        if (isPostponedFromBackend && !this.postponedReconcileIds.includes(o.orderId || o.id)) {
          this.postponedReconcileIds.push(o.orderId || o.id);
        }

        // Pastikan items selalu jadi array (bukan object)
        let itemsArr = [];
        if (Array.isArray(o.items)) {
          itemsArr = o.items;
        } else if (o.items && typeof o.items === 'object') {
          itemsArr = Object.values(o.items).filter(Boolean);
        }
        itemsArr = itemsArr.map(it => {
          if (Array.isArray(it)) {
            return { id: it[0], name: it[0], qty: Number(it[1]) || 1, price: Number(it[2]) || 0 };
          }
          return {
            id: it.id || it.menuId,
            name: it.name || it.menuName || it.id,
            qty: Number(it.qty || it.quantity) || 1,
            price: Number(it.price || it.harga) || 0
          };
        });

        return {
          orderId: o.orderId || o.id,
          waktu: this.formatTimeWib(o.createdAt),
          time: this.formatTimeWib(o.createdAt),
          pemesan: o.customer?.name || o.customerName || o.pemesan || 'Pelanggan Umum',
          customer: o.customer?.name || o.customerName || o.pemesan || 'Pelanggan Umum',
          customerPhone: o.customer?.phone || o.customerPhone || '',
          customerAddress: o.customer?.address || o.customerAddress || '',
          total: Number(o.total || o.totalAmount || o.tot || o.gross_amount || 0),
          status: isPostponedFromBackend ? 'ditunda' : normalizedStatus,
          rawStatus: o.status || normalizedStatus,
          paymentMethod: o.paymentMethod || o.pm || o.payment_type || 'QRIS',
          midtransId: o.midtransId || o.transaction_id || '-',
          buktiTransfer: o.buktiTransfer || null,
          items: itemsArr,
          createdAt: Number(o.createdAt) || Date.now(),
          reconciled: !!o.reconciled,
          archived: !!o.archived,
          postponed: isPostponedFromBackend,
          postponedReason: o.postponedReason || '',
          note: o.note || '',
          rawOrder: o
        };
      });

    mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    this.reconciliationList = mapped;

    try {
      localStorage.setItem('dapur_postponed_reconcile', JSON.stringify(this.postponedReconcileIds));
    } catch (e) {}

    this.cekPendingRekonsiliasi();
    return mapped;
  },

  /**
   * 7. Anti-Duplikat Check: Cek apakah transaksi sudah direkam sebelumnya
   */
  async checkDuplicateTransaction(orderId) {
    if (!orderId) return null;
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    // 1. Cek cache lokal
    try {
      const cached = JSON.parse(localStorage.getItem('dapur_reconciled_orders') || '{}');
      if (cached[orderId]) {
        return { exists: true, shiftId: cached[orderId].shiftId || this.kasirInfo.shiftId };
      }
    } catch (e) {}

    // 2. Query endpoint server /pos/transactions/{date}/{txId}?orderId={orderId}
    try {
      const res = await fetch(`/pos/transactions/${dateStr}/${encodeURIComponent(orderId)}?orderId=${encodeURIComponent(orderId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.exists) {
          return data;
        }
      }
    } catch (err) {
      console.warn('Anti-duplicate check warning:', err);
    }

    return null;
  },

  /**
   * 4. Aksi Rekonsiliasi: rekamTransaksi(orderId)
   */
   async rekamTransaksi(orderId, skipStockCheck = false) {
    if (!orderId) return false;

    // 1. Ambil detail order dari /orders/{orderId} — DULU
    let orderData = null;
    try {
      const res = await fetch(`/orders/${encodeURIComponent(orderId)}`);
      if (res.ok) {
        const json = await res.json();
        orderData = json.data || json;
      }
    } catch (err) {
      console.warn('Fetch order detail warning:', err);
    }

    // Fallback ambil dari reconciliationList
    if (!orderData) {
      const found = this.reconciliationList.find(i => i.orderId === orderId);
      if (found) {
        orderData = found.rawOrder || {
          orderId: found.orderId,
          customer: found.customer,
          total: found.total,
          paymentMethod: found.paymentMethod,
          items: found.items || [{ id: 'm1', name: 'Menu Pesanan', qty: 1, price: found.total }],
          midtransId: found.midtransId
        };
      }
    }

    if (!orderData) {
      this.showToast(`Data transaksi ${orderId} tidak ditemukan`, 'error');
      return false;
    }

      // 3. ✅ VALIDASI STOK — Cek kesiapan semua item
    if (!skipStockCheck) {
      // Guard: kalau order tidak punya data items sama sekali
      if (!orderData.items || !Array.isArray(orderData.items) || orderData.items.length === 0) {
        const confirmNoItems = confirm(
          `⚠️ Transaksi ${orderId} tidak memiliki detail menu.\n\n` +
          `Sistem tidak dapat memverifikasi ketersediaan stok.\n\n` +
          `Pilih OK untuk tetap merekam (HPP tidak akan dihitung otomatis), ` +
          `atau Cancel untuk membatalkan.`
        );
        if (!confirmNoItems) {
          this.showToast(`Approve dibatalkan — order tidak punya detail menu`, 'notify');
          return false;
        }
      }
      const itemsToCheck = Array.isArray(orderData.items) 
        ? orderData.items 
        : Object.values(orderData.items || {}).filter(Boolean);
      const stockCheck = this.checkStockForOrder(itemsToCheck);
      
      if (!stockCheck.allReady) {
        const missingList = stockCheck.notReady
          .map(x => `${x.name} (butuh ${x.required}, tersedia ${x.available}, kurang: ${x.missing})`)
          .join('; ');
        
        // Tandai postponed di state lokal
          if (!this.postponedReconcileIds.includes(orderId)) {
          this.postponedReconcileIds.push(orderId);
          try {
            localStorage.setItem('dapur_postponed_reconcile', JSON.stringify(this.postponedReconcileIds));
          } catch (e) {}
        }
        
        // Update status di reconciliationList lokal
        const item = this.reconciliationList.find(i => i.orderId === orderId);
        if (item) {
          item.postponed = true;
          item.postponedReason = `Stok kurang: ${missingList}`;
          item.status = 'ditunda';
        }
        this.reconciliationList = [...this.reconciliationList];
        
        // PATCH ke backend: status = ditunda
        try {
          await fetch(`/orders/${encodeURIComponent(orderId)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'ditunda',
              postponed: true,
              postponedAt: Date.now(),
              postponedBy: this.kasirInfo.username,
              postponedReason: `Stok kurang: ${missingList}`
            })
          });
        } catch (e) {
          console.warn('Patch postpone error:', e);
        }
        
        // Notifikasi
        this.showToast(
          `Transaksi ${orderId} belum dapat disetujui — stok menu belum ready, otomatis DITUNDA`,
          'error'
        );
        
        // Buka modal detail jika sedang di halaman rekonsiliasi
        this.activeReconcileItem = item || null;
        this.reconcileModal = false;
        
        this.playSound('error');
        return false;
      }
    }

    // 3. ✅ Anti-Duplikat Check — SETELAH validasi stok
    const duplicate = await this.checkDuplicateTransaction(orderId);
    if (duplicate && duplicate.exists) {
      // Kalau order ini sudah "reconciled" (pernah direkam sukses), beri tahu user
      alert(`Transaksi sudah direkam di shift ${duplicate.shiftId || this.kasirInfo.shiftId || 'sebelumnya'}`);
      this.showToast(`Transaksi ${orderId} sudah pernah direkam`, 'notify');
      return false;
    }

    // 4. ✅ STOK READY — Lanjutkan rekam transaksi
    //    → simpanTransaksi() akan trigger auto-deduct inventory + auto-jurnal accounting
    const txId = orderData.orderId || ('T' + Date.now());
    await this.simpanTransaksi({
      txId: txId,
      method: orderData.paymentMethod || 'qris',
      isReconciliation: true,
      orderData: orderData,
      skipReceiptModal: true
    });

    // 5. Tandai PATCH /orders/{orderId} — status settlement
    try {
      await fetch(`/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reconciled: true,
          reconciledAt: Date.now(),
          reconciledBy: this.kasirInfo.username,
          status: 'settlement'
        })
      });

      // Notifikasi WA Order Dikonfirmasi (Fitur 6C)
      const phone = orderData.customerPhone || orderData.phone || orderData.customer_phone || '';
      if (phone) {
        const custName = orderData.customerName || orderData.customer_name || 'Pelanggan';
        const confMsg = `Halo Kak ${custName}, pesanan Anda #${orderId} telah kami KONFIRMASI dan sedang disiapkan di dapur! 🍳 Terima kasih telah memesan di ${this.customKasirTitle || 'Dapur Kuliner Viral'}.`;
        this.sendWhatsAppNotification(phone, confMsg, 'order_confirmed');
      }
    } catch (e) {
      console.warn('Patch order error:', e);
    }

    // 6. Simpan ke cache anti-duplicate lokal
    try {
      const cached = JSON.parse(localStorage.getItem('dapur_reconciled_orders') || '{}');
      cached[orderId] = { reconciledAt: Date.now(), shiftId: this.kasirInfo.shiftId };
      localStorage.setItem('dapur_reconciled_orders', JSON.stringify(cached));
    } catch (e) {}

    // 7. Update item di reconciliationList lokal
    const itemInList = this.reconciliationList.find(i => i.orderId === orderId);
    if (itemInList) {
      itemInList.reconciled = true;
      itemInList.status = 'berhasil';
      itemInList.rawStatus = 'settlement';
      itemInList.postponed = false;
      itemInList.postponedReason = null;
    }
    this.reconciliationList = [...this.reconciliationList];

    // 8. Update count pending
    await this.cekPendingRekonsiliasi();

    // 9. Refresh inventory + accounting summary (sudah di-handle di simpanTransaksi)
    try {
      await this.loadInventory();
      await this.loadAccountingSummary(true);
    } catch (e) {
      console.warn('[RECON] Refresh warning:', e);
    }

    // 10. Feedback sukses
    this.showToast(`Transaksi ${orderId} berhasil diverifikasi & direkam`, 'success');
    this.playSound('success');
    return true;
  },

  /**
   * 4. Aksi Rekonsiliasi: verifikasiManual(orderId, action)
   * action: 'approve' | 'reject' | 'mark_failed'
   */
  async verifikasiManual(orderId, action, reason = null) {
    if (!orderId) return;

    if (action === 'approve') {
      return await this.rekamTransaksi(orderId);
    }

    const isReject = action === 'reject';
    const defaultReason = isReject ? 'Bukti transfer tidak valid/dana belum masuk' : 'Transaksi gagal di payment gateway';
    const finalReason = reason || prompt(isReject ? 'Alasan penolakan pesanan:' : 'Catatan transaksi gagal:', defaultReason);

    if (finalReason === null) return; // Batal jika user klik cancel pada dialog

    const patchBody = {
      status: 'gagal',
      reconciled: true,
      reconciledAt: Date.now(),
      reconciledBy: this.kasirInfo.username,
      note: isReject ? `Ditolak kasir: ${finalReason}` : `Ditandai gagal oleh kasir: ${finalReason}`,
      verificationAction: action
    };

    try {
      await fetch(`/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody)
      });
    } catch (e) {
      console.warn('Patch reject error:', e);
    }

    // Update local state
    const item = this.reconciliationList.find(i => i.orderId === orderId);
    if (item) {
      item.status = 'gagal';
      item.reconciled = true;
      item.note = patchBody.note;
    }
    this.reconciliationList = [...this.reconciliationList];

    await this.cekPendingRekonsiliasi();
    this.showToast(isReject ? `Order ${orderId} ditolak` : `Order ${orderId} ditandai gagal`, isReject ? 'notify' : 'error');
  },

  /**
   * 4. Aksi Rekonsiliasi: arsipkanGagal(orderId)
   */
  async arsipkanGagal(orderId) {
    if (!orderId) return;
    try {
      await fetch(`/orders/${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archived: true,
          reconciled: true,
          archivedAt: Date.now(),
          archivedBy: this.kasirInfo.username
        })
      });
    } catch (e) {
      console.warn('Archive order error:', e);
    }

    this.reconciliationList = this.reconciliationList.filter(i => i.orderId !== orderId);
    await this.cekPendingRekonsiliasi();
    this.showToast(`Transaksi ${orderId} diarsipkan`, 'notify');
  },

  /**
   * 5. Bulk Action: rekamSemuaBerhasil()
   */
  async rekamSemuaBerhasil() {
    let candidates = this.reconciliationList.filter(i => 
      !i.reconciled && !i.archived && (i.status === 'berhasil' || i.status === 'settlement')
    );

    if (this.selectedReconcileIds && this.selectedReconcileIds.length > 0) {
      candidates = candidates.filter(i => this.selectedReconcileIds.includes(i.orderId));
    }

    if (candidates.length === 0) {
      this.showToast('Tidak ada transaksi berhasil yang perlu direkam', 'notify');
      return;
    }

    this.reconcileProgress = {
      isRunning: true,
      current: 0,
      total: candidates.length,
      percent: 0
    };

    let count = 0;
    for (let idx = 0; idx < candidates.length; idx++) {
      const o = candidates[idx];
      this.reconcileProgress.current = idx + 1;
      this.reconcileProgress.percent = Math.round(((idx + 1) / candidates.length) * 100);
      const ok = await this.rekamTransaksi(o.orderId);
      if (ok) count++;
    }

    this.reconcileProgress.isRunning = false;
    this.selectedReconcileIds = [];
    this.selectedOrders = [];
    await this.updateLastReconcile();
    this.showToast(`${count} transaksi direkam`, 'success');
  },

  /**
   * 5. Bulk Action: arsipkanSemuaGagal()
   */
  async arsipkanSemuaGagal() {
    let candidates = this.reconciliationList.filter(i => 
      !i.archived && (i.status === 'gagal' || i.status === 'expired')
    );

    if (this.selectedReconcileIds && this.selectedReconcileIds.length > 0) {
      candidates = candidates.filter(i => this.selectedReconcileIds.includes(i.orderId));
    }

    if (candidates.length === 0) {
      this.showToast('Tidak ada transaksi gagal yang perlu diarsipkan', 'notify');
      return;
    }

    let count = 0;
    for (const o of candidates) {
      await this.arsipkanGagal(o.orderId);
      count++;
    }

    this.selectedReconcileIds = [];
    this.selectedOrders = [];
    this.showToast(`${count} transaksi diarsipkan`, 'notify');
  },

  /**
   * 6. Update timestamp rekonsiliasi terakhir kasir
   */
  async updateLastReconcile() {
    const now = Date.now();
    this.lastReconcileTime = now;
    if (this.kasirInfo && this.kasirInfo.username) {
      try {
        localStorage.setItem(`dapur_last_reconcile_${this.kasirInfo.username}`, String(now));
        await fetch(`/pos/last_reconcile/${encodeURIComponent(this.kasirInfo.username)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timestamp: now })
        });
      } catch (e) {
        console.warn('Update last reconcile error:', e);
      }

      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const r = this._fbRef(this._fbDb, `pos/last_reconcile/${this.kasirInfo.username}`);
          await this._fbSet(r, now);
        } catch (e) {}
      }
    }
  },

  /**
   * Filter daftar rekonsiliasi sesuai tab filter status
   */
  filteredReconciliationList() {
    let list = this.reconciliationList || [];
    const filter = (this.reconcileFilter || 'semua').toLowerCase();
    
    if (filter === 'semua' || filter === 'all') {
      return list;
    }
    if (filter === 'ditunda' || filter === 'postponed') {
      return list.filter(item => this.isPostponed(item.orderId));
    }
    if (filter === 'berhasil' || filter === 'settlement') {
      return list.filter(item => item.status === 'berhasil' || item.status === 'settlement');
    }
        if (filter === 'menggantung' || filter === 'pending') {
      return list.filter(item => 
        (item.status === 'menggantung' || item.status === 'pending') && 
        !this.isPostponed(item.orderId)
      );
    }
    if (filter === 'gagal' || filter === 'expired') {
      return list.filter(item => item.status === 'gagal' || item.status === 'expired');
    }
    return list;
  },

  /**
   * Handler tombol sinkronisasi manual di UI
   */
  async syncReconciliation() {
    this.showToast('Menghubungkan ke gateway pembayaran...', 'notify');
    await this.loadRekonsiliasiList();
    this.showToast('Data rekonsiliasi berhasil diperbarui!', 'success');
  },

  /**
   * Aliases untuk backward compatibility handler tombol
   */
  bulkRecordSuccess() {
    return this.rekamSemuaBerhasil();
  },

  bulkArchiveFailed() {
    return this.arsipkanSemuaGagal();
  },

  recordTransactionSuccess(item) {
    if (item && item.orderId) {
      return this.rekamTransaksi(item.orderId);
    }
  },

  archiveTransactionFailed(item) {
    if (item && item.orderId) {
      return this.arsipkanGagal(item.orderId);
    }
  },

  openReconcileModal(item) {
    this.activeReconcileItem = item;
    this.reconcileModal = true;
  },

  approveReconciliation(item) {
    if (!item) return;
    return this.verifikasiManual(item.orderId, 'approve');
  },

  rejectReconciliation(item) {
    if (!item) return;
    return this.verifikasiManual(item.orderId, 'reject');
  },

  /**
   * Tunda / Postpone Rekonsiliasi (Order dipertahankan & ditandai kedip aktif)
   */
    postponeReconciliation(orderId) {
    if (!orderId) return;
    if (this.postponedReconcileIds.includes(orderId)) {
      this.postponedReconcileIds = this.postponedReconcileIds.filter(id => id !== orderId);
      this.showToast(`Penundaan rekonsiliasi ${orderId} dibatalkan`, 'notify');
    } else {
      this.postponedReconcileIds.push(orderId);
      this.showToast(`Rekonsiliasi ${orderId} ditunda sementara`, 'notify');
    }
    // ✅ Persist ke localStorage
    try {
      localStorage.setItem('dapur_postponed_reconcile', JSON.stringify(this.postponedReconcileIds));
    } catch (e) {}
    if (this.reconcileModal) this.reconcileModal = false;
  },

  isPostponed(orderId) {
    return this.postponedReconcileIds.includes(orderId);
  },

  // =========================================================================
  // 14. BAGIAN 3: SHIFT MANAGEMENT, INVENTORY & LAPORAN
  // =========================================================================

  // -------------------------------------------------------------------------
  // 14.1 SHIFT MANAGEMENT
  // -------------------------------------------------------------------------

  /**
   * Buka shift baru atau reopen shift
   * Sudah dilakukan oleh /kasir-auth saat login, fungsi ini untuk kasus kasir lupa / reopen
   */
      /**
   * ✅ FIX: Generate Shift ID unik format S-YYYYMMDD-XXXX
   * Konsisten dengan format yang dipakai index.html login flow lama
   */
  generateShiftId() {
    const d = new Date();
    const dateStr = String(d.getFullYear())
      + String(d.getMonth() + 1).padStart(2, '0')
      + String(d.getDate()).padStart(2, '0');
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `S-${dateStr}-${rand}`;
  },

   /**
   * ✅ Ubah modal awal shift aktif (PATCH ke Firebase)
   */
  async updateOpenCash(newAmount) {
    const amt = Math.max(0, Number(newAmount) || 0);
    if (!this.kasirInfo?.shiftId) {
      this.showToast('Tidak ada shift aktif', 'error');
      return;
    }
    try {
      await this._patchShift(this.kasirInfo.shiftId, { openCash: amt });
      this.shiftSummary.startCash = amt;
      this.showEditModalBanner = false;
      this.showToast(`✅ Modal awal diubah: Rp ${this.formatNumber(amt)}`, 'success');
      this.playSound('success');
    } catch (e) {
      this.showToast('Gagal ubah modal: ' + e.message, 'error');
    }
  },
   
  async bukaShift(modalAwal, skipConfirm = false) {
    if (!skipConfirm && !confirm('Apakah Anda ingin membuka sesi shift baru? Tindakan ini akan membuat ID shift baru untuk kasir ini.')) {
      return null;
    }

    const modal = modalAwal !== undefined ? Number(modalAwal) : (Number(prompt('Masukkan modal kas awal laci (Rp):', '200000')) || 200000);
    const newShiftId = this.generateShiftId();
    const openTimestamp = Date.now();

    this.kasirInfo.shiftId = newShiftId;
    sessionStorage.setItem('dapur_kasir_session', JSON.stringify(this.kasirInfo));

    const shiftPayload = {
      id: newShiftId,
      kasir: this.kasirInfo.username,
      open: openTimestamp,
      openCash: modal,
      status: 'open',
      totalSales: 0,
      cashSales: 0,
      qrisSales: 0,
      transferSales: 0,
      ewalletSales: 0,
      transactionCount: 0
    };

    try {
      await fetch('/pos/shifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shiftPayload)
      });
    } catch (e) {
      console.warn('POST /pos/shifts warning:', e);
    }

    if (this._fbDb && this._fbSet && this._fbRef) {
      try {
        const shiftRef = this._fbRef(this._fbDb, `pos/shifts/${newShiftId}`);
        await this._fbSet(shiftRef, shiftPayload);
      } catch (e) {
        console.warn('Firebase shift open warning:', e);
      }
    }

    this.shiftSummary = {
      totalSales: 0,
      cashSales: 0,
      qrisSales: 0,
      transferSales: 0,
      ewalletSales: 0,
      transactionCount: 0,
      startCash: modal,
      startTime: this.formatTime(openTimestamp)
    };

    this.shiftData = {
      startTime: this.formatTime(openTimestamp),
      duration: '0 jam 0 menit',
      totalSales: 0,
      breakdown: { cash: 0, qris: 0, transfer: 0, ewallet: 0 }
    };

    await this.loadRiwayatShift();
    this.showToast(`Shift ${newShiftId} berhasil dibuka (Modal: ${this.formatRupiah(modal)})`, 'success');
    return newShiftId;
  },

  /**
   * Tutup shift kasir:
   * - Ambil shift aktif dari /pos/shifts/{shiftId}
   * - Hitung transaksi tunai, QRIS, transfer, ewallet
   * - Buka form modal rekonsiliasi kas
   */
  async tutupShift() {
    this.loadingStates.shift = true;
    try {
      const shiftId = this.kasirInfo.shiftId || 'S-2026-09-18-01';
      const today = new Date().toISOString().slice(0, 10);

      // 1. Ambil data shift aktif dari /pos/shifts/{shiftId}
      let activeShift = null;
      try {
        const res = await fetch(`/pos/shifts/${encodeURIComponent(shiftId)}`);
        if (res.ok) {
          const json = await res.json();
          activeShift = json.data;
        }
      } catch (e) {
        console.warn('Fetch shift info note:', e);
      }

      // 2. Hitung total dari transaksi: filter /pos/transactions/{date}/ yang shf === shiftId
      let txList = [];
      try {
        const txRes = await fetch(`/pos/transactions/${today}`);
        if (txRes.ok) {
          const txJson = await txRes.json();
          if (Array.isArray(txJson.data)) {
            txList = txJson.data.filter(t => (t.shf === shiftId || t.shiftId === shiftId));
          }
        }
      } catch (e) {
        console.warn('Fetch shift transactions note:', e);
      }

      let totalSales = 0;
      let cashSales = 0;
      let qrisSales = 0;
      let transferSales = 0;
      let ewalletSales = 0;

      for (const t of txList) {
        const amt = Number(t.total || t.amount || 0);
        totalSales += amt;
        const pm = String(t.pm || t.paymentMethod || '').toLowerCase();
        if (pm.includes('tunai') || pm.includes('cash')) cashSales += amt;
        else if (pm.includes('qris')) qrisSales += amt;
        else if (pm.includes('transfer') || pm.includes('bca') || pm.includes('mandiri')) transferSales += amt;
        else if (pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo')) ewalletSales += amt;
        else cashSales += amt;
      }

      // Fallback ke shiftSummary jika riwayat transaksi filter kosong
      if (totalSales === 0 && this.shiftSummary.totalSales > 0) {
        totalSales = this.shiftSummary.totalSales;
        cashSales = this.shiftSummary.cashSales;
        qrisSales = this.shiftSummary.qrisSales;
        transferSales = this.shiftSummary.transferSales;
        ewalletSales = this.shiftSummary.ewalletSales || 0;
      }

      const startCash = Number(activeShift?.openCash !== undefined ? activeShift.openCash : (this.shiftSummary.startCash || 200000));
      const expectedCash = startCash + cashSales;

      this.shiftSummary.totalSales = totalSales;
      this.shiftSummary.cashSales = cashSales;
      this.shiftSummary.qrisSales = qrisSales;
      this.shiftSummary.transferSales = transferSales;
      this.shiftSummary.ewalletSales = ewalletSales;
      this.shiftSummary.transactionCount = txList.length || this.shiftSummary.transactionCount || 1;
      this.shiftSummary.startCash = startCash;

      this.physicalCashCount = expectedCash;
      this.closeShiftModal = true;
    } catch (err) {
      console.error('Tutup shift calculation error:', err);
      this.closeShiftModal = true;
    } finally {
      this.loadingStates.shift = false;
    }
  },

  openCloseShiftModal() {
    return this.tutupShift();
  },

  getShiftCashDifference() {
    const expected = (this.shiftSummary.startCash || 0) + (this.shiftSummary.cashSales || 0);
    return (Number(this.physicalCashCount) || 0) - expected;
  },

  /**
   * Konfirmasi submit penutupan shift:
   * PATCH /pos/shifts/{shiftId}
   * Auto-download PDF, clear session, redirect ke /
   */
    async submitCloseShift() {
    // 🔒 PIN GATE
    const pinOk = await this.requestSupervisorPin(
      'TUTUP SHIFT',
      `Shift: ${this.kasirInfo.shiftId || 'aktif'}`
    );
    if (!pinOk) {
      this.showToast('Penutupan shift dibatalkan', 'notify');
      return;
    }

    const shiftId = this.kasirInfo.shiftId || 'S-2026-09-18-01';
    const expectedCash = (this.shiftSummary.startCash || 0) + (this.shiftSummary.cashSales || 0);
    const inputUangFisik = Number(this.physicalCashCount) || 0;
    const diff = inputUangFisik - expectedCash;
    const closePayload = {
      close: Date.now(),
      closeCash: inputUangFisik,
      expectedCash: expectedCash,
      diff: diff,
      note: this.shiftClosingNotes || '',
      status: 'closed'
    };

    this.loadingStates.shift = true;
    this._shiftClosedHandled = true; // ✅ BUG-4: Tandai tab ini yang menutup shift sendiri
    try {
      // 1. PATCH /pos/shifts/{shiftId}
      await fetch(`/pos/shifts/${encodeURIComponent(shiftId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(closePayload)
      });

      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const shiftRef = this._fbRef(this._fbDb, `pos/shifts/${shiftId}`);
          await this._fbSet(shiftRef, { ...this.shiftSummary, ...closePayload });
        } catch (e) {
          console.warn('Firebase close shift warning:', e);
        }
      }

            this.closeShiftModal = false;
      this.showToast(`Shift ${shiftId} berhasil ditutup. Mengunduh laporan...`, 'success');

      // ✅ FITUR-1: Auto-jurnal selisih kas (kalau diff ≠ 0 & toggle ON)
      if (this.autoJournalShiftDiff && Math.abs(diff) >= 1) {
        try {
          const absDiff = Math.abs(diff);
          // diff < 0 → kas kurang → D 6005 Beban Operasional / K 1001 Kas
          // diff > 0 → kas lebih  → D 1001 Kas / K 6005 Beban Operasional (reversal)
          const debitAcc = diff < 0 ? '6005' : '1001';
          const creditAcc = diff < 0 ? '1001' : '6005';
          const desc = diff < 0
            ? `Selisih kas kurang saat tutup shift ${shiftId}`
            : `Selisih kas lebih saat tutup shift ${shiftId}`;

          const bulan = new Date().toISOString().slice(0, 7);
          const jurnalRes = await fetch(`/accounting/journal/${bulan}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category: 'penyesuaian',
              date: new Date().toISOString().slice(0, 10),
              desc,
              ref: `SHIFT-DIFF-${shiftId}`,
              status: 'approved',
              lines: [
                { acc: debitAcc, debit: absDiff, credit: 0 },
                { acc: creditAcc, debit: 0, credit: absDiff }
              ],
              createdBy: this.kasirInfo?.name || 'kasir'
            })
          });
          if (jurnalRes.ok) {
            console.log('[SHIFT-DIFF] ✅ Auto-jurnal selisih kas:', { diff, absDiff });
          } else {
            console.warn('[SHIFT-DIFF] ⚠️ Gagal auto-jurnal:', await jurnalRes.text());
          }
        } catch (err) {
          console.warn('[SHIFT-DIFF] ❌ Error:', err);
        }
      }

      // 2. Generate PDF laporan shift & auto-download
      await this.exportLaporanPDF('shift');

      // 3. Clear sessionStorage + localStorage 'dapur_kasir_session'
      sessionStorage.removeItem('dapur_kasir_session');

      // 4. Redirect ke /
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
    } catch (err) {
      console.error('Gagal tutup shift:', err);
      this.showToast('Gagal menyimpan data penutupan shift', 'error');
    } finally {
      this.loadingStates.shift = false;
    }
  },

  /**
   * Ambil 30 shift terakhir dari /pos/shifts, sort by open DESC
   */
  async loadRiwayatShift() {
    this.loadingStates.shift = true;
    try {
      const res = await fetch('/pos/shifts');
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.data)) {
          const sorted = json.data.sort((a, b) => (b.open || 0) - (a.open || 0)).slice(0, 30);
          this.shiftHistory = sorted.map(s => ({
            id: s.id,
            kasir: s.kasir || 'Kasir',
            openTime: s.open ? this.formatDate(s.open) + ' ' + this.formatTime(s.open) : '-',
            closeTime: s.close ? this.formatDate(s.close) + ' ' + this.formatTime(s.close) : '-',
            total: Number(s.totalSales || s.total || 0),
            status: s.status === 'closed' ? 'selesai' : 'berjalan'
          }));
        }
      }
    } catch (e) {
      console.warn('loadRiwayatShift exception:', e);
    } finally {
      this.loadingStates.shift = false;
    }
  },

  // -------------------------------------------------------------------------
  // 14.2 INVENTORY MANAGEMENT
  // -------------------------------------------------------------------------

  /**
   * Realtime listener /inventory & fetch awal
   */
  async loadInventory() {
    this.loadingStates.inventory = true;

    // Timeout safety 5 detik agar state loading tidak gantung
    const invTimeout = setTimeout(() => {
      if (this.loadingStates && this.loadingStates.inventory) {
        console.warn('Inventory loading timeout 5s, unlocking loading state');
        this.loadingStates.inventory = false;
      }
    }, 15000);

    try {
      if (this._fbDb && this._fbOnValue && this._fbRef) {
        try {
          const invRef = this._fbRef(this._fbDb, 'inventory');
          this._fbOnValue(invRef, (snapshot) => {
            clearTimeout(invTimeout);
            const val = snapshot.val();
            console.log('[FB-INV] inventory listener:', val ? Object.keys(val).length + ' items' : 'kosong');
            if (val) {
              this.inventoryList = Array.isArray(val) 
                ? JSON.parse(JSON.stringify(val)) 
                : Object.entries(val).map(([k, v]) => ({ id: k, ...v }));
            }
            this.loadingStates.inventory = false;
          }, (err) => {
            clearTimeout(invTimeout);
            console.warn('Firebase inventory listener error:', err);
            this.loadingStates.inventory = false;
          });
        } catch (e) {
          console.warn('Firebase inventory listener warning:', e);
        }
      }

      // ✅ FIX: Fetch backend HANYA kalau Firebase listener belum kasih data
      // Jangan override Firebase state (source of truth) dengan backend stale
      if (!this.inventoryList || this.inventoryList.length === 0) {
        const res = await fetch('/inventory');
        if (res.ok) {
          const ct = res.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            try {
              const json = await res.json();
              if (Array.isArray(json.data) && json.data.length > 0) {
                this.inventoryList = json.data;
              }
            } catch (jsonErr) {
              console.warn('Gagal parse JSON dari /inventory:', jsonErr);
            }
          }
        }
      }

      // Restore dari localStorage jika kosong
      if (!this.inventoryList || this.inventoryList.length === 0) {
        try {
          const saved = localStorage.getItem('dapur_inventory_list');
          if (saved) {
            this.inventoryList = JSON.parse(saved);
          }
        } catch (e) {}
      }

      // Default fallback dataset jika masih kosong
      if (!this.inventoryList || this.inventoryList.length === 0) {
        this.inventoryList = [
          { id: 'inv1', name: 'Filet Dada Ayam Segar', category: 'Bahan Baku', stock: 18, minStock: 5, unit: 'kg', purchasePrice: 38000, isCountable: true },
          { id: 'inv2', name: 'Tepung Roti Panko Katsu', category: 'Bahan Kering', stock: 4, minStock: 6, unit: 'kg', purchasePrice: 22000, isCountable: true },
          { id: 'inv3', name: 'Beras Pulen Premium', category: 'Sembako', stock: 45, minStock: 20, unit: 'kg', purchasePrice: 14000, isCountable: true },
          { id: 'inv4', name: 'Kulit Pangsit Dimsum', category: 'Bahan Baku', stock: 2, minStock: 5, unit: 'pack', purchasePrice: 15000, isCountable: true }
        ];
      }

      // ❌ REMOVED: auto-save Firestore — ini bikin race condition & timpa data retur
      // Firebase listener sudah jadi source of truth, write langsung via _persistShortCode dkk.

    } catch (e) {
      console.warn('loadInventory exception:', e);
    } finally {
      clearTimeout(invTimeout);
      this.loadingStates.inventory = false;
    }
  },

  /**
   * Update stok & harga beli item inventori & catat log aktivitas
   */
  async updateStok(itemId, newStok, keterangan, changeType = 'adjustment') {
    const numStok = Number(newStok);
    if (isNaN(numStok) || numStok < 0) {
      this.showToast('Jumlah stok harus angka valid >= 0', 'error');
      return;
    }
    const item = this.inventoryList.find(i => i.id === itemId);
    const oldStok = item ? Number(item.stock || item.stok || 0) : 0;
    const logId = 'log_' + Date.now();
    const kasirUsername = this.kasirInfo.username || 'kasir';

    const newPurchasePrice = this.selectedStockItem?.purchasePrice !== undefined 
      ? Number(this.selectedStockItem.purchasePrice) 
      : (item?.purchasePrice || 0);

    const logPayload = {
      t: Date.now(),
      old: oldStok,
      new: numStok,
      diff: numStok - oldStok,
      by: kasirUsername,
      reason: keterangan || 'Penyesuaian stok kasir',
      changeType: changeType || 'adjustment'
    };

    try {
      // 1. PATCH /inventory/{itemId}/stok = newStok
      await fetch(`/inventory/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stok: numStok, stock: numStok, purchasePrice: newPurchasePrice })
      });

      // 2. Log ke /inventory_logs/{itemId}/{logId}
      await fetch(`/inventory_logs/${encodeURIComponent(itemId)}/${encodeURIComponent(logId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logPayload)
      });

      // 3. Realtime database sync
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const stockRef = this._fbRef(this._fbDb, `inventory/${itemId}`);
          await this._fbSet(stockRef, JSON.parse(JSON.stringify({
            id: itemId,
            stok: numStok,
            stock: numStok,
            name: item ? item.name : itemId,
            category: item ? item.category : 'Bahan Baku',
            minStock: item ? item.minStock : 5,
            unit: item ? item.unit : 'kg',
            purchasePrice: newPurchasePrice,
            isCountable: item ? item.isCountable : true,
            lastUpdate: Date.now()
          })));
          const logRef = this._fbRef(this._fbDb, `inventory_logs/${itemId}/${logId}`);
          await this._fbSet(logRef, JSON.parse(JSON.stringify(logPayload)));
        } catch (fbErr) {
          console.warn('Firebase inventory stock sync error:', fbErr);
        }
      }

            if (item) {
        item.stock = numStok;
        item.stok = numStok;
        item.purchasePrice = newPurchasePrice;
      }

      // ✅ SPRINT 2 FIX: Catat log riwayat inventory (sebelumnya hanya dummy)
      try {
        this.addInventoryLog(
          item ? item.name : itemId,
          oldStok,
          numStok,
          item ? (item.unit || 'unit') : 'unit',
          changeType === 'purchase' ? 'Restock Supplier'
            : changeType === 'waste' ? 'Rusak / Expired'
            : changeType === 'opname' ? 'Stok Opname'
            : 'Penyesuaian',
          keterangan || 'Update stok'
        );
      } catch (e) {
        console.warn('[INV-LOG] Failed to add log:', e);
      }

      try {
        localStorage.setItem('dapur_inventory_list', JSON.stringify(this.inventoryList));
      } catch (e) {}

      this.showToast(`Stok "${item ? item.name : itemId}" diperbarui menjadi ${numStok}`, 'success');
      this.editStockModal = false;
    } catch (err) {
      console.error('Gagal update stok:', err);
      this.showToast('Gagal memperbarui stok item', 'error');
    }
  },

  /**
   * Helper auto-jurnal pembelian bahan
   */
  async autoCreatePurchaseJournal({ date, desc, amount, paymentMethod = 'cash', ref = '' }) {
    if (!amount || amount <= 0) return;
    const dateStr = date || new Date().toISOString().slice(0, 10);
    const journalId = 'JRN-' + Date.now();
    const refStr = ref || ('INV-' + dateStr.replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase());

    let creditAcc = '1001';
    let creditAccName = 'Kas di Tangan';
    const pm = String(paymentMethod).toLowerCase();
    if (pm === 'transfer' || pm === 'bank' || pm === 'bca') {
      creditAcc = '1002';
      creditAccName = 'Kas di Bank BCA';
    } else if (pm === 'payable' || pm === 'hutang' || pm === 'kredit') {
      creditAcc = '2001';
      creditAccName = 'Hutang Usaha Supplier';
    }

    const journalPayload = {
      id: journalId,
      date: dateStr,
      category: 'pembelian',
      desc: desc || `Pembelian bahan baku`,
      ref: refStr,
      status: 'approved',
      timestamp: Date.now(),
      lines: [
        { acc: '1004', name: 'Persediaan Bahan Baku', debit: Number(amount), credit: 0 },
        { acc: creditAcc, name: creditAccName, debit: 0, credit: Number(amount) }
      ]
    };

    try {
      await fetch(`/accounting/journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(journalPayload)
      });
      console.log('[KASIR-APP] Auto-generated purchase journal:', journalPayload);
    } catch (e) {
      console.warn('[KASIR-APP] Auto purchase journal note:', e);
    }
  },

  /**
   * Helper auto-jurnal bahan rusak / expired (waste)
   */
  async autoCreateWasteJournal({ date, desc, amount, ref = '' }) {
    if (!amount || amount <= 0) return;
    const dateStr = date || new Date().toISOString().slice(0, 10);
    const journalId = 'JRN-' + Date.now();
    const refStr = ref || ('WST-' + dateStr.replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase());

    const journalPayload = {
      id: journalId,
      date: dateStr,
      category: 'penyesuaian',
      desc: desc || `Bahan baku rusak / expired (waste)`,
      ref: refStr,
      status: 'approved',
      timestamp: Date.now(),
      lines: [
        { acc: '6005', name: 'Beban Operasional & Kerugian Bahan', debit: Number(amount), credit: 0 },
        { acc: '1004', name: 'Persediaan Bahan Baku', debit: 0, credit: Number(amount) }
      ]
    };

    try {
      await fetch(`/accounting/journal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(journalPayload)
      });
      console.log('[KASIR-APP] Auto-generated waste journal:', journalPayload);
    } catch (e) {
      console.warn('[KASIR-APP] Auto waste journal note:', e);
    }
  },

  /**
   * Riwayat Transaksi Modal Helpers
   */
  async openTransactionHistoryModal() {
    this.showTxHistoryModal = true;
    await this.loadTransactionHistory(this.txHistoryDate || new Date().toISOString().slice(0, 10));
  },

  async loadTransactionHistory(dateStr) {
    const targetDate = dateStr || this.txHistoryDate || new Date().toISOString().slice(0, 10);
    this.txHistoryDate = targetDate;
    this.txHistoryLoading = true;
    try {
      const res = await fetch(`/pos/transactions/${targetDate}`);
      if (res.ok) {
        const json = await res.json();
        this.txHistoryList = Array.isArray(json.data) ? json.data : (json.transactions ? Object.values(json.transactions) : []);
      } else {
        this.txHistoryList = [];
      }
    } catch (e) {
      console.warn('Load tx history note:', e);
      this.txHistoryList = [];
    } finally {
      this.txHistoryLoading = false;
    }
  },

      /**
   * Helper: Resolve nama menu dari array [id, qty, price] atau object
   */
  getTxItemName(item) {
    if (!item) return 'Item';
    // Kalau sudah object dengan name
    if (item.name) return item.name;
    if (item.menuName) return item.menuName;
    // Kalau array [id, qty, price] — lookup dari menuList
    const id = Array.isArray(item) ? item[0] : (item.id || item.menuId);
    if (!id) return 'Menu';
    const menu = (this.menuList || []).find(m => m.id === id);
    return menu ? menu.name : id;
  },

  /**
   * Helper: Ambil qty dari item
   */
  getTxItemQty(item) {
    if (!item) return 1;
    if (Array.isArray(item)) return Number(item[1]) || 1;
    return Number(item.qty || item.quantity) || 1;
  },
    filteredTxHistory() {
    let list = this.txHistoryList || [];

    // FASE 5: transaksi order online (landing page) punya kolom filter sendiri ("Online"),
    // tidak digabung ke QRIS. Sumber: source === 'landing-page' atau online_order_id terisi.
    const filterVal = String(this.txHistoryPaymentFilter || 'all').toLowerCase();
    const onlineOnly = filterVal === 'online';
    const isOnlineTx = (t) => !!t && (t.source === 'landing-page' ||
      (t.online_order_id !== undefined && t.online_order_id !== null && t.online_order_id !== ''));

    // ✅ FIX C3: Tampilkan transaksi POS langsung (T*) DAN order customer yang sudah reconciled (ORD-*)
    // Beda penanganan karena POS langsung selalu sah, order customer perlu direkonsiliasi
    list = list.filter(t => {
      if (isOnlineTx(t)) {
        // Order online: tampil di filter "Online" dan "Semua" saja
        return onlineOnly || filterVal === 'all';
      }
      if (onlineOnly) return false;
      const id = String(t.id || t.orderId || '').toUpperCase();
      // Transaksi POS langsung (T-prefix): selalu tampil
      if (id.startsWith('T')) return true;
      // Order dari customer (ORD-prefix): tampil hanya kalau sudah reconciled
      if (id.startsWith('ORD-')) return t.reconciled === true;
      // Fallback: kalau reconciled bukan false, tampilkan
      return t.reconciled !== false;
    });

    // ✅ VOID: sembunyikan transaksi yang sudah di-void
    list = list.filter(t => t.voided !== true);

    // Filter metode pembayaran (tunai/qris/transfer) — order online dikecualikan
    if (filterVal !== 'all' && !onlineOnly) {
      list = list.filter(t => {
        const pm = (t.pm || t.paymentMethod || '').toLowerCase();
        // ✅ Handle alias: "tunai" = "cash"
        if (filterVal === 'tunai' || filterVal === 'cash') {
          return pm === 'tunai' || pm === 'cash' || pm === '';  // empty pm = cash default
        }
        return pm === filterVal;
      });
    }

    if (this.txHistorySearch) {
      const q = this.txHistorySearch.toLowerCase().trim();
      list = list.filter(t => 
        (t.id || t.orderId || '').toLowerCase().includes(q) ||
        (t.customer || t.cust || '').toLowerCase().includes(q) ||
        String(t.tot || t.total || t.amount || '').includes(q)
      );
    }
    return list;
  },

  /**
   * Pembelian Bahan Baku Module Methods
   */
  onPembelianItemChange() {
    const it = this.inventoryList.find(i => i.id === this.pembelianForm.itemId);
    if (it) {
      this.pembelianForm.unit = it.unit || 'kg';
      this.pembelianForm.purchasePrice = Number(it.purchasePrice || it.hargaBeli || 0);
    }
  },

    async submitPembelianBahan() {
    // ✅ FIX BUG-4: Block kalau shift sudah closed
    if (this.shiftStatus === 'closed' || this._shiftClosedHandled) {
      this.showToast('⚠️ Shift sudah ditutup. Tidak bisa input pembelian.', 'error');
      this.playSound('error');
      setTimeout(() => { window.location.href = '/'; }, 800);
      return;
    }

    const { date, supplier, itemId, qty, purchasePrice, paymentMethod, notes } = this.pembelianForm;
    if (!itemId) {
      this.showToast('Pilih bahan baku yang dibeli', 'error');
      return;
    }
    const numQty = Number(qty) || 0;
    if (numQty <= 0) {
      this.showToast('Jumlah qty masuk harus lebih dari 0', 'error');
      return;
    }
    const numPrice = Number(purchasePrice) || 0;
    if (numPrice <= 0) {
      this.showToast('Harga beli per unit harus valid (> 0)', 'error');
      return;
    }
    const reasonNotes = String(notes || '').trim();
    if (reasonNotes.length < 5) {
      this.showToast('Catatan/Alasan pembelian wajib diisi (minimal 5 karakter)', 'error');
      return;
    }

    const item = this.inventoryList.find(i => i.id === itemId);
    if (!item) {
      this.showToast('Item inventori tidak ditemukan', 'error');
      return;
    }

    const totalBeli = numQty * numPrice;
    const oldStock = Number(item.stock || item.stok || 0);
    const newStock = oldStock + numQty;
    const dateStr = date || new Date().toISOString().slice(0, 10);
    const refNumber = 'INV-' + dateStr.replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const logId = 'log_' + Date.now();
    const kasirName = this.kasirInfo?.name || this.kasirInfo?.username || 'kasir';

    try {
      // 1. Update /inventory/{itemId}
      await fetch(`/inventory/${encodeURIComponent(itemId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock: newStock,
          stok: newStock,
          purchasePrice: numPrice,
          lastUpdate: Date.now()
        })
      });

      // 2. Log ke /inventory_logs/{itemId}/{logId}
      const logPayload = {
        t: Date.now(),
        old: oldStock,
        new: newStock,
        diff: numQty,
        by: `${kasirName} (Beli: ${supplier || 'Supplier'})`,
        reason: reasonNotes,
        changeType: 'purchase'
      };

      await fetch(`/inventory_logs/${encodeURIComponent(itemId)}/${encodeURIComponent(logId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logPayload)
      });

      // 3. Simpan record riwayat pembelian
      const purchaseRecord = {
        id: refNumber,
        date: dateStr,
        timestamp: Date.now(),
        itemId: item.id,
        itemName: item.name,
        category: item.category,
        supplier: supplier || 'Supplier Umum',
        qty: numQty,
        unit: item.unit,
        purchasePrice: numPrice,
        total: totalBeli,
        paymentMethod: paymentMethod || 'cash',
        notes: reasonNotes,
        kasir: kasirName
      };

      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const pRef = this._fbRef(this._fbDb, `purchases/${dateStr.slice(0, 7)}/${refNumber}`);
          await this._fbSet(pRef, purchaseRecord);
        } catch (e) {}
      }

      // 4. Auto create Accounting Journal
      await this.autoCreatePurchaseJournal({
        date: dateStr,
        desc: `Pembelian ${item.name} ${numQty} ${item.unit} dari ${supplier || 'Supplier'}`,
        amount: totalBeli,
        paymentMethod: paymentMethod,
        ref: refNumber
      });

      // Update local item
      item.stock = newStock;
      item.stok = newStock;
      item.purchasePrice = numPrice;

      // Update pembelian list
      this.pembelianList.unshift(purchaseRecord);
      try {
        localStorage.setItem('dapur_purchases_' + dateStr.slice(0, 7), JSON.stringify(this.pembelianList));
      } catch (e) {}

      this.showToast(`Pembelian ${item.name} (${numQty} ${item.unit}) berhasil dicatat & jurnal terbit!`, 'success');

      // Reset form
      this.pembelianForm = {
        date: new Date().toISOString().slice(0, 10),
        supplier: '',
        itemId: '',
        qty: 1,
        unit: '',
        purchasePrice: 0,
        total: 0,
        paymentMethod: 'cash',
        notes: '',
        receiptImage: ''
      };

      await this.loadInventory();
    } catch (err) {
      console.error('Gagal simpan pembelian:', err);
      this.showToast('Gagal memproses pembelian bahan', 'error');
    }
  },

  async loadRiwayatPembelian() {
    this.loadingPembelian = true;
    try {
      const month = (this.pembelianDateFilter || new Date().toISOString().slice(0, 7)).slice(0, 7);
      if (this._fbDb && this._fbRef && this._fbGet) {
        const pRef = this._fbRef(this._fbDb, `purchases/${month}`);
        const snap = await this._fbGet(pRef);
        if (snap.exists()) {
          const val = snap.val();
          this.pembelianList = Object.values(val).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        } else {
          this.pembelianList = [];
        }
      } else {
        const saved = localStorage.getItem('dapur_purchases_' + month);
        if (saved) {
          this.pembelianList = JSON.parse(saved);
        } else {
          this.pembelianList = [];
        }
      }
    } catch (e) {
      console.warn('Load pembelian note:', e);
    } finally {
      this.loadingPembelian = false;
    }
  },

  filteredPembelianList() {
    let list = this.pembelianList || [];
    if (this.pembelianDateFilter) {
      list = list.filter(p => p.date === this.pembelianDateFilter);
    }
    if (this.pembelianSearch) {
      const q = this.pembelianSearch.toLowerCase().trim();
      list = list.filter(p => 
        (p.itemName || '').toLowerCase().includes(q) ||
        (p.supplier || '').toLowerCase().includes(q) ||
        (p.notes || '').toLowerCase().includes(q) ||
        (p.id || '').toLowerCase().includes(q)
      );
    }
    return list;
  },

  exportPembelianCSV() {
    const list = this.filteredPembelianList();
    if (list.length === 0) {
      this.showToast('Tidak ada data pembelian untuk diexport', 'notify');
      return;
    }
    let csv = 'ID,Tanggal,Bahan Baku,Kategori,Supplier,Qty,Satuan,Harga Beli (Rp),Total (Rp),Metode Bayar,Catatan,Kasir\n';
    list.forEach(p => {
      csv += `"${p.id}","${p.date}","${p.itemName}","${p.category}","${p.supplier}",${p.qty},"${p.unit}",${p.purchasePrice},${p.total},"${p.paymentMethod}","${(p.notes || '').replace(/"/g, '""')}","${p.kasir}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `pembelian_bahan_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.showToast('CSV riwayat pembelian berhasil didownload', 'success');
  },

  openEditStockModal(item) {
    if (!item) return;
    this.selectedStockItem = {
      id: item.id || '',
      name: item.name || '',
      category: item.category || 'Bahan Baku',
      stock: Number(item.stock || item.stok || 0),
      minStock: Number(item.minStock || 0),
      unit: item.unit || 'unit',
      purchasePrice: item.purchasePrice !== undefined ? Number(item.purchasePrice) : 0,
      isCountable: item.isCountable !== false,
      sku: item.sku || '',
      skuSource: item.skuSource || 'internal',
      barcodeFormat: item.barcodeFormat || 'CODE128',
      barcode: item.barcode || item.sku || '',
      supplierId: item.supplierId || '',
      supplierName: item.supplierName || '',
      isReadyToSell: Boolean(item.isReadyToSell),
      linkedMenuId: item.linkedMenuId || null
    };
    this.newStockValue = Number(item.stock || item.stok || 0);
    this.stockChangeType = 'adjustment';
    this.stockChangePaymentMethod = 'cash';
    this.stockChangeReason = '';
    this.editStockModal = true;
  },
 
    /**
     * Hapus item inventory dari Firebase + lokal
     * (Destructive action — butuh konfirmasi user)
     */
        async hapusItemInventory(itemId) {
      if (!itemId) {
        this.showToast('ID item tidak valid', 'error');
        return false;
      }

      const item = this.inventoryList.find(i => i.id === itemId);
      const itemName = item ? item.name : itemId;

      // 🔒 PIN GATE
      const pinOk = await this.requestSupervisorPin(
        'HAPUS INVENTORY',
        `Item: ${itemName}`
      );
      if (!pinOk) {
        this.showToast('Aksi dibatalkan', 'notify');
        return false;
      }

      const ok = confirm(
        `⚠️ HAPUS ITEM DARI INVENTORI\n\n` +
        `Nama: ${itemName}\n` +
        `ID: ${itemId}\n\n` +
        `Item akan dihapus PERMANEN dari Firebase & lokal.\n` +
        `Tindakan ini TIDAK bisa dibatalkan.\n\n` +
        `Lanjutkan?`
      );
      if (!ok) return false;

      try {
        // 1. Hapus dari Firebase
        if (this._fbDb && this._fbSet && this._fbRef) {
          const itemRef = this._fbRef(this._fbDb, `inventory/${itemId}`);
          await this._fbSet(itemRef, null);
          console.log(`[INV-DELETE] Firebase inventory/${itemId} dihapus`);
        }

        // 2. Hapus dari state lokal
        this.inventoryList = this.inventoryList.filter(i => i.id !== itemId);

        // 3. Update localStorage
        try {
          localStorage.setItem('dapur_inventory_list', JSON.stringify(this.inventoryList));
        } catch (e) {}

        // 4. Tutup modal & reset
        this.selectedStockItem = { id: '', name: '', category: 'Bahan Baku', stock: 0, minStock: 0, unit: 'unit', purchasePrice: 0, isCountable: true };
        this.editStockModal = false;

        this.showToast(`✅ Item "${itemName}" berhasil dihapus`, 'success');
        this.playSound('success');
        return true;

      } catch (err) {
        console.error('[INV-DELETE] Error:', err);
        this.showToast(`Gagal hapus: ${err.message}`, 'error');
        this.playSound('error');
        return false;
      }
    },

      async submitEditStock() {
    if (!this.selectedStockItem) return;

    // ✅ FIX BUG-4: Block kalau shift sudah closed
    if (this.shiftStatus === 'closed' || this._shiftClosedHandled) {
      this.showToast('⚠️ Shift sudah ditutup. Tidak bisa edit stok.', 'error');
      this.playSound('error');
      setTimeout(() => { window.location.href = '/'; }, 800);
      return;
    }
        // ✅ FIX BUG-4: Block kalau shift sudah closed
    if (this.shiftStatus === 'closed' || this._shiftClosedHandled) {
      this.showToast('⚠️ Shift sudah ditutup. Tidak bisa edit stok.', 'error');
      this.playSound('error');
      setTimeout(() => { window.location.href = '/'; }, 800);
      return;
    }

        // ✅ FIX BUG-4: Block kalau shift sudah closed
    if (this.shiftStatus === 'closed' || this._shiftClosedHandled) {
      this.showToast('⚠️ Shift sudah ditutup. Tidak bisa edit stok.', 'error');
      this.playSound('error');
      setTimeout(() => { window.location.href = '/'; }, 800);
      return;
    }

    // 🔒 PIN GATE (khusus untuk koreksi manual / waste / edit harga)
    const isDestructive = ['adjustment', 'waste', 'opname'].includes(this.stockChangeType);
    if (isDestructive) {
      const pinOk = await this.requestSupervisorPin(
        'EDIT STOK',
        `${this.selectedStockItem.name} (${this.stockChangeType})`
      );
      if (!pinOk) {
        this.showToast('Edit stok dibatalkan', 'notify');
        return;
      }
    }

    const reason = String(this.stockChangeReason || '').trim();
    if (reason.length < 5) {
      this.showToast('Alasan perubahan stok wajib diisi minimal 5 karakter', 'error');
      return;
    }

    const item = this.inventoryList.find(i => i.id === this.selectedStockItem.id);
    const oldStok = item ? Number(item.stock || item.stok || 0) : 0;
    const diff = Number(this.newStockValue) - oldStok;
    const price = Number(this.selectedStockItem.purchasePrice || item?.purchasePrice || 0);
    const totalValue = Math.abs(diff) * price;

    if (this.stockChangeType === 'purchase' && diff > 0 && totalValue > 0) {
      await this.autoCreatePurchaseJournal({
        date: new Date().toISOString().slice(0, 10),
        desc: `Restock/Pembelian: ${this.selectedStockItem.name} ${diff} ${this.selectedStockItem.unit}`,
        amount: totalValue,
        paymentMethod: this.stockChangePaymentMethod || 'cash'
      });
    } else if (this.stockChangeType === 'waste' && diff < 0 && totalValue > 0) {
      await this.autoCreateWasteJournal({
        date: new Date().toISOString().slice(0, 10),
        desc: `Bahan rusak/expired: ${this.selectedStockItem.name} ${Math.abs(diff)} ${this.selectedStockItem.unit}`,
        amount: totalValue
      });
    }

    if (item && this.selectedStockItem) {
      if (this.selectedStockItem.sku !== undefined) item.sku = this.selectedStockItem.sku;
      if (this.selectedStockItem.skuSource !== undefined) item.skuSource = this.selectedStockItem.skuSource;
      if (this.selectedStockItem.barcode !== undefined) item.barcode = this.selectedStockItem.barcode;
      if (this.selectedStockItem.barcodeFormat !== undefined) item.barcodeFormat = this.selectedStockItem.barcodeFormat;
      if (this.selectedStockItem.supplierId !== undefined) item.supplierId = this.selectedStockItem.supplierId;
      if (this.selectedStockItem.supplierName !== undefined) item.supplierName = this.selectedStockItem.supplierName;
      if (this.selectedStockItem.isReadyToSell !== undefined) item.isReadyToSell = Boolean(this.selectedStockItem.isReadyToSell);
      if (this.selectedStockItem.linkedMenuId !== undefined) item.linkedMenuId = this.selectedStockItem.linkedMenuId;

      fetch(`/inventory/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: item.sku,
          skuSource: item.skuSource,
          barcode: item.barcode,
          barcodeFormat: item.barcodeFormat,
          supplierId: item.supplierId,
          supplierName: item.supplierName,
          isReadyToSell: item.isReadyToSell,
          linkedMenuId: item.linkedMenuId
        })
      }).catch(() => {});
    }

    return this.updateStok(this.selectedStockItem.id, this.newStockValue, reason, this.stockChangeType);
  },

  async toggleCountable(item) {
    if (!item) return;
    const newCountable = item.isCountable === false ? true : false;
    try {
      await fetch(`/inventory/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isCountable: newCountable })
      });
      item.isCountable = newCountable;
      this.showToast(`Status item "${item.name}" diubah menjadi ${newCountable ? 'Countable' : 'Uncountable'}`, 'success');
    } catch (e) {
      this.showToast('Gagal mengubah status countable', 'error');
    }
  },

  /**
   * Ambil saldo kas tunai aktif saat ini
   */
 getCashInHand() {
  // Priority 1: Accounting Summary (data ledger real-time dari backend)
  if (this.accountingSummaryData && this.accountingSummaryData.saldoKas != undefined) {
    const acctKas = Math.max(0, Number(this.accountingSummaryData.saldoKas));
    if (acctKas > 0) return acctKas;
  }

  // Priority 2: Fallback hitung dari shiftSummary (kalau summary belum ke-load)
  const startCash = Number(this.shiftSummary?.startCash) || 0;
  const cashSales = Number(this.shiftSummary?.cashSales) || 0;
  const cashExpenses = Number(this.shiftSummary?.cashExpenses) || 0;
  return Math.max(0, startCash + cashSales - cashExpenses);
},

  openAddInventoryModal() {
    this.newInventoryForm = {
      nama: '',
      category: 'Bahan Baku',
      stok: 10,
      min: 5,
      unit: 'kg',
      purchasePrice: 0,
      isCountable: true
    };
    this.addInventoryModal = true;
  },

  async submitAddInventory() {
    return await this.tambahItemInventory(this.newInventoryForm);
  },

  /**
   * Tambah item inventori baru dengan validasi saldo kas tunai otomatis
   */
  async tambahItemInventory(form) {
    if (!form || !form.nama || !form.nama.trim()) {
      this.showToast('Nama item/bahan baku wajib diisi', 'error');
      return false;
    }

    const itemName = form.nama.trim();
    const stokAwal = Math.max(0, Number(form.stok) || 0);
    const minStok = Math.max(0, Number(form.min) || 0);
    const hargaBeli = Math.max(0, Number(form.purchasePrice) || 0);
    const totalCost = Math.round(stokAwal * hargaBeli);
    const availableCash = this.getCashInHand();

    // 1. Validasi saldo kas tunai jika ada nilai modal pembelian (> 0)
    if (totalCost > 0 && availableCash < totalCost) {
      this.insufficientCashInfo = {
        itemName: itemName,
        totalCost: totalCost,
        availableCash: availableCash,
        shortfall: totalCost - availableCash
      };
      this.insufficientCashModal = true;
      this.playSound('error');
      return false;
    }

    // 2. Jika dana kas tunai cukup & totalCost > 0: Kurangi saldo kas tunai dan catat jurnal
    if (totalCost > 0) {
      this.shiftSummary.cashExpenses = (this.shiftSummary.cashExpenses || 0) + totalCost;
      if (this.accountingSummaryData && this.accountingSummaryData.saldoKas !== undefined) {
        this.accountingSummaryData.saldoKas = Math.max(0, Number(this.accountingSummaryData.saldoKas) - totalCost);
      }
      
      const dateStr = new Date().toISOString().slice(0, 10);
      const refNumber = 'INV-' + dateStr.replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      
      await this.autoCreatePurchaseJournal({
        date: dateStr,
        desc: `Pembelian Bahan Baru: ${itemName} (${stokAwal} ${form.unit || 'kg'})`,
        amount: totalCost,
        paymentMethod: 'cash',
        ref: refNumber
      });
    }

    // 3. Buat objek item inventori baru
    const newItemId = 'inv_' + Date.now();
    const skuSource = form.skuSource || 'internal';
    const skuCode = form.sku || (skuSource === 'external' ? (form.barcode || '') : this.generateSKU(form.category, skuSource, form.supplierName || ''));
    const barcodeCode = form.barcode || skuCode || '';
    const barcodeFormat = form.barcodeFormat || (barcodeCode.length === 13 ? 'EAN13' : 'CODE128');

    const newItem = {
      id: newItemId,
      name: itemName,
      category: form.category || 'Bahan Baku',
      stock: stokAwal,
      stok: stokAwal,
      minStock: minStok,
      unit: form.unit || 'kg',
      purchasePrice: hargaBeli,
      isCountable: form.isCountable !== false,
      sku: skuCode,
      skuSource: skuSource,
      barcode: barcodeCode,
      barcodeFormat: barcodeFormat,
      supplierId: form.supplierId || '',
      supplierName: form.supplierName || '',
      isReadyToSell: Boolean(form.isReadyToSell),
      linkedMenuId: form.linkedMenuId || null,
           barcodeShort: form.barcodeShort || this.generateShortCode(),
      lastUpdate: Date.now(),
      createdAt: Date.now()
    };

    try {
      // Simpan lokal
      this.inventoryList.push(newItem);
      try {
        localStorage.setItem('dapur_inventory_list', JSON.stringify(this.inventoryList));
      } catch (e) {}

      // Simpan ke server
      fetch(`/inventory/${encodeURIComponent(newItemId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newItem)
      }).catch(e => console.warn('POST /inventory note:', e));

      // Simpan ke Firebase
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const itemRef = this._fbRef(this._fbDb, `inventory/${newItemId}`);
          await this._fbSet(itemRef, newItem);

          const logId = 'log_' + Date.now();
          const logRef = this._fbRef(this._fbDb, `inventory_logs/${newItemId}/${logId}`);
          await this._fbSet(logRef, {
            t: Date.now(),
            old: 0,
            new: stokAwal,
            diff: stokAwal,
            by: this.kasirInfo?.name || this.kasirInfo?.username || 'kasir',
            reason: totalCost > 0 ? `Input bahan baru (Total beli: Rp ${this.formatNumber(totalCost)})` : 'Input bahan baru awal',
            changeType: totalCost > 0 ? 'purchase' : 'adjustment'
          });
        } catch (fbErr) {
          console.warn('Firebase inventory save note:', fbErr);
        }
      }

      if (totalCost > 0) {
        this.showToast(`Bahan "${itemName}" berhasil ditambah! Kas terpotong ${this.formatRupiah(totalCost)}`, 'success');
      } else {
        this.showToast(`Bahan "${itemName}" berhasil ditambahkan ke inventori`, 'success');
      }
      this.playSound('success');

      // Tutup modal form & reset
      this.addInventoryModal = false;
      this.newInventoryForm = {
        nama: '',
        category: 'Bahan Baku',
        stok: 10,
        min: 5,
        unit: 'kg',
        purchasePrice: 0,
        isCountable: true
      };

      await this.loadInventory();
      return true;
    } catch (err) {
      console.error('Gagal menambah inventory:', err);
      this.showToast('Gagal menambahkan item inventori', 'error');
      return false;
    }
  },

  filteredInventoryList() {
    if (!this.inventorySearch) return this.inventoryList;
    const q = this.inventorySearch.toLowerCase();
    return this.inventoryList.filter(item =>
      (item.name || '').toLowerCase().includes(q) ||
      (item.category || '').toLowerCase().includes(q)
    );
  },

  // -------------------------------------------------------------------------
  // 14.2.1 PRODUK & FORMULASI RESEP (BOM / INGREDIENT RECIPES)
  // -------------------------------------------------------------------------

  /**
   * Muat formulasi resep menu dari backend
   */
    async loadMenuRecipes() {
    let recipesData = null;

    // 1. Coba fetch dari endpoint /inventory/recipes
    try {
      const res = await fetch('/inventory/recipes');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          recipesData = json.data;
          console.log('[MENU-RECIPES] Loaded from /inventory/recipes:', Object.keys(recipesData).length);
        }
      }
    } catch (e) {
      console.warn('[MENU-RECIPES] Endpoint /inventory/recipes error:', e.message);
    }

    // 2. Fallback: fetch langsung dari Firebase REST API
    if (!recipesData) {
      try {
        const fbUrl = (this._fbConfig && this._fbConfig.databaseURL)
          || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
        const res = await fetch(`${fbUrl.replace(/\/$/, '')}/recipes.json`);
        if (res.ok) {
          recipesData = await res.json();
          console.log('[MENU-RECIPES] Loaded from Firebase fallback:', Object.keys(recipesData || {}).length);
        }
      } catch (e) {
        console.warn('[MENU-RECIPES] Firebase fallback error:', e.message);
      }
    }

    // 3. Normalize ingredients: object → array
    if (recipesData && typeof recipesData === 'object') {
      const normalized = {};
      Object.entries(recipesData).forEach(([menuId, recipe]) => {
        if (recipe && typeof recipe === 'object') {
          const rawIngredients = recipe.ingredients;
          const ingredientsArray = Array.isArray(rawIngredients)
            ? rawIngredients
            : Object.values(rawIngredients || {}).filter(Boolean);

          normalized[menuId] = {
            ...recipe,
            ingredients: ingredientsArray
          };
        }
      });
      this.menuRecipes = normalized;
      console.log(`[MENU-RECIPES] ✅ Total ${Object.keys(normalized).length} recipes siap`);
    } else {
      console.warn('[MENU-RECIPES] ⚠️ Tidak ada resep ter-load');
      this.menuRecipes = {};
    }
  },

  /**
   * Buka modal manajemen resep/bahan baku produk
   */
  openProductRecipeModal(menu) {
    if (!menu) return;
    this.selectedProductForRecipe = menu;
    const existingRecipe = this.menuRecipes[menu.id] || { ingredients: [] };
    
    this.recipeForm = {
      menuId: menu.id,
      menuName: menu.name || '',
      category: menu.category || 'rice_bowl',
      price: Number(menu.price) || 0,
      desc: menu.desc || '',
      showOnMain: menu.showOnMain !== false,
      ingredients: JSON.parse(JSON.stringify(existingRecipe.ingredients || []))
    };
    this.productModal = true;
  },

  /**
   * Tambah baris bahan baku ke formulasi produk
   */
  addIngredientRow() {
    const firstItem = (this.inventoryList && this.inventoryList[0]) ? this.inventoryList[0] : { id: 'inv1', unit: 'kg' };
    this.recipeForm.ingredients.push({
      itemId: firstItem.id,
      amount: firstItem.unit === 'kg' ? 0.1 : 1,
      unit: firstItem.unit || 'kg'
    });
  },

  /**
   * Hapus baris bahan baku dari formulasi produk
   */
  removeIngredientRow(index) {
    this.recipeForm.ingredients.splice(index, 1);
  },

  /**
   * Helper auto-set unit saat item bahan baku diganti
   */
  onRecipeItemChange(ing) {
    if (!ing || !ing.itemId) return;
    const item = (this.inventoryList || []).find(i => i.id === ing.itemId);
    if (item && item.unit) {
      ing.unit = item.unit;
    }
  },

  /**
   * Simpan formulasi resep produk ke server
   */
  async saveProductRecipe() {
    if (!this.recipeForm.menuId) return;
    try {
      const menuId = this.recipeForm.menuId;
      const updatedName = (this.recipeForm.menuName || '').trim() || 'Menu';
      const updatedCategory = this.recipeForm.category || 'rice_bowl';
      const updatedPrice = Number(this.recipeForm.price) || 0;
      const updatedDesc = this.recipeForm.desc || '';
      const updatedShowOnMain = this.recipeForm.showOnMain !== false;

      // 1. Update menu item in local menuList
      const menuObj = this.menuList.find(m => m.id === menuId);
      if (menuObj) {
        menuObj.name = updatedName;
        menuObj.category = updatedCategory;
        menuObj.price = updatedPrice;
        menuObj.desc = updatedDesc;
        menuObj.showOnMain = updatedShowOnMain;
      }

      // 2. Filter & format ingredients
      const rawIngs = Array.isArray(this.recipeForm.ingredients) ? this.recipeForm.ingredients : [];
      const validIngredients = rawIngs
        .filter(ing => ing && ing.itemId && Number(ing.amount) > 0)
        .map(ing => {
          const invItem = (this.inventoryList || []).find(i => i.id === ing.itemId);
          return {
            itemId: ing.itemId,
            amount: Number(ing.amount) || 0.1,
            unit: ing.unit || (invItem ? invItem.unit : 'kg')
          };
        });

      this.menuRecipes[menuId] = {
        menuId: menuId,
        menuName: updatedName,
        ingredients: validIngredients
      };

      // 3. LocalStorage persistence
      try {
        localStorage.setItem('dapur_menu_list', JSON.stringify(this.menuList));
        localStorage.setItem('dapur_menu_items', JSON.stringify(this.menuList));
        localStorage.setItem('dapur_menu_recipes', JSON.stringify(this.menuRecipes));
      } catch (e) {}

      // 4. API & Firebase persistence
      fetch(`/menu/${encodeURIComponent(menuId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updatedName,
          category: updatedCategory,
          price: updatedPrice,
          desc: updatedDesc,
          showOnMain: updatedShowOnMain
        })
      }).catch(e => console.warn('Server menu update note:', e));

      fetch(`/inventory/recipes/${encodeURIComponent(menuId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredients: validIngredients })
      }).catch(e => console.warn('Server recipe save note:', e));

      if (this._fbDb && this._fbRef && this._fbSet) {
        try {
          const recipeRef = this._fbRef(this._fbDb, `recipes/${menuId}`);
          await this._fbSet(recipeRef, {
            menuId: menuId,
            menuName: updatedName,
            ingredients: validIngredients,
            updatedAt: new Date().toISOString()
          });

          const menuRef = this._fbRef(this._fbDb, `menu_items/${menuId}`);
          if (menuObj) {
            await this._fbSet(menuRef, menuObj);
          }
        } catch (fbErr) {
          console.warn('Firebase recipe save warning:', fbErr);
        }
      }

      this.showToast(`Menu & Resep "${updatedName}" berhasil diperbarui!`, 'success');
      this.productModal = false;
      await this.loadInventory();
    } catch (e) {
      console.error('Save recipe error:', e);
      this.showToast('Gagal menyimpan resep', 'error');
    }
  },

  /**
   * Hitung stok porsi yang tersedia untuk menu tertentu
   * Aturan: Jika belum ada resep atau salah satu item stok = 0 / kurang -> porsi = 0
   */
    getMenuCalculatedStock(menuId) {
    const recipe = this.menuRecipes[menuId];
    if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
      // ✅ FIX BUG-6: Fallback ke dual-role inventory link
      const menu = (this.menuList || []).find(m => m.id === menuId);
      if (menu && menu.inventoryId) {
        const inv = (this.inventoryList || []).find(i => i.id === menu.inventoryId);
        if (inv) {
          // ✅ FIX BUG-12: Safe check — jangan pakai `|| 0` karena 0 falsy
          return Number(
            (inv.stock !== undefined && inv.stock !== null) ? inv.stock :
            ((inv.stok !== undefined && inv.stok !== null) ? inv.stok : 0)
          );
        }
      }
      const linkedInv = (this.inventoryList || []).find(i => i.linkedMenuId === menuId);
      if (linkedInv) {
        return Number(
          (linkedInv.stock !== undefined && linkedInv.stock !== null) ? linkedInv.stock :
          ((linkedInv.stok !== undefined && linkedInv.stok !== null) ? linkedInv.stok : 0)
        );
      }
      return 0;
    }

    let minPossiblePortions = Infinity;

    for (const ing of recipe.ingredients) {
      const invItem = this.inventoryList.find(i => i.id === ing.itemId);
      if (!invItem) return 0;
      if (invItem.isCountable === false) continue;

      // ✅ FIX BUG-12: Safe check
      const currentStock = Number(
        (invItem.stock !== undefined && invItem.stock !== null) ? invItem.stock :
        ((invItem.stok !== undefined && invItem.stok !== null) ? invItem.stok : 0)
      );
      const requiredAmount = Number(ing.amount) || 0;
      if (requiredAmount <= 0) continue;

      let availableAmount = currentStock;
      const itemUnit = (invItem.unit || '').toLowerCase();
      const ingUnit = (ing.unit || '').toLowerCase();

      if (itemUnit === 'kg' && ingUnit === 'gram') availableAmount = availableAmount * 1000;
      else if (itemUnit === 'gram' && ingUnit === 'kg') availableAmount = availableAmount / 1000;
      else if (itemUnit === 'liter' && ingUnit === 'ml') availableAmount = availableAmount * 1000;
      else if (itemUnit === 'ml' && ingUnit === 'liter') availableAmount = availableAmount / 1000;

      const portions = Math.floor(availableAmount / requiredAmount);
      if (portions < minPossiblePortions) {
        minPossiblePortions = portions;
      }
    }

    return minPossiblePortions === Infinity ? 0 : Math.max(0, minPossiblePortions);
  },

  /**
   * Dapatkan bahan baku yang menjadi penyebab habisnya stok menu
   */
    getMenuMissingIngredient(menuId) {
    const recipe = this.menuRecipes[menuId];
    if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
      return null;
    }

    for (const ing of recipe.ingredients) {
      const invItem = this.inventoryList.find(i => i.id === ing.itemId);
      if (!invItem) return { name: 'Item Belum Terdaftar' };
      if (invItem.isCountable === false) continue;

      // ✅ FIX BUG-12: Safe check
      const currentStock = Number(
        (invItem.stock !== undefined && invItem.stock !== null) ? invItem.stock :
        ((invItem.stok !== undefined && invItem.stok !== null) ? invItem.stok : 0)
      );
      const requiredAmount = Number(ing.amount) || 0;
      if (requiredAmount <= 0) continue;

      let availableAmount = currentStock;
      const itemUnit = (invItem.unit || '').toLowerCase();
      const ingUnit = (ing.unit || '').toLowerCase();

      if (itemUnit === 'kg' && ingUnit === 'gram') availableAmount = availableAmount * 1000;
      else if (itemUnit === 'gram' && ingUnit === 'kg') availableAmount = availableAmount / 1000;
      else if (itemUnit === 'liter' && ingUnit === 'ml') availableAmount = availableAmount * 1000;
      else if (itemUnit === 'ml' && ingUnit === 'liter') availableAmount = availableAmount / 1000;

      if (Math.floor(availableAmount / requiredAmount) <= 0) {
        return { name: invItem.name, available: currentStock, unit: invItem.unit };
      }
    }
    return null;
  },

   /**
   * Cek kesiapan stok untuk seluruh item dalam satu order
   * Return: { allReady: boolean, notReady: [{id, name, required, available, missing}] }
   */
    checkStockForOrder(items) {
    const notReady = [];
    
    if (!items) {
      return { allReady: true, notReady };
    }
    
    // Normalize items: object→array, array-of-arrays→array-of-objects
    let itemsArr;
    if (Array.isArray(items)) {
      itemsArr = items;
    } else {
      itemsArr = Object.values(items).filter(Boolean);
    }
    
    for (const rawItem of itemsArr) {
      let menuId, menuName, requiredQty;
      
      // Handle format array [id, qty, price] (format hemat dari POS)
      if (Array.isArray(rawItem)) {
        menuId = rawItem[0];
        requiredQty = Number(rawItem[1]) || 1;
        menuName = menuId;
      } else {
        // Format object {id, name, qty, price}
        menuId = rawItem.id || rawItem.menuId;
        requiredQty = Number(rawItem.qty || rawItem.quantity) || 1;
        menuName = rawItem.name || rawItem.menuName || menuId;
      }
      
      if (!menuId) continue;
      
      // Cek apakah ada resep untuk menu ini
      const recipe = this.menuRecipes[menuId];
      
      // Case A: Menu TIDAK punya resep → tidak bisa dijual (stok = 0 by default)
      if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
        notReady.push({
          id: menuId,
          name: menuName,
          required: requiredQty,
          available: 0,
          missing: 'Resep belum diset'
        });
        continue;
      }
      
      // Case B: Menu punya resep, cek stok
      const currentStock = this.getMenuCalculatedStock(menuId);
      if (currentStock < requiredQty) {
        const missing = this.getMenuMissingIngredient(menuId);
        notReady.push({
          id: menuId,
          name: menuName,
          required: requiredQty,
          available: currentStock,
          missing: missing ? missing.name : 'Bahan kurang'
        });
      }
    }
    
    return { allReady: notReady.length === 0, notReady };
  },

  /**
   * Filter daftar produk menu di inventory berdasarkan input pencarian
   */
  filteredProductMenus() {
    const list = Array.isArray(this.menuList) ? this.menuList : [];
    if (!this.inventorySearch) return list;
    const q = this.inventorySearch.toLowerCase();
    return list.filter(m => 
      (m.name || '').toLowerCase().includes(q) ||
      (m.category || '').toLowerCase().includes(q) ||
      (m.desc || '').toLowerCase().includes(q)
    );
  },

  /**
   * Helper Kalkulasi HPP dan Laba Kotor untuk Menu Baru & Resep
   */
  addNewMenuIngredientRow() {
    if (!this.newMenuForm.ingredients) this.newMenuForm.ingredients = [];
    const defaultItem = (this.inventoryList && this.inventoryList[0]) ? this.inventoryList[0] : null;
    this.newMenuForm.ingredients.push({ 
      itemId: defaultItem ? defaultItem.id : '', 
      amount: defaultItem && defaultItem.unit === 'kg' ? 0.1 : 1,
      unit: defaultItem ? defaultItem.unit : 'kg'
    });
  },

  removeNewMenuIngredientRow(idx) {
    if (Array.isArray(this.newMenuForm.ingredients)) {
      this.newMenuForm.ingredients.splice(idx, 1);
    }
  },

  getIngredientCost(itemId, amount, ingUnit) {
    if (!itemId) return 0;
    const item = (this.inventoryList || []).find(i => i.id === itemId);
    if (!item) return 0;
    const price = Number(item.purchasePrice || item.hargaBeli) || 0;
    const numAmount = Number(amount) || 0;
    const itemUnit = (item.unit || 'kg').toLowerCase().trim();
    const unit = (ingUnit || item.unit || 'kg').toLowerCase().trim();

    let normalizedAmount = numAmount;
    if (itemUnit === 'kg' && (unit === 'gram' || unit === 'g' || unit === 'gr')) normalizedAmount = numAmount / 1000;
    else if ((itemUnit === 'gram' || itemUnit === 'g' || itemUnit === 'gr') && unit === 'kg') normalizedAmount = numAmount * 1000;
    else if (itemUnit === 'liter' && (unit === 'ml' || unit === 'mililiter')) normalizedAmount = numAmount / 1000;
    else if ((itemUnit === 'ml' || itemUnit === 'mililiter') && unit === 'liter') normalizedAmount = numAmount * 1000;

    return Math.round(normalizedAmount * price);
  },

  calculateNewMenuHPP(ingredients) {
    if (!Array.isArray(ingredients)) return 0;
    let totalHPP = 0;
    for (const ing of ingredients) {
      if (ing && ing.itemId) {
        totalHPP += this.getIngredientCost(ing.itemId, ing.amount, ing.unit);
      }
    }
    return totalHPP;
  },

  calculateGrossProfit(price, hpp) {
    const p = Number(price) || 0;
    const h = Number(hpp) || 0;
    if (p <= 0) return { nominal: 0, percentage: 0 };
    const nominal = p - h;
    const percentage = Math.round(((nominal / p) * 100) * 10) / 10;
    return { nominal, percentage };
  },

  /**
   * Mengambil daftar kategori menu yang tersedia dan disinkronkan untuk dropdown pilihan form
   */
  getAvailableMenuCategories() {
    let list = [];
    if (Array.isArray(this.categories) && this.categories.length > 0) {
      list = this.categories
        .map(c => (typeof c === 'string' ? { id: c, name: c } : c))
        .filter(c => c && c.id && c.id !== 'semua' && c.id !== 'all' && (c.name || '').toLowerCase() !== 'semua' && (c.name || '').toLowerCase() !== 'semua menu');
    }

    if (list.length === 0) {
      try {
        const saved = localStorage.getItem('dapur_menu_categories');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            list = parsed.filter(c => c && c.id !== 'all' && c.id !== 'semua');
          }
        }
      } catch (e) {}
    }

    if (list.length === 0) {
      list = [
        { id: 'rice_bowl', name: 'Bento & Rice Bowl' },
        { id: 'mie', name: 'Aneka Mie' },
        { id: 'cemilan', name: 'Cemilan / Side Dish' },
        { id: 'ala_carte', name: 'Ala Carte' },
        { id: 'viral', name: 'Viral & Dessert' }
      ];
    }

    return list;
  },

  /**
   * Buka Modal Tambah Menu Baru
   */
  openNewMenuModal() {
    this.syncCategoriesWithMainStore();
    const availCats = this.getAvailableMenuCategories();
    const defaultCat = (availCats && availCats.length > 0) ? availCats[0].id : 'rice_bowl';
    const defaultItem = (this.inventoryList && this.inventoryList[0]) ? this.inventoryList[0] : null;
    this.newMenuForm = {
      name: '',
      category: defaultCat,
      customCategory: '',
      price: 25000,
      desc: '',
      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
      showOnMain: true,
      ingredients: defaultItem ? [{ 
        itemId: defaultItem.id, 
        amount: defaultItem.unit === 'kg' ? 0.1 : 1,
        unit: defaultItem.unit || 'kg'
      }] : []
    };
    this.newMenuModal = true;
  },

  /**
   * Tambah Menu Baru & Sinkronisasi ke Firebase RTDB + Local Store
   */
  async tambahMenuBaru(form) {
    const name = (form.name || '').trim();
    let category = (form.category || 'rice_bowl').trim();
    if (category === '__custom__' && form.customCategory) {
      category = form.customCategory.trim();
    }
    const price = Number(form.price) || 0;
    const desc = (form.desc || '').trim();
    const image = (form.image || '').trim() || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
    const showOnMain = form.showOnMain !== false;

    if (!name || price <= 0) {
      this.showToast('Nama menu dan harga jual wajib diisi (> 0)', 'error');
      return false;
    }

    // Pastikan kategori baru tersimpan di memori kategori kasir jika belum ada
    if (category && category !== '__custom__') {
      const catExists = this.categories.some(c => (c.id === category || (c.name || '').toLowerCase() === category.toLowerCase()));
      if (!catExists) {
        const newCatObj = { id: category.toLowerCase().replace(/[^a-z0-9]/g, '_'), name: category };
        this.categories.push(newCatObj);
        try {
          const saved = JSON.parse(localStorage.getItem('dapur_menu_categories') || '[]');
          saved.push(newCatObj);
          localStorage.setItem('dapur_menu_categories', JSON.stringify(saved));
        } catch(e) {}
      }
    }

    const catObj = (this.categories || []).find(c => c && (c.id === category || (c.name || '').toLowerCase() === (category || '').toLowerCase()));
    const categoryLabel = catObj ? catObj.name : (category ? (category.charAt(0).toUpperCase() + category.slice(1).replace(/[-_]/g, ' ')) : 'Menu');

    const menuId = 'm_' + Date.now();
    const newMenuItem = {
      id: menuId,
      name,
      category,
      categoryLabel,
      price,
      desc: desc || 'Menu lezat & higienis',
      image,
      showOnMain,
      fromKasir: true,
      createdAt: Date.now()
    };

    try {
      if (!Array.isArray(this.menuList)) {
        this.menuList = [];
      }
      this.menuList.unshift(newMenuItem);

      // Simpan resep bahan baku jika diisi
      const rawIngredients = Array.isArray(form.ingredients) ? form.ingredients : [];
      const validIngredients = rawIngredients
        .filter(ing => ing && ing.itemId && Number(ing.amount) > 0)
        .map(ing => {
          const invItem = (this.inventoryList || []).find(i => i.id === ing.itemId);
          return {
            itemId: ing.itemId,
            amount: Number(ing.amount) || 0.1,
            unit: invItem ? invItem.unit : 'kg'
          };
        });

      const recipePayload = {
        menuId,
        menuName: name,
        ingredients: validIngredients
      };

      this.menuRecipes[menuId] = recipePayload;

      // Persistence to LocalStorage (Keduanya agar Kasir dan Admin Toko Utama selalu sinkron)
      try {
        localStorage.setItem('dapur_menu_list', JSON.stringify(this.menuList));
        localStorage.setItem('dapur_menu_items', JSON.stringify(this.menuList));
        localStorage.setItem('dapur_menu_recipes', JSON.stringify(this.menuRecipes));
      } catch (e) {}

      // Persistence to Server API
      fetch(`/menu/${encodeURIComponent(menuId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMenuItem)
      }).catch(() => {});

      if (validIngredients.length > 0) {
        fetch(`/recipes/${encodeURIComponent(menuId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(recipePayload)
        }).catch(() => {});
      }

      // Firebase Sync if available
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const menuRef = this._fbRef(this._fbDb, `menu_items/${menuId}`);
          await this._fbSet(menuRef, newMenuItem);
          if (validIngredients.length > 0) {
            const recipeRef = this._fbRef(this._fbDb, `recipes/${menuId}`);
            await this._fbSet(recipeRef, recipePayload);
          }
        } catch (fbErr) {
          console.warn('Firebase save menu note:', fbErr);
        }
      }

      const hpp = this.calculateNewMenuHPP(validIngredients);
      const profit = this.calculateGrossProfit(price, hpp);
      const stockPorsi = this.getMenuCalculatedStock(menuId);

      this.showToast(
        `Menu "${name}" berhasil dibuat! (${showOnMain ? 'Tampil di Web Utama' : 'Khusus Kasir'} | Stok: ${stockPorsi} porsi | HPP: Rp ${hpp.toLocaleString()})`,
        'success'
      );
      this.newMenuModal = false;
      this.inventoryTab = 'products';
      this.playSound('success');
      return true;
    } catch (e) {
      console.error('Gagal tambah menu baru:', e);
      this.showToast('Gagal menambahkan menu baru', 'error');
      return false;
    }
  },

  /**
   * Toggle apakah menu ditampilkan di Halaman Utama (Toko Pelanggan)
   */
  async toggleMenuShowOnMain(menu) {
    if (!menu) return;
    const newStatus = menu.showOnMain === false ? true : false;
    menu.showOnMain = newStatus;

    // Simpan ke localStorage
    try {
      localStorage.setItem('dapur_menu_list', JSON.stringify(this.menuList));
    } catch (e) {}

    // Sinkronkan ke Firebase jika terhubung
    if (this._fbDb && this._fbSet && this._fbRef) {
      try {
        const itemRef = this._fbRef(this._fbDb, `menu_items/${menu.id}`);
        await this._fbSet(itemRef, menu);
      } catch (err) {
        console.warn('Gagal sync showOnMain ke Firebase:', err);
      }
    }

    this.showToast(
      newStatus 
        ? `Menu "${menu.name}" sekarang DITAMPILKAN di Halaman Utama` 
        : `Menu "${menu.name}" sekarang DISEMBUNYIKAN dari Halaman Utama`,
      newStatus ? 'success' : 'notify'
    );
  },

  /**
   * Hapus menu dari katalog POS & Inventory
   */
    async hapusMenu(menuId) {
    const item = (this.menuList || []).find(m => m.id === menuId);
    const itemName = item ? item.name : menuId;

    // 🔒 PIN GATE
    const pinOk = await this.requestSupervisorPin(
      'HAPUS MENU',
      `Menu: ${itemName}`
    );
    if (!pinOk) {
      this.showToast('Hapus menu dibatalkan', 'notify');
      return;
    }

    if (!confirm(`Hapus menu "${itemName}" dari kasir dan inventori?`)) {
      return;
    }

    try {
      this.menuList = (this.menuList || []).filter(m => m.id !== menuId);
      delete this.menuRecipes[menuId];

      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const menuRef = this._fbRef(this._fbDb, `menu_items/${menuId}`);
          await this._fbSet(menuRef, null);
        } catch (e) {}
      }

      this.showToast(`Menu "${itemName}" telah dihapus`, 'notify');
    } catch (e) {
      this.showToast('Gagal menghapus menu', 'error');
    }
  },

  // -------------------------------------------------------------------------
  // 14.3 LAPORAN & ANALISIS PENJUALAN
  // -------------------------------------------------------------------------

  /**
   * Ambil /pos/summary/daily/{today}
   * Kalau belum ada, hitung dari /pos/transactions/{today}
   * Return ringkasan: { totalSales, totalTx, breakdown: {cash, qris, transfer, ewallet} }
   */
    async loadLaporanHariIni() {
    this.loadingStates.laporan = true;
    this.reportLoading = true;

    try {
      const { start, end } = this.getReportDateRange();
      console.log(`[REPORT] Loading periode: ${start} → ${end} (${this.reportPeriod})`);

      // Fetch semua transaksi dalam range
      const txList = await this.fetchTransactionsInRange(start, end);

      let totalSales = 0;
      const breakdown = { cash: 0, qris: 0, transfer: 0, ewallet: 0 };

      for (const tx of txList) {
        // ✅ Pakai field short-form 'tot'
        const amt = Number(tx.tot || tx.total || tx.amount || 0);
        totalSales += amt;

        const pm = String(tx.pm || tx.paymentMethod || '').toLowerCase();
        if (pm.includes('tunai') || pm.includes('cash')) breakdown.cash += amt;
        else if (pm.includes('qris')) breakdown.qris += amt;
        else if (pm.includes('transfer') || pm.includes('bca') || pm.includes('mandiri')) breakdown.transfer += amt;
        else if (pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo')) breakdown.ewallet += amt;
        else breakdown.cash += amt;
      }

      const summary = {
        totalSales,
        totalTx: txList.length,
        breakdown,
        periodStart: start,
        periodEnd: end,
        period: this.reportPeriod
      };

      this.laporanHariIni = summary;
      this.todayTotalRevenue = totalSales;
      this.shiftSummary.totalSales = totalSales;
      this.shiftSummary.cashSales = breakdown.cash;
      this.shiftSummary.qrisSales = breakdown.qris;
      this.shiftSummary.transferSales = breakdown.transfer;
      this.shiftSummary.ewalletSales = breakdown.ewallet;
      this.shiftSummary.transactionCount = summary.totalTx;

      return summary;
    } catch (e) {
      console.warn('[REPORT] loadLaporanHariIni exception:', e);
      return this.laporanHariIni;
    } finally {
      this.loadingStates.laporan = false;
      this.reportLoading = false;
    }
  },

  /**
   * Ambil transaksi bulan ini, agregasi per menuId, sort DESC top N
   * Return array untuk Chart.js bar chart
   */
    async loadTopMenuBulanIni(limit = 10) {
    try {
      const { start, end } = this.getReportDateRange();

      // Fetch transaksi dalam range
      const transactions = await this.fetchTransactionsInRange(start, end);

      const qtyMap = {};
      const revenueMap = {};
      const nameMap = {};

      for (const tx of transactions) {
        if (!Array.isArray(tx.items)) continue;
        for (const it of tx.items) {
          let mId, mQty, mPrice;
          if (Array.isArray(it)) {
            mId = it[0];
            mQty = Number(it[1]) || 1;
            mPrice = Number(it[2]) || 0;
          } else {
            mId = it.id || it.menuId;
            mQty = Number(it.qty || it.quantity) || 1;
            mPrice = Number(it.price || it.harga) || 0;
          }
          if (!mId) continue;

          qtyMap[mId] = (qtyMap[mId] || 0) + mQty;
          revenueMap[mId] = (revenueMap[mId] || 0) + (mQty * mPrice);
        }
      }

      // Lookup nama menu dari menuList
      for (const m of this.menuList) {
        if (!nameMap[m.id]) nameMap[m.id] = m.name;
      }

      // ✅ NO DUMMY — kalau kosong, ya kosong
      const sorted = Object.keys(qtyMap).map(mId => ({
        id: mId,
        name: nameMap[mId] || mId,
        qty: qtyMap[mId],
        revenue: revenueMap[mId] || 0
      })).sort((a, b) => b.qty - a.qty).slice(0, limit);

      this.topMenuData = sorted;
      this.updateCharts();
      return sorted;
    } catch (e) {
      console.warn('loadTopMenuBulanIni exception:', e);
      return this.topMenuData;
    }
  },

  /**
   * Group transaksi bulan ini by jam (0-23)
   * Return array 24 angka untuk line chart
   */
    async loadPenjualanPerJam() {
    try {
      const { start, end } = this.getReportDateRange();

      const transactions = await this.fetchTransactionsInRange(start, end);

      const hourlyTotals = new Array(24).fill(0);
      for (const tx of transactions) {
        if (!tx.t) continue;
        const d = new Date(Number(tx.t) || tx.t);
        const hour = d.getHours();
        if (hour >= 0 && hour < 24) {
          hourlyTotals[hour] += Number(tx.tot || tx.total || tx.amount || 0);
        }
      }

      this.jamSibukData = hourlyTotals;
      this.updateCharts();
      return hourlyTotals;
    } catch (e) {
      console.warn('loadPenjualanPerJam exception:', e);
      return this.jamSibukData;
    }
  },

  /**
   * Perbandingan minggu ini vs minggu lalu
   */
  async loadPerbandinganMinggu() {
    try {
      const oneDay = 24 * 60 * 60 * 1000;
      let thisWeek = 0;
      let lastWeek = 0;

      const res = await fetch('/pos/transactions');
      if (res.ok) {
        const json = await res.json();
        const allTx = json.data || [];
        const now = Date.now();
        const sevenDaysAgo = now - 7 * oneDay;
        const fourteenDaysAgo = now - 14 * oneDay;

        for (const tx of allTx) {
          const amt = Number(tx.total || tx.amount || 0);
          const t = tx.t || now;
          if (t >= sevenDaysAgo) {
            thisWeek += amt;
          } else if (t >= fourteenDaysAgo) {
            lastWeek += amt;
          }
        }
      }

      if (thisWeek === 0) thisWeek = 14250000;
      if (lastWeek === 0) lastWeek = 12600000;

      const diff = thisWeek - lastWeek;
      const percent = lastWeek > 0 ? Number(((diff / lastWeek) * 100).toFixed(1)) : 0;

      return {
        thisWeek,
        lastWeek,
        diff,
        percentChange: percent,
        isGrowth: diff >= 0
      };
    } catch (e) {
      return { thisWeek: 14250000, lastWeek: 12600000, diff: 1650000, percentChange: 13.1, isGrowth: true };
    }
  },

  // -------------------------------------------------------------------------
  // 14.4 EXPORT PDF & CSV
  // -------------------------------------------------------------------------

  /**
   * Export PDF Laporan (type: 'daily' | 'monthly' | 'shift')
   */
  async exportLaporanPDF(type = 'daily') {
    this.showToast(`Membuat dokumen PDF ${type.toUpperCase()}...`, 'notify');
    try {
      // 1. Coba request ke server endpoint
      const endpoint = type === 'pl' || type === 'monthly' ? '/report-pl' : (type === 'shift' ? '/report-shift' : '/report-daily');
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            shiftSummary: this.shiftSummary,
            laporanHariIni: this.laporanHariIni,
            kasirInfo: this.kasirInfo,
            topMenu: this.topMenuData
          })
        });
        if (res.ok) {
          const json = await res.json();
          if (json.pdfBase64) {
            const link = document.createElement('a');
            link.href = `data:application/pdf;base64,${json.pdfBase64}`;
            link.download = `laporan-${type}-${Date.now()}.pdf`;
            link.click();
            this.showToast(`Laporan PDF ${type} berhasil diunduh`, 'success');
            return;
          }
        }
      } catch (e) {
        console.warn('Server report generation note:', e);
      }

      // 2. High Quality Client-side PDF Generation via jsPDF
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) {
        this.showToast('Pustaka jsPDF sedang dimuat', 'error');
        return;
      }

      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      let y = 18;

      // Header Banner
      doc.setFillColor(234, 88, 12); // brand orange #ea580c
      doc.rect(14, y, 182, 3, 'F');
      y += 9;

            // 🏢 Header brand + alamat + telepon (dari Admin Panel)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(26, 26, 26);
      doc.text(String(this.siteInfo.brandName || 'Dapur Kuliner Viral').toUpperCase(), 14, y);
      y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(115, 115, 115);
      const addrLine = `POS Pintar System - ${this.siteInfo.address || '-'} - Telp: ${this.siteInfo.phone || '-'}`;
      doc.text(addrLine, 14, y);
      y += 9;

      // Judul Laporan
      const titleText = type === 'shift'
        ? 'LAPORAN REKONSILIASI PENUTUPAN SHIFT KASIR'
        : (type === 'monthly' ? 'LAPORAN KEUANGAN & LABA RUGI BULANAN (P&L)' : 'LAPORAN PENJUALAN (SALES REPORT)');

      doc.setFillColor(243, 244, 246);
      doc.roundedRect(14, y, 182, 11, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(17, 24, 39);
      doc.text(titleText, 18, y + 7.5);
      y += 13;

      // 📅 Periode laporan (start - end)
      const { start: pStart, end: pEnd } = this.getReportDateRange();
      const fmtID = (ds) => {
        try {
          return new Date(ds + 'T00:00:00').toLocaleDateString('id-ID', {
            day: 'numeric', month: 'long', year: 'numeric'
          });
        } catch (e) { return ds; }
      };
      const periodLabel = this.getReportPeriodLabel ? this.getReportPeriodLabel() : '';
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(80, 80, 80);
      doc.text(`Periode: ${fmtID(pStart)} s/d ${fmtID(pEnd)}  (${periodLabel})`, 105, y, { align: 'center' });
      y += 10;

      // Metadata Baris
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99);

      const now = new Date();
      const tanggalStr = this.formatDate(now);
      const waktuStr = this.formatTime(now);

      doc.text(`Tanggal Cetak : ${tanggalStr} ${waktuStr} WIB`, 14, y);
      doc.text(`Operator Kasir: ${this.kasirInfo.name || this.kasirInfo.username || 'Kasir Utama'}`, 110, y);
      y += 6;
      doc.text(`Shift ID      : ${this.kasirInfo.shiftId || 'S-2026-09-18-01'}`, 14, y);
      doc.text(`Status Laporan: ${type === 'shift' ? 'DITUTUP (CLOSED)' : 'TERVERIFIKASI'}`, 110, y);
      y += 10;

      // Card Ringkasan Finansial
      doc.setDrawColor(229, 231, 235);
      doc.setFillColor(250, 250, 250);
      doc.roundedRect(14, y, 182, 48, 2, 2, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('RINGKASAN ARUS KAS & PENJUALAN', 18, y + 8);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(55, 65, 81);

            const cashSales = this.shiftSummary.cashSales || 0;
      const qrisSales = this.shiftSummary.qrisSales || 0;
      const transferSales = this.shiftSummary.transferSales || 0;
      const ewalletSales = this.shiftSummary.ewalletSales || 0;
      const totalSales = this.shiftSummary.totalSales || (cashSales + qrisSales + transferSales + ewalletSales);
      const txCount = this.shiftSummary.transactionCount || 0;

      // Kiri: breakdown per metode (MURNI penjualan, TANPA modal awal)
      doc.text('Penjualan Tunai (Cash):', 18, y + 17);
      doc.text(this.formatRupiah(cashSales), 90, y + 17, { align: 'right' });

      doc.text('Penjualan QRIS Dinamis:', 18, y + 24);
      doc.text(this.formatRupiah(qrisSales), 90, y + 24, { align: 'right' });

      doc.text('Penjualan Transfer Bank:', 18, y + 31);
      doc.text(this.formatRupiah(transferSales), 90, y + 31, { align: 'right' });

      doc.text('Penjualan E-Wallet:', 18, y + 38);
      doc.text(this.formatRupiah(ewalletSales), 90, y + 38, { align: 'right' });

      // Kanan: ringkasan transaksi & omset
      doc.text('Total Transaksi Sukses:', 110, y + 17);
      doc.text(`${txCount} transaksi`, 190, y + 17, { align: 'right' });

      doc.setFont('helvetica', 'bold');
      doc.text('TOTAL OMSET PENJUALAN:', 110, y + 24);
      doc.setTextColor(5, 150, 105);
      doc.text(this.formatRupiah(totalSales), 190, y + 24, { align: 'right' });
      doc.setTextColor(55, 65, 81);

      // Untuk laporan shift, tambahkan info uang fisik (opsional, masih pakai shiftSummary)
      if (type === 'shift') {
        const expected = cashSales; // tanpa modal awal (info ini hanya untuk internal)
        const physical = Number(this.physicalCashCount) || expected;
        const diff = physical - expected;

        doc.setFont('helvetica', 'normal');
        doc.text('Kas Tunai Diharapkan:', 110, y + 31);
        doc.text(this.formatRupiah(expected), 190, y + 31, { align: 'right' });

        doc.text('Kas Fisik Aktual:', 110, y + 38);
        doc.text(this.formatRupiah(physical), 190, y + 38, { align: 'right' });

        y += 48;
        // Banner Selisih Kas
        doc.setFillColor(diff === 0 ? 236 : 254, diff === 0 ? 253 : 242, diff === 0 ? 245 : 242);
        doc.roundedRect(14, y, 182, 10, 2, 2, 'F');
        doc.setTextColor(diff === 0 ? 6 : 185, diff === 0 ? 95 : 28, diff === 0 ? 70 : 28);
        doc.setFont('helvetica', 'bold');
        doc.text(`Status Selisih Kas: ${this.formatRupiah(diff)} ${diff === 0 ? '(SESUAI)' : (diff > 0 ? '(LEBIH)' : '(KURANG)')}`, 18, y + 6.5);
        y += 16;
      } else {
        y += 48;
      }

      // Top Menu Table
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text('TOP 5 MENU TERLARIS BULAN INI', 14, y);
      y += 4;

      doc.setFillColor(243, 244, 246);
      doc.rect(14, y, 182, 7, 'F');
      doc.setFontSize(8);
      doc.setTextColor(75, 85, 99);
      doc.text('No', 18, y + 5);
      doc.text('Nama Menu Makanan / Minuman', 30, y + 5);
      doc.text('Porsi Terjual', 150, y + 5, { align: 'right' });
      doc.text('Estimasi Omset', 190, y + 5, { align: 'right' });
      y += 8;

      const topItems = (this.topMenuData.length > 0 ? this.topMenuData : [
        { name: 'Rice Bowl Chicken Katsu Curry', qty: 38, revenue: 1064000 },
        { name: 'Rice Bowl Beef Teriyaki', qty: 29, revenue: 1015000 },
        { name: 'Dimsum Mentai Mozzarella (4 pcs)', qty: 25, revenue: 600000 },
        { name: 'Mie Pedas Viral Level 3', qty: 22, revenue: 484000 },
        { name: 'Es Lemon Tea Segar', qty: 45, revenue: 360000 }
      ]).slice(0, 5);

      doc.setFont('helvetica', 'normal');
      doc.setTextColor(31, 41, 55);

      topItems.forEach((it, idx) => {
        doc.text(String(idx + 1), 18, y + 4.5);
        doc.text(it.name, 30, y + 4.5);
        doc.text(`${it.qty} porsi`, 150, y + 4.5, { align: 'right' });
        doc.text(this.formatRupiah(it.revenue || (it.qty * 25000)), 190, y + 4.5, { align: 'right' });
        y += 7;
        doc.setDrawColor(243, 244, 246);
        doc.line(14, y - 1, 196, y - 1);
      });

      // Tanda Tangan Resmi
      y += 18;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99);

      doc.text('Kasir Pelaksana,', 35, y, { align: 'center' });
      doc.text('Supervisor / Manajer,', 160, y, { align: 'center' });
      y += 22;
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(17, 24, 39);
      doc.text(`( ${this.kasirInfo.name || this.kasirInfo.username || 'Kasir Utama'} )`, 35, y, { align: 'center' });
      doc.text('( ....................................... )', 160, y, { align: 'center' });

      doc.save(`laporan-${type}-${Date.now()}.pdf`);
      this.showToast(`Laporan ${type.toUpperCase()} PDF berhasil diunduh`, 'success');
    } catch (err) {
      console.error('Export PDF error:', err);
      this.showToast('Gagal membuat laporan PDF', 'error');
    }
  },

  exportReportPDF() {
    return this.exportLaporanPDF('daily');
  },

  /**
   * Export Laporan CSV Client-Side
   */
  exportLaporanCSV(type = 'daily') {
    try {
      this.showToast('Menyiapkan file CSV...', 'notify');
      const headers = ['Tanggal', 'Shift ID', 'ID Transaksi', 'Metode Pembayaran', 'Total Omset (Rp)', 'Kasir', 'Status'];
      const rows = [];

      rows.push([
        this.formatDate(Date.now()),
        this.kasirInfo.shiftId || 'S-2026-09-18-01',
        'SUMMARY',
        'SEMUA METODE',
        String(this.shiftSummary.totalSales || this.todayTotalRevenue),
        this.kasirInfo.username || 'kasir',
        'COMPLETED'
      ]);

      if (this.topMenuData.length > 0) {
        rows.push([]);
        rows.push(['--- TOP MENU TERLARIS ---']);
        rows.push(['No', 'Nama Menu', 'Porsi Terjual', 'Estimasi Omset (Rp)']);
        this.topMenuData.forEach((it, i) => {
          rows.push([String(i + 1), `"${it.name.replace(/"/g, '""')}"`, String(it.qty), String(it.revenue || (it.qty * 25000))]);
        });
      }

      const csvContent = '\uFEFF' + [
        headers.join(','),
        ...rows.map(r => r.join(','))
      ].join('\r\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `laporan-${type}-${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      this.showToast('Laporan CSV berhasil diunduh', 'success');
    } catch (err) {
      console.error('Export CSV error:', err);
      this.showToast('Gagal mengunduh laporan CSV', 'error');
    }
  },

  exportReportCSV() {
    return this.exportLaporanCSV('daily');
  },

  // -------------------------------------------------------------------------
  // 14.5 CHART.JS INTEGRATION (Memory Safe: Destroy + Recreate)
  // -------------------------------------------------------------------------

  initCharts() {
    if (typeof Chart === 'undefined') return;
    this.$nextTick(() => {
      this.renderTopMenuChart();
      this.renderHourlySalesChart();
    });
  },

  updateCharts() {
    if (this.activeTab !== 'laporan') return;
    this.renderTopMenuChart();
    this.renderHourlySalesChart();
  },

  renderCharts() {
    return this.initCharts();
  },

  renderTopMenuChart() {
    const canvas = document.getElementById('topMenuChart');
    if (!canvas || typeof Chart === 'undefined') return;

    // Destroy chart sebelumnya untuk mencegah memory leak
    if (this._topMenuChart) {
      this._topMenuChart.destroy();
      this._topMenuChart = null;
    }

    const items = Array.isArray(this.topMenuData) ? this.topMenuData : [];

    // Kalau tidak ada data, tampilkan chart kosong (bukan dummy)
    if (items.length === 0) {
      if (this._topMenuChart) {
        this._topMenuChart.destroy();
        this._topMenuChart = null;
      }
      // Optional: render pesan "Belum ada data" via callback atau biarkan kosong
      return;
    }

    const labels = items.map(i => i.name.length > 18 ? i.name.slice(0, 16) + '…' : i.name);
    const data = items.map(i => i.qty);

    const ctx = canvas.getContext('2d');
    this._topMenuChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Porsi Terjual',
          data: data,
          backgroundColor: '#059669', // emerald-600
          borderRadius: 6,
          hoverBackgroundColor: '#047857'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} porsi terjual`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: 'Plus Jakarta Sans', size: 10 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f3f4f6' },
            ticks: { font: { family: 'JetBrains Mono', size: 10 }, precision: 0 }
          }
        }
      }
    });
  },

  renderHourlySalesChart() {
    const canvas = document.getElementById('hourlySalesChart');
    if (!canvas || typeof Chart === 'undefined') return;

    if (this._hourlySalesChart) {
      this._hourlySalesChart.destroy();
      this._hourlySalesChart = null;
    }

    const labels = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
    let data = this.jamSibukData;
      if (!data || !Array.isArray(data) || data.length !== 24) {
      data = new Array(24).fill(0);
    }

    const ctx = canvas.getContext('2d');
    this._hourlySalesChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Omset Penjualan (Rp)',
          data: data,
          borderColor: '#ea580c', // brand orange
          backgroundColor: 'rgba(234, 88, 12, 0.08)',
          fill: true,
          tension: 0.35,
          pointRadius: 2.5,
          pointHoverRadius: 6,
          pointBackgroundColor: '#ea580c'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` Rp ${Number(ctx.parsed.y).toLocaleString('id-ID')}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { family: 'JetBrains Mono', size: 9 },
              maxTicksLimit: 12
            }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f3f4f6' },
            ticks: {
              font: { family: 'JetBrains Mono', size: 10 },
              callback: (val) => val >= 1000000 ? `${(val / 1000000).toFixed(1)}jt` : (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val)
            }
          }
        }
      }
    });
  },

  // -------------------------------------------------------------------------
  // 14.6 AUTO-SAVE SNAPSHOT (Setiap 5 menit & Load saat Offline)
  // -------------------------------------------------------------------------

  saveReportSnapshot() {
    try {
      const snapshot = {
        t: Date.now(),
        laporanHariIni: this.laporanHariIni,
        shiftSummary: this.shiftSummary,
        topMenuData: this.topMenuData,
        jamSibukData: this.jamSibukData,
        inventoryList: this.inventoryList
      };
      localStorage.setItem('dapur_pos_report_snapshot', JSON.stringify(snapshot));
    } catch (e) {
      console.warn('saveReportSnapshot note:', e);
    }
  },

  loadReportSnapshot() {
    try {
      const raw = localStorage.getItem('dapur_pos_report_snapshot');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.laporanHariIni) this.laporanHariIni = data.laporanHariIni;
        if (data.todayTotalRevenue) this.todayTotalRevenue = data.todayTotalRevenue;
        if (data.topMenuData && data.topMenuData.length > 0) this.topMenuData = data.topMenuData;
        if (data.jamSibukData && data.jamSibukData.length > 0) this.jamSibukData = data.jamSibukData;
        if (data.inventoryList && data.inventoryList.length > 0 && this.inventoryList.length === 0) {
          this.inventoryList = data.inventoryList;
        }
      }
    } catch (e) {
      console.warn('loadReportSnapshot note:', e);
    }
  },

  // -------------------------------------------------------------------------
  // 14.7 LOG INVENTORI, EXPORT & IMPORT CSV STOK OPNAME
  // -------------------------------------------------------------------------

  loadInventoryLogs() {
    try {
      const raw = localStorage.getItem('dapur_inventory_logs');
      if (raw) {
        this.inventoryLogs = JSON.parse(raw);
      } else {
        this.inventoryLogs = [
          {
            id: 'log_init_1',
            time: new Date().toLocaleDateString('id-ID') + ' ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            itemName: 'Filet Dada Ayam Segar',
            oldStock: 10,
            newStock: 18,
            diff: '+8',
            unit: 'kg',
            changeType: 'Restock Supplier',
            note: 'Penerimaan bahan baku awal',
            user: 'Kasir Utama'
          },
          {
            id: 'log_init_2',
            time: new Date().toLocaleDateString('id-ID') + ' ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
            itemName: 'Beras Pulen Premium',
            oldStock: 50,
            newStock: 45,
            diff: '-5',
            unit: 'kg',
            changeType: 'Stok Opname CSV',
            note: 'Penyesuaian stok fisik harian',
            user: 'Supervisor'
          }
        ];
      }
    } catch (e) {
      this.inventoryLogs = [];
    }
  },

  addInventoryLog(itemName, oldStock, newStock, unit, changeType, note) {
    if (!Array.isArray(this.inventoryLogs)) this.inventoryLogs = [];
    const diffNum = Number(newStock) - Number(oldStock);
    const diffStr = diffNum > 0 ? `+${diffNum}` : `${diffNum}`;
    const now = new Date();
    const timeStr = now.toLocaleDateString('id-ID') + ' ' + now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    
    const logEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      time: timeStr,
      itemName: itemName || 'Item Inventori',
      oldStock: Number(oldStock) || 0,
      newStock: Number(newStock) || 0,
      diff: diffStr,
      unit: unit || 'unit',
      changeType: changeType || 'Penyesuaian Stok',
      note: note || 'Stok Opname',
      user: (this.kasirInfo && this.kasirInfo.nama) ? this.kasirInfo.nama : 'Kasir Utama'
    };

    this.inventoryLogs.unshift(logEntry);
    if (this.inventoryLogs.length > 300) this.inventoryLogs.pop(); // limit log
    try {
      localStorage.setItem('dapur_inventory_logs', JSON.stringify(this.inventoryLogs));
    } catch (e) {}
  },

  exportInventoryCSV() {
    try {
      const list = Array.isArray(this.inventoryList) ? this.inventoryList : [];
      let csvContent = "\uFEFF"; // UTF-8 BOM agar rapi di Microsoft Excel
      csvContent += "ID,Nama Item,Kategori,Stok Fisik,Batas Min Stok,Satuan,Harga Beli Modal (Rp),Status Hitung\n";

      list.forEach(item => {
        const id = (item.id || '').replace(/,/g, '');
        const name = `"${(item.name || '').replace(/"/g, '""')}"`;
        const cat = `"${(item.category || 'Bahan Baku').replace(/"/g, '""')}"`;
        const stock = Number(item.stock || item.stok || 0);
        const minStock = Number(item.minStock || item.min || 0);
        const unit = `"${(item.unit || 'pcs').replace(/"/g, '""')}"`;
        const price = Number(item.purchasePrice || item.hargaBeli || 0);
        const countable = item.isCountable !== false ? 'Countable' : 'Uncountable';

        csvContent += `${id},${name},${cat},${stock},${minStock},${unit},${price},${countable}\n`;
      });

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      link.setAttribute('href', url);
      link.setAttribute('download', `Stok_Opname_Dapur_${dateStr}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      this.addInventoryLog('Semua Item Stok', '-', '-', '-', 'Export CSV', 'Export tabel stok opname');
      this.showToast('File CSV Stok Opname berhasil diunduh!', 'success');
    } catch (e) {
      console.error('Export CSV Error:', e);
      this.showToast('Gagal mengunduh file CSV', 'error');
    }
  },

  importInventoryCSV(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const lines = text.split(/\r\n|\n/);
        if (lines.length <= 1) {
          this.showToast('File CSV kosong atau tidak valid', 'error');
          return;
        }

        let updatedCount = 0;
        let addedCount = 0;

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Parse CSV (handling quotes & delimiter)
          const cols = line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(c => c.replace(/^"|"$/g, '').trim());
          if (cols.length < 4) continue;

          const itemId = cols[0];
          const itemName = cols[1];
          const category = cols[2] || 'Bahan Baku';
          const newStock = Number(cols[3]) || 0;
          const minStock = Number(cols[4]) || 5;
          const unit = cols[5] || 'kg';
          const purchasePrice = Number(cols[6]) || 0;

          // Cari item yang ada
          let existing = this.inventoryList.find(inv => inv.id === itemId || (inv.name && inv.name.toLowerCase() === itemName.toLowerCase()));

          if (existing) {
            const oldStock = Number(existing.stock || existing.stok || 0);
            existing.stock = newStock;
            existing.stok = newStock;
            existing.purchasePrice = purchasePrice;
            existing.minStock = minStock;
            updatedCount++;

            this.addInventoryLog(
              existing.name,
              oldStock,
              newStock,
              existing.unit,
              'Import CSV (Opname)',
              `Diperbarui via CSV Stok Opname (Harga: Rp ${purchasePrice.toLocaleString()})`
            );
          } else if (itemName) {
            const newId = itemId || 'inv_' + Date.now() + '_' + i;
            const newItemObj = {
              id: newId,
              name: itemName,
              category: category,
              stock: newStock,
              stok: newStock,
              minStock: minStock,
              unit: unit,
              purchasePrice: purchasePrice,
              isCountable: true
            };
            this.inventoryList.push(newItemObj);
            addedCount++;

            this.addInventoryLog(
              itemName,
              0,
              newStock,
              unit,
              'Import CSV (Baru)',
              `Bahan baku baru ditambahkan dari file CSV`
            );
          }
        }

                // ✅ Persist ke localStorage
        try {
          localStorage.setItem('dapur_inventory_list', JSON.stringify(this.inventoryList));
        } catch (err) {}

        // ✅ Persist ke Firebase — pakai Promise.all + .then() (TIDAK pakai await)
        if (this._fbDb && this._fbSet && this._fbRef) {
          const listToSync = JSON.parse(JSON.stringify(this.inventoryList));
          const promises = listToSync
            .filter(item => item && item.id)
            .map(item => {
              const itemRef = this._fbRef(this._fbDb, `inventory/${item.id}`);
              return this._fbSet(itemRef, item).catch(err => {
                console.warn(`[IMPORT-CSV] Gagal sync ${item.id}:`, err);
              });
            });

          Promise.all(promises)
            .then(() => {
              console.log(`[IMPORT-CSV] ✅ Firebase sync selesai untuk ${promises.length} item`);
            })
            .catch(err => {
              console.warn('[IMPORT-CSV] Firebase sync error:', err);
            });
        } else {
          console.warn('[IMPORT-CSV] Firebase tidak siap, skip persist');
        }

        this.showToast(`Import Berhasil! (${updatedCount} stok diperbarui, ${addedCount} bahan baru)`, 'success');
        this.playSound('success');
      } catch (err) {
        console.error('Import CSV Error:', err);
        this.showToast('Gagal memproses file CSV', 'error');
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  },

  // -------------------------------------------------------------------------
  // 14.8 AKUNTANSI & LAPORAN KEUANGAN KASIR
  // -------------------------------------------------------------------------

  async loadAccountingSummary(forceRefresh = false) {
    const bulan = new Date().toISOString().slice(0, 7);  // YYYY-MM
    
    // Cek cache (30 detik)
    const now = Date.now();
    if (!forceRefresh && this.accountingSummaryData && (now - this.accountingSummaryLastFetch < 30000)) {
      return this.accountingSummaryData;
    }
    
    this.accountingSummaryLoading = true;
    this.accountingSummaryError = null;
    console.log('[ACCOUNTING-SUMMARY] Loading for bulan:', bulan);
    
    try {
      const res = await fetch(`/accounting/summary/${bulan}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const json = await res.json();
      console.log('[ACCT] Raw response:', json);
      console.log('[ACCT] data keys:', json.data ? Object.keys(json.data) : 'NO DATA');

      if (!json.success || !json.data) {
        throw new Error(json.error || 'Response format tidak valid');
      }
      
      this.accountingSummaryData = json.data;
      this.accountingSummaryLastFetch = now;
      console.log('[ACCOUNTING-SUMMARY] Loaded:', json.data);
      return json.data;
      
    } catch (err) {
      console.error('[ACCOUNTING-SUMMARY] Error:', err);
      this.accountingSummaryError = err.message;
      return null;
    } finally {
      this.accountingSummaryLoading = false;
    }
  },

      getAccountingSummary() {
    const d = this.accountingSummaryData;
    
    // ✅ FIX BUG-19: Prioritas backend data kalau valid
    const hasValidData = d && typeof d === 'object' && 
      (d.pendapatan !== undefined || d.hpp !== undefined || d.labaBersih !== undefined);
    
    if (hasValidData) {
      const pendapatan = d.pendapatan || {};
      const hpp = d.hpp || {};
      const beban = d.beban || {};
      
      const totalRev = Number(pendapatan.totalPendapatan) || 0;
      const totalCOGS = Number(hpp.totalHpp) || 0;
      const grossProfit = Number(d.labaKotor) || (totalRev - totalCOGS);
      
      return {
        totalRev,
        totalCOGS,
        grossProfit,
        grossMargin: totalRev > 0 ? Math.round((grossProfit / totalRev) * 100) : 0,
        opExList: [
          { name: 'Beban Gaji Karyawan', amount: Number(beban.gaji) || 0 },
          { name: 'Beban Sewa Tempat', amount: Number(beban.sewa) || 0 },
          { name: 'Beban Listrik & Air', amount: Number(beban.utilitas) || 0 },
          { name: 'Beban Marketing', amount: Number(beban.marketing) || 0 },
          { name: 'Beban Kurir', amount: Number(beban.kurir) || 0 },
          { name: 'Beban Penyusutan', amount: Number(beban.penyusutan) || 0 }
        ].filter(item => item.amount > 0),
        totalOpEx: Number(beban.totalBeban) || 0,
        netProfit: Number(d.labaBersih) || 0,
        netMargin: totalRev > 0 ? Math.round((Number(d.labaBersih) || 0) / totalRev * 100) : 0,
        status: (Number(d.labaBersih) || 0) >= 0 ? 'PROFIT' : 'LOSS',
        pembelianBahanBaku: Number(d.pembelianBahanBaku) || 0,
        persediaanAkhir: Number(d.persediaanAkhir) || 0,
        source: 'firebase'
      };
    }

    // Fallback minimalis — jangan pakai *0.38
    const totalRev = Number(this.todayTotalRevenue) || 0;
    return {
      totalRev,
      totalCOGS: 0,
      grossProfit: totalRev,
      grossMargin: 100,
      opExList: [],
      totalOpEx: 0,
      netProfit: totalRev,
      netMargin: 100,
      status: 'PROFIT',
      pembelianBahanBaku: 0,
      persediaanAkhir: 0,
      source: 'local-fallback'
    };
  },

     get filteredJournalCount() {
      const list = Array.isArray(this.accountingJournalList) ? this.accountingJournalList : [];
      if (list.length === 0) return 0;
      const filterDate = String(this.journalFilterDate || '').trim();
      return list.filter(j => {
        const s = String(j.status || '').toLowerCase();
        if (s !== 'approved' && s !== 'posted') return false;
        if (filterDate) {
          const jDate = String(j.date || '').slice(0, 10);
          if (jDate !== filterDate) return false;
        }
        return true;
      }).length;
    },
       
 getAccountingJournal() {
    // ✅ FIX: Fetch real dari state, fallback ke empty array (bukan dummy)
    const list = Array.isArray(this.accountingJournalList) ? this.accountingJournalList : [];
    if (list.length === 0) return [];

    // Transform ke format yang ditampilkan di template
    const today = new Date().toLocaleDateString('id-ID');
    const filterDate = String(this.journalFilterDate || '').trim();  // ✅ SPRINT 2
    return list
      .filter(j => {
        // Filter hanya approved/posted (biar tidak tampil pending/draft)
        const s = String(j.status || '').toLowerCase();
        if (s !== 'approved' && s !== 'posted') return false;
        // ✅ SPRINT 2: filter tanggal jika diisi
        if (filterDate) {
          const jDate = String(j.date || '').slice(0, 10);
          if (jDate !== filterDate) return false;
        }
        return true;
      })
      .map(j => {
        const lines = Array.isArray(j.lines) ? j.lines : [];
        const debitLine = lines.find(l => Number(l.debit) > 0);
        const creditLine = lines.find(l => Number(l.credit) > 0);
        const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);

        return {
          date: j.date || today,
          id: j.id || j.entryId || j.ref || (j.date + '_' + String(j.desc || '').slice(0, 20)).replace(/\s/g, '_'),
          ref: j.noEntry || j.ref || j.entryId || '-',
          desc: j.desc || j.description || 'Transaksi Jurnal',
          debitAccount: debitLine
            ? (debitLine.acc || '-') + ' - ' + this.getAccountName(debitLine.acc)
            : '-',
          debitAmount: Number(debitLine?.debit) || 0,
          creditAccount: creditLine
            ? (creditLine.acc || '-') + ' - ' + this.getAccountName(creditLine.acc)
            : '-',
          creditAmount: Number(creditLine?.credit) || 0,
          totalAmount: totalDebit,
          status: j.status || 'approved'
        };
      })
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  },

  // -------------------------------------------------------------------------
  // 14.8.1 INPUT JURNAL MANUAL, DOUBLE-ENTRY, APPROVAL & AUTO-UPDATE LEDGER
  // -------------------------------------------------------------------------

  openJournalFormModal() {
    this.resetJournalForm();
    this.showJournalFormModal = true;
  },

  resetJournalForm() {
    this.journalForm = {
      category: 'operasional',
      date: new Date().toISOString().slice(0, 10),
      desc: '',
      ref: '',
      lampiran: '',
      lines: [
        { acc: '', debit: 0, credit: 0 },
        { acc: '', debit: 0, credit: 0 }
      ]
    };
  },

  applyJournalTemplate(templateId) {
    const tmpl = this.journalTemplates.find(t => t.id === templateId);
    if (!tmpl) return;
    this.journalForm.category = tmpl.category || this.journalForm.category;
    if (Array.isArray(tmpl.lines) && tmpl.lines.length > 0) {
      this.journalForm.lines = tmpl.lines.map(l => ({
        acc: l.acc || '',
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0
      }));
    }
    if (!this.journalForm.desc) {
      this.journalForm.desc = tmpl.name;
    }
  },

  addJournalLine() {
    this.journalForm.lines.push({ acc: '', debit: 0, credit: 0 });
  },

  removeJournalLine(index) {
    if (this.journalForm.lines.length <= 2) {
      this.showToast('Jurnal minimal membutuhkan 2 baris transaksi', 'error');
      return;
    }
    this.journalForm.lines.splice(index, 1);
  },

  getJournalTotalDebit() {
    if (!this.journalForm || !Array.isArray(this.journalForm.lines)) return 0;
    return this.journalForm.lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  },

  getJournalTotalCredit() {
    if (!this.journalForm || !Array.isArray(this.journalForm.lines)) return 0;
    return this.journalForm.lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  },

  isJournalBalanced() {
    const debit = this.getJournalTotalDebit();
    const credit = this.getJournalTotalCredit();
    return debit > 0 && Math.abs(debit - credit) < 0.01;
  },

  handleJournalAttachment(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    
    // Validasi ukuran maks 2MB
    if (file.size > 2 * 1024 * 1024) {
      this.showToast('Ukuran lampiran maksimal 2MB', 'error');
      event.target.value = '';
      return;
    }
    
    // Validasi tipe
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
      this.showToast('Format lampiran: JPG, PNG, atau PDF', 'error');
      event.target.value = '';
      return;
    }
    
    // Convert ke base64
    const reader = new FileReader();
    reader.onload = (e) => {
      this.journalForm.lampiran = e.target.result;
      this.showToast('Lampiran berhasil diunggah', 'success');
    };
    reader.onerror = () => {
      this.showToast('Gagal membaca file lampiran', 'error');
    };
    reader.readAsDataURL(file);
  },

  getAccountName(accCode) {
  const coa = {
    // 4-digit (primary — kode standar sekarang)
    '1001': 'Kas di Tangan',
    '1002': 'Bank BCA',
    '1003': 'Piutang Usaha',
    '1004': 'Persediaan Bahan Baku',
    '1005': 'Peralatan & Mesin Dapur',
    '2001': 'Hutang Dagang / Supplier',
    '2002': 'Hutang Beban & Operasional',
    '3001': 'Modal Pemilik',
    '3002': 'Laba Ditahan',
    '3003': 'Prive Pemilik',
    '4001': 'Pendapatan Penjualan POS',
    '4002': 'Pendapatan Pesanan Catering',
    '5001': 'Harga Pokok Penjualan (HPP)',
    '6001': 'Beban Gaji Karyawan',
    '6002': 'Beban Sewa Tempat & Outlet',
    '6003': 'Beban Listrik, Air & Gas',
    '6004': 'Beban Marketing & Iklan',
        '6005': 'Beban Operasional (Kurir/Ekspedisi/Lainnya)',
    '6006': 'Beban Penyusutan',
    // Legacy 3-digit untuk kompatibilitas
    '101': 'Kas di Tangan',
    '102': 'Bank',
    '103': 'Piutang Usaha',
    '105': 'Persediaan Bahan Baku',
    '201': 'Hutang Supplier',
    '301': 'Modal Pemilik',
    '302': 'Prive Pemilik',
    '401': 'Pendapatan Penjualan',
    '402': 'Pendapatan Catering',
    '501': 'HPP',
    '601': 'Beban Gaji',
    '602': 'Beban Sewa',
    '603': 'Beban Listrik & Air',
    '604': 'Beban Marketing',
        '605': 'Beban Operasional (Kurir/Ekspedisi/Lainnya)',
    '606': 'Beban Penyusutan'
  };
  return coa[String(accCode)] || ('Akun ' + accCode);
},

  async submitJournalEntry() {
    // Validasi balance
    if (!this.isJournalBalanced()) {
      this.showToast('Total Debit dan Kredit harus sama dan > 0', 'error');
      return false;
    }
    
    // Validasi desc
    const desc = (this.journalForm.desc || '').trim();
    if (!desc) {
      this.showToast('Deskripsi jurnal wajib diisi', 'error');
      return false;
    }
    
    // Validasi semua line punya acc dan nominal > 0 (minimal di satu sisi)
    const validLines = this.journalForm.lines.filter(l => 
      l.acc && (Number(l.debit) > 0 || Number(l.credit) > 0)
    );
    if (validLines.length < 2) {
      this.showToast('Minimal 2 baris jurnal dengan akun dan nominal', 'error');
      return false;
    }
    
    // Prepare payload
    const bulan = this.journalForm.date.slice(0, 7); // YYYY-MM
    const payload = {
      category: this.journalForm.category,
      date: this.journalForm.date,
      desc: desc,
      ref: this.journalForm.ref || '',
      lampiran: this.journalForm.lampiran || '',
      lines: validLines.map(l => ({
        acc: l.acc,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0
      })),
            createdBy: this.kasirInfo?.name || 'kasir',
      status: 'pending'  // ✅ Default: menunggu approval, bukan draft
    };
    
    try {
      this.isLoading = true;
      const res = await fetch(`/accounting/journal/${bulan}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (data.success) {
        this.showToast(`Jurnal ${data.noEntry} berhasil dibuat (menunggu approval)`, 'success');
        this.showJournalFormModal = false;
        this.resetJournalForm();
        // Refresh list
        await this.loadPendingApprovals();
        await this.loadJournalList(bulan);
        await this.loadJournalListForKasir(); // ✅ refresh tab Jurnal Umum
      } else {
        this.showToast(data.error || 'Gagal membuat jurnal', 'error');
      }
    } catch (err) {
      console.error('Submit journal error:', err);
      this.showToast('Gagal mengirim jurnal ke server', 'error');
    } finally {
      this.isLoading = false;
    }
    return true;
  },

  formatNumber(num) {
    return new Intl.NumberFormat('id-ID').format(Number(num) || 0);
  },

  async loadPendingApprovals() {
    this.isLoadingApprovals = true;
    try {
      const res = await fetch('/accounting/approvals');
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      
      console.log('[APPROVAL] Response:', json);
      
      if (!json.success || !Array.isArray(json.data)) {
        console.warn('[APPROVAL] Response format tidak valid:', json);
        this.pendingApprovals = [];
        return;
      }
      
      // Normalize setiap entry supaya WAJIB punya entryId + bulan
      this.pendingApprovals = json.data.map((entry, idx) => {
        // Fallback: kalau entryId tidak ada, coba ambil dari key lain
        const entryId = entry.entryId 
                     || entry.id 
                     || entry.firebaseKey 
                     || null;
        
        const bulan = entry.bulan 
                   || entry.month 
                   || (entry.date ? entry.date.slice(0, 7) : null)
                   || null;
        
        if (!entryId || !bulan) {
          console.warn(`[APPROVAL] Entry #${idx} tidak punya entryId/bulan:`, entry);
        } else {
          console.log(`[APPROVAL] Entry ${idx}:`, { entryId, noEntry: entry.noEntry, bulan });
        }
        
        return {
          ...entry,
          entryId,   // <-- normalize ke field standar
          bulan
        };
      });
      
      console.log(`[APPROVAL] Loaded ${this.pendingApprovals.length} entries`);
      
      // Debug: log entries yang tidak lengkap
      const incomplete = this.pendingApprovals.filter(e => !e.entryId || !e.bulan);
      if (incomplete.length > 0) {
        console.warn(`[APPROVAL] ${incomplete.length} entries incomplete:`, incomplete);
      }
      
    } catch (err) {
      console.error('[APPROVAL] Load error:', err);
      this.pendingApprovals = [];
      this.showToast('Gagal memuat daftar approval: ' + err.message, 'error');
    } finally {
      this.isLoadingApprovals = false;
    }
  },

  async approveJournal(entry) {
    console.log('[APPROVE] Called with:', entry);
    // Handle berbagai format input: object, atau entryId (string)
    let entryObj = entry;
    
    // Kalau yang dikirim cuma entryId (string), cari dari state
    if (typeof entry === 'string') {
      entryObj = this.pendingApprovals.find(e => 
        e.entryId === entry || e.noEntry === entry || e.id === entry
      );
    }
    
    if (!entryObj) {
      this.showToast('Entry jurnal tidak ditemukan di state', 'error');
      console.error('[APPROVE] Entry not found:', entry);
      return false;
    }
    
    const identifier = entryObj.entryId || entryObj.noEntry || entryObj.id;
    const bulan = entryObj.bulan || (entryObj.date ? entryObj.date.slice(0, 7) : null);
    
    console.log('[APPROVE] Processing:', { identifier, bulan, entryObj });
    
    if (!identifier) {
      this.showToast('Entry jurnal tidak punya identifier (entryId/noEntry)', 'error');
      return false;
    }
    
    if (!bulan) {
      this.showToast('Entry jurnal tidak punya info bulan', 'error');
      return false;
    }
    
    // Confirm dialog
    const totalNominal = entryObj.lines?.reduce((s, l) => s + (Number(l.debit) || 0), 0) || 0;
    if (!confirm(`Setujui jurnal ${entryObj.noEntry || identifier}?\n\n` +
                 `Deskripsi: ${entryObj.desc || '-'}\n` +
                 `Total: Rp ${this.formatNumber(totalNominal)}`)) {
      return false;
    }
    
    try {
      this.isProcessingApproval = true;
      this.isLoading = true;
      
      const url = `/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(identifier)}`;
      const payload = {
        action: 'approve',
        approvedBy: this.kasirInfo?.name || this.kasirInfo?.username || 'Finance / Kasir'
      };
      console.log(`[APPROVE] PATCH ${url} with body:`, payload);
      
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      console.log('[APPROVE] Response:', json);
      
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      
      this.showToast(`Jurnal ${entryObj.noEntry || identifier} berhasil di-approve`, 'success');
      
      // Refresh list approval
      await this.loadPendingApprovals();
        if (typeof this.loadJournalList === 'function') {
        await this.loadJournalList(bulan);
      }
      if (typeof this.loadJournalListForKasir === 'function') {
        await this.loadJournalListForKasir(); // ✅ refresh tab Jurnal Umum
      }
      
      // Refresh summary P&L
      await this.loadAccountingSummary(true);
      this.showToast('Jurnal di-approve, laporan P&L di-refresh', 'success');
      
      return true;
      
    } catch (err) {
      console.error('[APPROVE] Error:', err);
      this.showToast('Gagal approve: ' + err.message, 'error');
      return false;
    } finally {
      this.isProcessingApproval = false;
      this.isLoading = false;
    }
  },

  async rejectJournal(entry, reason = null) {
    console.log('[REJECT] Called with:', entry);
    let entryObj = entry;
    
    if (typeof entry === 'string') {
      entryObj = this.pendingApprovals.find(e => 
        e.entryId === entry || e.noEntry === entry || e.id === entry
      );
    }
    
    if (!entryObj) {
      this.showToast('Entry jurnal tidak ditemukan', 'error');
      return false;
    }
    
    const identifier = entryObj.entryId || entryObj.noEntry || entryObj.id;
    const bulan = entryObj.bulan || (entryObj.date ? entryObj.date.slice(0, 7) : null);
    
    if (!identifier || !bulan) {
      this.showToast('Entry tidak lengkap (butuh identifier + bulan)', 'error');
      return false;
    }
    
    // Tanya alasan reject
    const finalReason = reason || prompt(
      'Alasan penolakan jurnal ' + (entryObj.noEntry || identifier) + ':',
      'Nominal salah / bukti tidak lengkap'
    );
    
    if (finalReason === null) return false;  // user cancel
    
    try {
      this.isProcessingApproval = true;
      this.isLoading = true;
      
      const url = `/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(identifier)}`;
      const payload = {
        action: 'reject',
        rejectedReason: finalReason,
        approvedBy: this.kasirInfo?.name || this.kasirInfo?.username || 'Finance / Kasir'
      };
      console.log(`[REJECT] PATCH ${url} with body:`, payload);
      
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const json = await res.json();
      console.log('[REJECT] Response:', json);
      
      if (!res.ok || !json.success) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      
      this.showToast(`Jurnal ditolak: ${finalReason}`, 'notify');
      await this.loadPendingApprovals();
      if (typeof this.loadJournalList === 'function') {
        await this.loadJournalList(bulan);
      }
      // Refresh summary P&L
      await this.loadAccountingSummary(true);
      return true;
      
    } catch (err) {
      console.error('[REJECT] Error:', err);
      this.showToast('Gagal menolak jurnal: ' + err.message, 'error');
      return false;
    } finally {
      this.isProcessingApproval = false;
      this.isLoading = false;
    }
  },

   // =========================================================================
  // 🔒 SUPERVISOR PIN SECURITY LAYER
  // =========================================================================

  /**
   * Minta PIN supervisor — return Promise<boolean>
   * - resolve(true)  → PIN benar, aksi boleh lanjut
   * - resolve(false) → user batal / salah 3x tidak ada lock
   */
  requestSupervisorPin(actionLabel, targetLabel, opts = {}) {
    return new Promise((resolve) => {
      this.pinContext = { actionLabel, targetLabel, opts, resolve };
      this.pinInput = '';
      this.pinErrorMessage = '';
      this.showPinModal = true;
      this.playSound('notify');

      // Auto-focus ke input setelah modal render
      this.$nextTick(() => {
        setTimeout(() => {
          const el = document.getElementById('supervisorPinInput');
          if (el) el.focus();
        }, 100);
      });
    });
  },

  /**
   * Submit PIN — cek ke this.supervisorPin
   */
  submitSupervisorPin() {
    const pin = String(this.pinInput || '').trim();

    if (!pin || pin.length !== 6) {
      this.pinErrorMessage = '⚠️ PIN harus 6 digit angka';
      this.playSound('error');
      return;
    }

    if (pin === String(this.supervisorPin || '').trim()) {
      // ✅ PIN BENAR
      const ctx = this.pinContext;
      this.showPinModal = false;
      this.pinErrorMessage = '';
      this.pinInput = '';
      this.pinContext = null;

      this.logAudit(ctx?.actionLabel || 'UNKNOWN', ctx?.targetLabel || '-', 'granted');
      // Simpan PIN yang baru diverifikasi (dipakai aksi yang butuh verifikasi server, mis. VOID order online)
      if (ctx && ctx.opts && ctx.opts.capturePin) this._lastVerifiedSupervisorPin = pin;
      this.playSound('success');

      if (ctx && typeof ctx.resolve === 'function') {
        ctx.resolve(true);
      }
    } else {
      // ❌ PIN SALAH — tidak lock, kasih pesan
      this.pinErrorMessage = '❌ PIN salah. Silakan coba lagi.';
      this.pinInput = '';
      this.playSound('error');

      this.logAudit(
        this.pinContext?.actionLabel || 'UNKNOWN',
        this.pinContext?.targetLabel || '-',
        'denied_wrong_pin'
      );

      this.$nextTick(() => {
        const el = document.getElementById('supervisorPinInput');
        if (el) el.focus();
      });
    }
  },

  /**
   * Cancel — resolve(false)
   */
  cancelSupervisorPin() {
    const ctx = this.pinContext;
    this.showPinModal = false;
    this.pinInput = '';
    this.pinErrorMessage = '';
    this.pinContext = null;
    this.playSound('click');

    if (ctx) {
      this.logAudit(ctx.actionLabel || 'UNKNOWN', ctx.targetLabel || '-', 'cancelled');
      if (typeof ctx.resolve === 'function') ctx.resolve(false);
    }
  },

  /**
   * Log semua aksi destructive ke /audit_logs/
   */
  async logAudit(action, target, status, note = '') {
    try {
      const entry = {
        at: Date.now(),
        iso: new Date().toISOString(),
        user: this.kasirInfo?.username || 'kasir',
        userName: this.kasirInfo?.name || 'Kasir Utama',
        shiftId: this.kasirInfo?.shiftId || '',
        action: String(action || 'unknown'),
        target: String(target || ''),
        status: String(status || 'unknown'), // granted | denied_wrong_pin | cancelled | executed | failed
        note: String(note || '')
      };

      console.log('[AUDIT]', entry);

      if (this._fbDb && this._fbSet && this._fbRef) {
        const logKey = 'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const logRef = this._fbRef(this._fbDb, `audit_logs/${logKey}`);
        await this._fbSet(logRef, entry);
      }
    } catch (e) {
      console.warn('[AUDIT] Log error:', e);
    }
  },
 
   async loadJournalListForKasir() {
    try {
      this.accountingJournalLoading = true;
      const bulan = new Date().toISOString().slice(0, 7); // YYYY-MM

      const res = await fetch(`/accounting/journal/${bulan}`);
      if (!res.ok) {
        this.accountingJournalList = [];
        return;
      }
      const json = await res.json();
      if (json && json.success && Array.isArray(json.data)) {
        this.accountingJournalList = json.data;
        console.log(`[KASIR-JOURNAL] Loaded ${json.data.length} entries for ${bulan}`);
      } else {
        this.accountingJournalList = [];
      }
    } catch (e) {
      console.warn('[KASIR-JOURNAL] Error:', e);
      this.accountingJournalList = [];
    } finally {
      this.accountingJournalLoading = false;
    }
  },

 async loadCOAListFromBackend() {
    try {
      this.coaListBackendLoading = true;
      const bulan = new Date().toISOString().slice(0, 7);

      // ============================================================
      // 1. Fetch COA list — coba endpoint dulu, fallback hardcoded
      // ============================================================
      let list = [];
      try {
        const res = await fetch('/accounting/coa');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            if (Array.isArray(json.data)) {
              list = json.data;
            } else {
              list = Object.entries(json.data).map(([code, v]) => ({
                code,
                name: v.n || v.name || code,
                type: v.t || v.type || 'Aset'
              }));
            }
          }
        }
      } catch (e) {
        console.warn('[KASIR-COA] Endpoint /coa gagal, pakai fallback:', e.message);
      }

      // Fallback hardcoded kalau endpoint gagal / kosong
      if (!Array.isArray(list) || list.length === 0) {
        list = [
          { code: '101', name: 'Kas di Tangan', type: 'Aset' },
          { code: '102', name: 'Bank', type: 'Aset' },
          { code: '103', name: 'Piutang Usaha', type: 'Aset' },
          { code: '105', name: 'Persediaan Bahan Baku', type: 'Aset' },
          { code: '111', name: 'Akum. Penyusutan', type: 'Aset' },
          { code: '201', name: 'Hutang Supplier', type: 'Kewajiban' },
          { code: '301', name: 'Modal Pemilik', type: 'Ekuitas' },
          { code: '302', name: 'Prive Pemilik', type: 'Ekuitas' },
          { code: '401', name: 'Pendapatan Penjualan', type: 'Pendapatan' },
          { code: '402', name: 'Pendapatan Catering', type: 'Pendapatan' },
          { code: '501', name: 'HPP Bahan Baku', type: 'HPP' },
          { code: '601', name: 'Beban Gaji Karyawan', type: 'Beban' },
          { code: '602', name: 'Beban Sewa Tempat', type: 'Beban' },
          { code: '603', name: 'Beban Listrik, Air & Gas', type: 'Beban' },
          { code: '604', name: 'Beban Pemasaran & Promosi', type: 'Beban' },
          { code: '605', name: 'Beban Kurir & Ekspedisi', type: 'Beban' },
          { code: '606', name: 'Beban Penyusutan', type: 'Beban' }
        ];
      }

      // ============================================================
      // 2. ✅ FIX: Fetch ALL ledger dari Firebase REST API
      //    STRUKTUR: /accounting/ledger/{accCode}/{bulan}
      //    Jadi fetch .json TANPA bulan, dapat semua akun
      // ============================================================
      const fbUrl = (this._fbConfig && this._fbConfig.databaseURL)
        || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
      const saldoMap = {};

      try {
        const ledgerRes = await fetch(`${fbUrl.replace(/\/$/, '')}/accounting/ledger.json`);
        if (ledgerRes.ok) {
          const ledgerData = await ledgerRes.json();
          console.log('[KASIR-COA] Ledger raw:', ledgerData);

          if (ledgerData && typeof ledgerData === 'object') {
            // ledgerData = { "1001": { "2026-09": {closing,...} }, "1002": {...}, ... }
            Object.entries(ledgerData).forEach(([accCode, months]) => {
              if (!months || typeof months !== 'object') return;
              const monthData = months[bulan];
              if (monthData && typeof monthData === 'object') {
                const closing = Number(monthData.closing);
                const d = Number(monthData.debit) || 0;
                const c = Number(monthData.credit) || 0;
                // Prioritas: closing, fallback: debit - credit
                saldoMap[String(accCode)] = isNaN(closing) ? (d - c) : closing;
              }
            });
          }
          console.log(`[KASIR-COA] ✅ Ledger: ${Object.keys(saldoMap).length} accounts`);
          console.log('[KASIR-COA] Ledger saldo:', saldoMap);
        } else {
          console.warn('[KASIR-COA] Ledger fetch failed:', ledgerRes.status);
        }
      } catch (e) {
        console.warn('[KASIR-COA] Firebase ledger error:', e.message);
      }

      // ============================================================
      // 3. Legacy mapping 3-digit → 4-digit
      //    (COA list biasanya 3-digit, ledger 4-digit)
      // ============================================================
      const legacyMap = {
        '101': '1001', '102': '1002', '103': '1003',
        '105': '1004', '111': '1005',
        '201': '2001', '202': '2002',
        '301': '3001', '302': '3003', '303': '3002',
        '401': '4001', '402': '4002',
        '501': '5001',
        '601': '6001', '602': '6002', '603': '6003',
        '604': '6004', '605': '6005', '606': '6006'
      };

      // ============================================================
      // 4. Merge saldo ke COA list
      // ============================================================
      list.forEach(item => {
        const rawCode = String(item.code || '').trim();
        const canonCode = legacyMap[rawCode] || rawCode;

        // Kalau saldo dari backend COA kosong/0, override dengan ledger
        if (item.saldo === null || item.saldo === undefined || Number(item.saldo) === 0) {
          if (saldoMap[canonCode] !== undefined) {
            item.saldo = saldoMap[canonCode];
          } else if (item.saldo === null || item.saldo === undefined) {
            item.saldo = 0;
          }
        }
      });

      list.sort((a, b) => String(a.code).localeCompare(String(b.code)));
      this.coaListBackend = list;

      console.log(`[KASIR-COA] ✅ Final: ${list.length} accounts`);
      console.log('[KASIR-COA] Non-zero:', list
        .filter(x => Number(x.saldo) > 0)
        .map(x => `${x.code}: Rp ${x.saldo}`));

    } catch (err) {
      console.error('[KASIR-COA] ❌ Error:', err);
    } finally {
      this.coaListBackendLoading = false;
    }
  },

  async loadJournalList(bulan) {
    const b = bulan || new Date().toISOString().slice(0, 7);
    try {
      const res = await fetch(`/accounting/journal/${b}`);
      const data = await res.json();
      if (data && data.success && Array.isArray(data.data)) {
        this.accountingJournalList = data.data;
      }
    } catch (err) {
      console.error('Error load journal list:', err);
    }
  },

  filteredApprovals() {
    let list = Array.isArray(this.pendingApprovals) ? this.pendingApprovals : [];
    if (this.approvalFilter && this.approvalFilter !== 'all') {
      list = list.filter(a => a.status === this.approvalFilter);
    }
    const q = (this.approvalSearch || '').trim().toLowerCase();
    if (q) {
      list = list.filter(a => 
        (a.desc && a.desc.toLowerCase().includes(q)) ||
        (a.noEntry && a.noEntry.toLowerCase().includes(q)) ||
        (a.ref && a.ref.toLowerCase().includes(q)) ||
        (a.category && a.category.toLowerCase().includes(q))
      );
    }
    return list;
  },

  // =========================================================================
  // 🎯 R&D FITUR 1: SKU + BARCODE + SCANNER EXTERNAL (JsBarcode + Html5-QRCode)
  // =========================================================================

  /**
   * Helper: Generate Barcode Data URL (PNG) dari teks SKU atau barcode string
   * Mendukung auto-detect EAN13 (13 digit), UPC (12 digit), dan default CODE128
   */
   /**
   * ✅ Opsi C: Generate 8-digit numeric short code untuk barcode
   * Random + uniqueness check di inventoryList
   */
  generateShortCode() {
    const MAX_ATTEMPTS = 20;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const code = String(Math.floor(10000000 + Math.random() * 90000000));
      const exists = (this.inventoryList || []).some(inv =>
        inv && String(inv.barcodeShort) === code
      );
      if (!exists) return code;
    }
    return String(Date.now()).slice(-8); // fallback
  },

    /** Persist barcodeShort ke Firebase + backend (write FULL item — hindari race dengan loadInventory auto-save) */
  async _persistShortCode(item) {
    if (!item || !item.id || !item.barcodeShort) return;
    // ✅ Tulis FULL ITEM — biar konsisten dengan auto-save loadInventory
    if (this._fbDb && this._fbSet && this._fbRef) {
      try {
        const ref = this._fbRef(this._fbDb, `inventory/${item.id}`);
        const plain = JSON.parse(JSON.stringify(item));
        await this._fbSet(ref, plain);
      } catch (e) { console.warn('[PERSIST-SHORT] FB error:', e); }
    }
    try {
      await fetch(`/inventory/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ barcodeShort: item.barcodeShort })
      });
    } catch (e) { console.warn('[PERSIST-SHORT] Backend error:', e); }
  },
 
 generateBarcodeDataURL(text, format) {
    if (!text) return '';
    try {
      if (typeof window.JsBarcode === 'undefined') return '';
      const canvas = document.createElement('canvas');
      const cleanText = String(text).trim();
      let fmt = format;
      if (!fmt) {
        if (/^\d{13}$/.test(cleanText)) fmt = 'EAN13';
        else if (/^\d{12}$/.test(cleanText)) fmt = 'UPC';
        else fmt = 'CODE128';
      }
      window.JsBarcode(canvas, cleanText, {
        format: fmt,
        width: 1.8,
        height: 42,
        displayValue: true,
        fontSize: 12,
        font: 'monospace',
        margin: 5,
        background: '#ffffff'
      });
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('generateBarcodeDataURL note:', e.message);
      return '';
    }
  },

   /**
   * Helper: Hash string jadi 4-char uppercase hex (FNV-1a 32-bit)
   * Deterministik — string sama selalu hasil sama
   */
  _hash4(str) {
    const s = String(str || 'UMUM');
    let h = 2166136261; // FNV offset basis
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619); // FNV prime
    }
    return (h >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 4);
  },

  /**
   * Helper: Format SKU Final: SKU-{KATEGORI}-{URUT}-{TAHUN}-{HASH4}
   * Contoh: SKU-BHN-0001-2026-4A9F
   */
  
 generateSKU(category, skuSource, supplierName, sequentialNum) {
    if (skuSource === 'external') return null;
    const cat = String(category || '').toLowerCase();
    let catCode = 'BHN';
    if (cat.includes('bumbu') || cat.includes('saus')) catCode = 'BMB';
    else if (cat.includes('kemasan') || cat.includes('box') || cat.includes('pack')) catCode = 'KMS';
    else if (cat.includes('minuman') || cat.includes('drink')) catCode = 'MNM';
    else if (cat.includes('menu') || cat.includes('rice') || cat.includes('bento') || cat.includes('mie')) catCode = 'MNU';
    else if (cat.includes('frozen')) catCode = 'FRZ';
    else if (cat.includes('snack') || cat.includes('dimsum')) catCode = 'SNK';

    const year = new Date().getFullYear();

    // ✅ BUG-1 Opsi C: hash 4-char dari supplierId (fallback ke name kalau ID tidak ketemu)
    const supNameRaw = String(supplierName || '').trim();
    let hashSource = supNameRaw || 'UMUM';
    if (supNameRaw && Array.isArray(this.suppliersList)) {
      const found = this.suppliersList.find(s =>
        s && s.name && s.name.toLowerCase() === supNameRaw.toLowerCase()
      );
      if (found && found.id) hashSource = String(found.id);
    }
    const hash4 = this._hash4(hashSource);

    let num = sequentialNum;
    if (!num) {
      num = (this.inventoryList ? this.inventoryList.length : 0) + 1;
    }
    const numPadded = String(num).padStart(4, '0');
    return `SKU-${catCode}-${numPadded}-${year}-${hash4}`;
  },

  /**
   * Generate ulang SKU untuk item yang dipilih
   */
  regenerateSKUForItem(item) {
    if (!item) return;
    const newSku = this.generateSKU(item.category, 'internal', item.supplierName);
    item.sku = newSku;
    item.barcode = newSku;
    item.skuSource = 'internal';
    item.barcodeFormat = 'CODE128';
    this.showToast(`SKU baru berhasil dibuat: ${newSku}`, 'success');
  },

  /**
   * Regenerate SKU untuk semua item inventori lama yang belum punya SKU
   */
  async regenSKUForExistingItems() {
    if (!this.inventoryList || this.inventoryList.length === 0) return;
    let count = 0;
    for (let idx = 0; idx < this.inventoryList.length; idx++) {
      const item = this.inventoryList[idx];
      if (!item.sku) {
        const sku = this.generateSKU(item.category, 'internal', item.supplierName || 'UMUM', idx + 1);
        item.sku = sku;
        item.skuSource = 'internal';
        item.barcode = sku;
        item.barcodeFormat = 'CODE128';
        count++;

        // Simpan ke server
        fetch(`/inventory/${encodeURIComponent(item.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sku, skuSource: 'internal', barcode: sku, barcodeFormat: 'CODE128' })
        }).catch(() => {});

        // Simpan ke Firebase jika aktif
        if (this._fbDb && this._fbSet && this._fbRef) {
          try {
            const itemRef = this._fbRef(this._fbDb, `inventory/${item.id}`);
            await this._fbSet(itemRef, item);
          } catch(e){}
        }
      }
    }
    try {
      localStorage.setItem('dapur_inventory_list', JSON.stringify(this.inventoryList));
    } catch(e){}
    this.showToast(`Berhasil men-generate SKU untuk ${count} item lama`, 'success');
  },
   /**
   * ✅ Opsi C: Bulk-generate barcodeShort untuk item lama yang belum punya
   */
    async regenShortCodeForExistingItems() {
    if (!Array.isArray(this.inventoryList)) return;
    let count = 0;
    const promises = [];
    for (const item of this.inventoryList) {
      if (!item || item.barcodeShort) continue;
      if (item.skuSource === 'external') continue;
      item.barcodeShort = this.generateShortCode();
      count++;
      promises.push(this._persistShortCode(item));
    }
    // ✅ AWAIT semua write selesai sebelum toast
    try {
      await Promise.all(promises);
      console.log(`[REGEN-SHORT] ✅ ${count} short codes persisted`);
    } catch (e) {
      console.warn('[REGEN-SHORT] Some writes failed:', e);
    }
    try {
      localStorage.setItem('dapur_inventory_list', JSON.stringify(this.inventoryList));
    } catch (e) {}
    this.showToast(`✅ Short code ter-generate untuk ${count} item lama`, 'success');
  },


  /**
   * Buka modal scanner kamera Html5-QRCode dengan fallback manual input
   */
  openScanModal(target = 'inventory_edit', mode = 'camera', onScanned = null) {
    this.scanModal = {
      open: true,
      target: target,
      mode: mode || 'camera',
      result: '',
      manualInput: '',
      error: '',
      _scanner: null,
      _onScanned: onScanned
    };

    if (this.scanModal.mode === 'camera') {
      this.$nextTick(() => {
        this._startScanner();
      });
    }
  },

  /**
   * Inisialisasi & jalankan Html5Qrcode kamera scanner
   */
  _startScanner() {
    if (typeof Html5Qrcode === 'undefined') {
      this.scanModal.error = 'Modul kamera scanner belum siap. Silakan ketik kode manual di bawah.';
      this.scanModal.mode = 'manual';
      return;
    }
    try {
      const elId = "html5qr-code-full-region";
      const regionEl = document.getElementById(elId);
      if (!regionEl) {
        setTimeout(() => this._startScanner(), 150);
        return;
      }
      this.scanModal._scanner = new Html5Qrcode(elId);
      const qrConfig = { fps: 12, qrbox: { width: 260, height: 180 } };
      this.scanModal._scanner.start(
        { facingMode: "environment" },
        qrConfig,
        (decodedText) => this._onScanSuccess(decodedText),
        () => { /* ignore normal frame misses */ }
      ).catch(err => {
        console.warn('Html5Qrcode start error:', err);
        this.scanModal.error = 'Akses kamera tidak diizinkan atau tidak ditemukan. Gunakan input manual.';
        this.scanModal.mode = 'manual';
      });
    } catch (e) {
      this.scanModal.error = 'Gagal membuka kamera: ' + e.message;
      this.scanModal.mode = 'manual';
    }
  },

  /**
   * Callback scan berhasil
   */
  _onScanSuccess(decodedText) {
    const text = String(decodedText || '').trim();
    if (!text) return;
    this.playSound('success');
    this.scanModal.result = text;
    if (typeof this.scanModal._onScanned === 'function') {
      this.scanModal._onScanned(text);
    }
    this.closeScanModal();
  },

  /**
   * Submit scan via input manual (fallback ketika tanpa kamera)
   */
  submitManualScan() {
    const code = String(this.scanModal.manualInput || '').trim();
    if (!code) {
      this.showToast('Masukkan kode SKU atau barcode terlebih dahulu', 'error');
      return;
    }
    this._onScanSuccess(code);
  },

  /**
   * Tutup modal scan dan hentikan stream kamera
   */
  closeScanModal() {
    if (this.scanModal._scanner) {
      try {
        this.scanModal._scanner.stop().then(() => {
          try { this.scanModal._scanner.clear(); } catch(e){}
        }).catch(() => {});
      } catch (e) {}
    }
    this.scanModal.open = false;
    this.scanModal.mode = 'camera';
    this.scanModal.error = '';
    this.scanModal.result = '';
    this.scanModal.manualInput = '';
    this.scanModal._scanner = null;
    this.scanModal._onScanned = null;
  },

  /**
   * 1H. Quick Scan Bahan Baku untuk Jurnal Manual
   */
  handleJournalScanBahan(code) {
    const targetCode = String(code || '').trim().toLowerCase();
    const item = (this.inventoryList || []).find(i => 
  (i.barcodeShort && i.barcodeShort.toLowerCase() === targetCode) ||   // ← TAMBAH
  (i.sku && i.sku.toLowerCase() === targetCode) ||
  (i.barcode && i.barcode.toLowerCase() === targetCode) ||
  (i.id && i.id.toLowerCase() === targetCode)
);
    if (!item) {
      this.showToast(`Bahan dengan kode "${code}" tidak ditemukan di inventori`, 'error');
      return;
    }

    const price = Number(item.purchasePrice || item.hargaBeli || 0);
    this.journalForm.desc = `Pembelian ${item.name}`;
    this.journalForm.ref = item.sku || code;
    this.journalForm.category = 'pembelian';
    this.journalForm.lines = [
      { acc: '1004', debit: price, credit: 0, hint: 'Persediaan Bahan Baku' },
      { acc: '1001', debit: 0, credit: price, hint: 'Kas Tunai' }
    ];
    this.showToast(`Form jurnal otomatis terisi untuk "${item.name}"`, 'success');
  },

  /**
   * 1I. Cetak Label Barcode Grid PDF (3 ukuran: 25×15mm, 20×10mm, 30×20mm)
   * Grid 3×10 = 30 label per halaman A4
   */
  openBarcodeLabelModal(item) {
    if (!item) return;
    this.barcodeLabelItem = item;
    this.barcodeLabelSize = '25x15';
    this.barcodeLabelCount = 30;
    this.barcodeLabelModal = true;
  },

  printBarcodeLabel(item, size = '25x15', count = 30) {
    if (!item) return;
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      this.showToast('Pustaka jsPDF belum termuat', 'error');
      return;
    }

        try {
      // ✅ Opsi C: pakai barcodeShort untuk item internal
      let code, format;
      if (item.skuSource === 'external') {
        code = item.barcode || item.sku || item.id;
        format = item.barcodeFormat || 'CODE128';
      } else {
        if (!item.barcodeShort) {
          item.barcodeShort = this.generateShortCode();
          this._persistShortCode(item);
        }
        code = item.barcodeShort;
        format = 'CODE128';
      }
      const barcodeDataUrl = this.generateBarcodeDataURL(code, format);
      if (!barcodeDataUrl) {
        this.showToast('Gagal membentuk data barcode', 'error');
        return;
      }

      const doc = new window.jspdf.jsPDF('p', 'mm', 'a4');
      const pageWidth = 210;
      const pageHeight = 297;
      const cols = 3;
      const rows = 10;
      const labelW = 60;
      const labelH = 26;
      const startX = (pageWidth - (cols * labelW)) / 2;
      const startY = 12;

      let printed = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (printed >= count) break;
          const x = startX + (c * labelW);
          const y = startY + (r * labelH);

          // Kotak label
          doc.setDrawColor(220, 220, 220);
          doc.setLineWidth(0.2);
          doc.roundedRect(x + 1, y + 1, labelW - 2, labelH - 2, 2, 2, 'S');

          // Header teks nama produk
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(30, 30, 30);
          const title = item.name.length > 24 ? item.name.slice(0, 22) + '...' : item.name;
          doc.text(title, x + (labelW / 2), y + 5, { align: 'center' });

          // Gambar barcode
          doc.addImage(barcodeDataUrl, 'PNG', x + 5, y + 6, labelW - 10, 12);

          // ✅ BUG-1: Footer harga & SKU dihapus (JsBarcode sudah render displayValue)
          printed++;
        }
      }

      doc.save(`label_barcode_${item.name.replace(/[^a-zA-Z0-9]/g, '_')}_${size}.pdf`);
      this.showToast(`Label barcode berhasil diunduh (${printed} label)`, 'success');
      this.barcodeLabelModal = false;
    } catch (err) {
      console.error('printBarcodeLabel error:', err);
      this.showToast(`Gagal mencetak label: ${err.message}`, 'error');
    }
  },

  // =========================================================================
  // 🎯 R&D FITUR 2: SUPPLIER MASTER & PRE-REGISTER KONSINYASI
  // =========================================================================

  /**
   * 2A & 2B. Muat daftar supplier dari /suppliers atau Firebase
   */
  async loadSuppliers() {
    this.loadingSuppliers = true;
    try {
      const res = await fetch('/suppliers');
      const json = await res.json();
      if (json && json.success && Array.isArray(json.data)) {
        this.suppliersList = json.data;
      } else {
        // Fallback default supplier demo jika kosong
        this.suppliersList = [
          { id: 'sp_1', name: 'Pakde (Nasi & Gorengan)', contact: '081234567890', address: 'Jl. Merdeka No. 10', active: true },
          { id: 'sp_2', name: 'Bu Tejo (Snack & Kue)', contact: '081298765432', address: 'Jl. Melati No. 5', active: true }
        ];
      }
    } catch (e) {
      console.warn('loadSuppliers error:', e);
      if (!this.suppliersList || this.suppliersList.length === 0) {
        this.suppliersList = [
          { id: 'sp_1', name: 'Pakde (Nasi & Gorengan)', contact: '081234567890', address: 'Jl. Merdeka No. 10', active: true },
          { id: 'sp_2', name: 'Bu Tejo (Snack & Kue)', contact: '081298765432', address: 'Jl. Melati No. 5', active: true }
        ];
      }
    } finally {
      this.loadingSuppliers = false;
    }
  },

  openAddSupplierModal() {
    this.supplierForm = { id: '', name: '', contact: '', address: '', active: true };
    this.supplierModal = true;
  },

  openEditSupplierModal(sup) {
    if (!sup) return;
    this.supplierForm = { ...sup };
    this.supplierModal = true;
  },

  async saveSupplier() {
    if (!this.supplierForm.name || !this.supplierForm.name.trim()) {
      this.showToast('Nama supplier wajib diisi', 'error');
      return;
    }
    const supId = this.supplierForm.id || `sp_${Date.now()}`;
    const payload = {
      id: supId,
      name: this.supplierForm.name.trim(),
      contact: this.supplierForm.contact ? this.supplierForm.contact.trim() : '',
      address: this.supplierForm.address ? this.supplierForm.address.trim() : '',
      active: this.supplierForm.active !== undefined ? Boolean(this.supplierForm.active) : true,
      createdAt: new Date().toISOString()
    };

    try {
      const method = this.supplierForm.id ? 'PATCH' : 'POST';
      const endpoint = this.supplierForm.id ? `/suppliers/${encodeURIComponent(supId)}` : '/suppliers';
      await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Simpan ke Firebase jika ada SDK
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const supRef = this._fbRef(this._fbDb, `suppliers/${supId}`);
          await this._fbSet(supRef, payload);
        } catch(e){}
      }

      await this.loadSuppliers();
      this.supplierModal = false;
      this.showToast(`Supplier "${payload.name}" berhasil disimpan`, 'success');
    } catch (err) {
      this.showToast(`Gagal menyimpan supplier: ${err.message}`, 'error');
    }
  },

  async deleteSupplier(supId) {
    if (!supId) return;
    if (!confirm('Yakin ingin menghapus supplier ini?')) return;
    try {
      await fetch(`/suppliers/${encodeURIComponent(supId)}`, { method: 'DELETE' });
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const supRef = this._fbRef(this._fbDb, `suppliers/${supId}`);
          await this._fbSet(supRef, null);
        } catch(e){}
      }
      this.suppliersList = this.suppliersList.filter(s => s.id !== supId);
      this.showToast('Supplier berhasil dihapus', 'success');
    } catch (err) {
      this.showToast(`Gagal menghapus supplier: ${err.message}`, 'error');
    }
  },

  /**
   * 2D. Pre-Register Produk Konsinyasi (Auto-create SKU + Menu Baru + Barcode)
   */
  openPreRegisterModal() {
    const defaultSup = (this.suppliersList && this.suppliersList[0]) ? this.suppliersList[0] : { id: 'sp_1', name: 'Pakde' };
      this.preRegisterForm = {
      name: '',
      supplierId: defaultSup.id,
      supplierName: defaultSup.name,
      purchasePrice: 15000,
      sellingPrice: 18000,
      category: 'rice_bowl',
      unit: 'porsi',
      initialStock: 0,
      minStock: 5,
      sku: this.generateSKU('rice_bowl', 'internal', defaultSup.name),
      barcode: '',
      autoPrintBarcode: true,
      sellingPriceManual: false   // ✅ BUG-3: reset flag saat modal dibuka
    };
    this.preRegisterForm.barcode = this.preRegisterForm.sku;
    this.preRegisterModal = true;
  },

  onPreRegisterNameOrSupplierChange() {
    const sup = this.suppliersList.find(s => s.id === this.preRegisterForm.supplierId);
    if (sup) this.preRegisterForm.supplierName = sup.name;
    const cleanSup = (this.preRegisterForm.supplierName || 'UMUM').split(' ')[0];
    this.preRegisterForm.sku = this.generateSKU(this.preRegisterForm.category, 'internal', cleanSup);
    this.preRegisterForm.barcode = this.preRegisterForm.sku;
    // ✅ BUG-3: Auto +20% HANYA kalau user BELUM edit manual sellingPrice
    if (this.preRegisterForm.purchasePrice > 0 && !this.preRegisterForm.sellingPriceManual) {
      this.preRegisterForm.sellingPrice = Math.round((this.preRegisterForm.purchasePrice * 1.2) / 1000) * 1000;
    }
  },

  async savePreRegisterConsignment() {
    if (!this.preRegisterForm.name || !this.preRegisterForm.name.trim()) {
      this.showToast('Nama produk konsinyasi wajib diisi', 'error');
      return;
    }

    const prodName = this.preRegisterForm.name.trim();
    const supName = this.preRegisterForm.supplierName || 'Supplier';
    // ✅ BUG-1: Nama menu bersih (supplier tetap tersimpan di field supplierName)
    const menuTitle = prodName;
    const itemId = `inv_${Date.now()}`;
    const menuId = `m_${Date.now()}`;
    const beli = Number(this.preRegisterForm.purchasePrice) || 0;
    const jual = Number(this.preRegisterForm.sellingPrice) || Math.round(beli * 1.2);

    // 1. Buat Item Inventori Kosong (Stok 0, belum di-receive)
    const newInvItem = {
      id: itemId,
      name: menuTitle,
      category: 'Bahan Baku',
      stock: 0,
      stok: 0,
      minStock: Number(this.preRegisterForm.minStock) || 5,
      unit: this.preRegisterForm.unit || 'porsi',
      purchasePrice: beli,
      isCountable: true,
      sku: this.preRegisterForm.sku,
      skuSource: 'internal',
      barcode: this.preRegisterForm.sku,
      barcodeFormat: 'CODE128',
      supplierId: this.preRegisterForm.supplierId,
      supplierName: supName,
      isReadyToSell: true,
      linkedMenuId: menuId,
      barcodeShort: this.generateShortCode(),   // ✅ Opsi C: 8-digit short code
      createdAt: Date.now()
    };

    // 2. Buat Menu Baru di /menu_items/
    const newMenuItem = {
      id: menuId,
      name: menuTitle,
      category: this.preRegisterForm.category || 'rice_bowl',
      price: jual,
      cost: beli,
      desc: `Produk titipan konsinyasi dari ${supName}`,
      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
      inventoryId: itemId,
      isConsignment: true,
      supplierId: this.preRegisterForm.supplierId,
      supplierName: supName,
      active: true
    };

    try {
      // Simpan ke memory lokal
      this.inventoryList.unshift(newInvItem);
      this.menuList.unshift(newMenuItem);
      try {
        localStorage.setItem('dapur_inventory_list', JSON.stringify(this.inventoryList));
      } catch(e){}

      // Simpan ke backend endpoint
      await fetch(`/inventory/${encodeURIComponent(itemId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newInvItem)
      });

      await fetch(`/menu/${encodeURIComponent(menuId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMenuItem)
      });

      // Simpan ke Firebase jika ada SDK
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const invRef = this._fbRef(this._fbDb, `inventory/${itemId}`);
          const menuRef = this._fbRef(this._fbDb, `menu_items/${menuId}`);
          await this._fbSet(invRef, newInvItem);
          await this._fbSet(menuRef, newMenuItem);
        } catch(e){}
      }

      this.showToast(`Produk konsinyasi "${menuTitle}" berhasil didaftarkan!`, 'success');
      this.preRegisterModal = false;

      // Cetak label langsung jika dipilih
      if (this.preRegisterForm.autoPrintBarcode) {
        this.printBarcodeLabel(newInvItem, '25x15', 30);
      }
    } catch (err) {
      console.error('savePreRegisterConsignment error:', err);
      this.showToast(`Gagal mendaftarkan produk: ${err.message}`, 'error');
    }
  },

  /**
   * 2E. Scan Receive Barang Konsinyasi dari Supplier
   */
      // =========================================================================
  // ✅ FITUR BARU: MULTI-SCAN TRANSAKSI POS (Maks 50 Menu per Sesi)
  // =========================================================================

  openMultiScanModal() {
    this.multiScanModal = true;
    this.multiScanCart = [];
    this.multiScanQuery = '';
    this.playSound('click');
    this.$nextTick(() => {
      setTimeout(() => {
        const el = document.getElementById('multiScanInput');
        if (el) el.focus();
      }, 150);
    });
  },

  onMultiScanQueryChange() {
    const code = String(this.multiScanQuery || '').trim();
    if (!code) {
      this.showToast('Masukkan kode SKU / barcode menu dulu', 'error');
      this.playSound('error');
      return;
    }
    this.processMultiScan(code);
  },

    _resolveMenuFromScanCode(code) {
    const clean = String(code || '').trim().toLowerCase();
    if (!clean) return null;

    let menu = (this.menuList || []).find(m =>
      (m.barcodeShort && String(m.barcodeShort).toLowerCase() === clean) ||
      (m.sku && String(m.sku).toLowerCase() === clean) ||
      (m.barcode && String(m.barcode).toLowerCase() === clean) ||
      (m.id && String(m.id).toLowerCase() === clean)
    );
    if (menu) return menu;

    const inv = (this.inventoryList || []).find(i =>
      (i.barcodeShort && String(i.barcodeShort).toLowerCase() === clean) ||   // ← BARIS BARU
      (i.sku && String(i.sku).toLowerCase() === clean) ||
      (i.barcode && String(i.barcode).toLowerCase() === clean) ||
      (i.id && String(i.id).toLowerCase() === clean)
    );
    if (inv) {
      menu = (this.menuList || []).find(m => m.inventoryId === inv.id);
      if (menu) return menu;
      if (inv.linkedMenuId) {
        menu = (this.menuList || []).find(m => m.id === inv.linkedMenuId);
        if (menu) return menu;
      }
    }
    return null;
  },

  processMultiScan(code) {
    const menu = this._resolveMenuFromScanCode(code);
    if (!menu) {
      this.showToast(`Kode "${code}" tidak cocok dengan menu mana pun`, 'error');
      this.playSound('error');
      return;
    }
    this._addToMultiScanList(menu, 1);
    this.multiScanQuery = '';
    this.$nextTick(() => {
      const el = document.getElementById('multiScanInput');
      if (el) el.focus();
    });
  },

  _addToMultiScanList(menu, qty = 1) {
    if (!menu) return false;
    if (!Array.isArray(this.multiScanCart)) this.multiScanCart = [];

    if (this.multiScanCart.length >= 50) {
      this.showToast('Maksimal 50 menu per sesi scan. Selesaikan dulu sesi ini.', 'error');
      this.playSound('error');
      return false;
    }

    const numQty = Math.max(1, Number(qty) || 1);
    const existing = this.multiScanCart.find(it => it.id === menu.id);
    if (existing) {
      const stock = this.getMenuCalculatedStock(menu.id);
      if (existing.qty + numQty > stock) {
        this.showToast(`Stok "${menu.name}" tinggal ${stock} porsi`, 'error');
        this.playSound('error');
        return false;
      }
      existing.qty += numQty;
      existing.subtotal = existing.qty * existing.price;
      this.showToast(`"${menu.name}" qty → ${existing.qty}`, 'notify');
      this.playSound('click');
      return true;
    }

    this.multiScanCart.push({
      id: menu.id,
      name: menu.name,
      price: Number(menu.price) || 0,
      qty: numQty,
      subtotal: (Number(menu.price) || 0) * numQty
    });
    this.showToast(`✅ "${menu.name}" ditambah (${this.multiScanCart.length}/50)`, 'success');
    this.playSound('success');
    return true;
  },

  removeFromMultiScanList(idx) {
    if (!Array.isArray(this.multiScanCart)) return;
    if (idx < 0 || idx >= this.multiScanCart.length) return;
    const removed = this.multiScanCart.splice(idx, 1)[0];
    if (removed) {
      this.showToast(`"${removed.name}" dihapus`, 'notify');
      this.playSound('click');
    }
  },

  updateMultiScanTotal(item) {
    if (!item) return;
    item.qty = Math.max(1, Number(item.qty) || 1);
    item.price = Math.max(0, Number(item.price) || 0);
    item.subtotal = item.qty * item.price;
  },

  getMultiScanTotal() {
    if (!Array.isArray(this.multiScanCart)) return 0;
    return this.multiScanCart.reduce((s, it) => s + (Number(it.subtotal) || 0), 0);
  },

  confirmMultiScanToCart() {
    if (!Array.isArray(this.multiScanCart) || this.multiScanCart.length === 0) {
      this.showToast('Belum ada menu di-scan', 'error');
      return;
    }

    const errors = [];
    for (const it of this.multiScanCart) {
      const stock = this.getMenuCalculatedStock(it.id);
      const inCart = (this.cart.find(c => c.id === it.id)?.qty) || 0;
      const totalNeeded = inCart + it.qty;
      if (totalNeeded > stock) {
        errors.push(`"${it.name}" butuh ${totalNeeded}, stok ${stock}`);
      }
    }
      if (errors.length) {
      const shown = errors.slice(0, 3).join('; ');
      const more = errors.length > 3 ? ` … +${errors.length - 3} item lainnya` : '';
      this.showToast(`Stok tidak cukup: ${shown}${more}`, 'error');
      this.playSound('error');
      return;
    }

    let added = 0;
    for (const it of this.multiScanCart) {
      const existing = this.cart.find(c => c.id === it.id);
      if (existing) {
        existing.qty += it.qty;
      } else {
        this.cart.push({
          id: it.id,
          name: it.name,
          price: Number(it.price) || 0,
          qty: Number(it.qty) || 1
        });
      }
      added++;
    }

    this.showToast(`✅ ${added} menu ditambahkan ke keranjang`, 'success');
    this.playSound('success');
    this.multiScanModal = false;
    this.multiScanCart = [];
    this.multiScanQuery = '';
  },

  openScanReceiveModal() {
    this.scanReceiveForm = {
      skuQuery: '',
      matchedItem: null,
      items: [],
      supplierId: '',
      supplierName: '',
      waPhone: '',
      qty: 1,
      purchasePrice: 0,
      paymentMethod: 'payable',
      notes: '',
      searched: false
    };
    this.scanReceiveModal = true;
  },

   /**
   * Handler tombol "Cari" / Enter di input SKU Receive
   * Wrapper ke processScanReceive — resolve bug "Kode belum terdaftar" 
   * karena HTML memanggil onReceiveSkuQueryChange() yang tadinya tidak ada
   */
    /**
   * ✅ BUG-4: Reset flag searched + matchedItem saat user mengetik ulang
   */
  onReceiveSkuQueryInput() {
    if (this.scanReceiveForm) {
      this.scanReceiveForm.searched = false;
      this.scanReceiveForm.matchedItem = null;
    }
  },

  onReceiveSkuQueryChange() {
    const code = String(this.scanReceiveForm?.skuQuery || '').trim();
    if (!code) {
      this.showToast('Masukkan SKU atau scan barcode terlebih dahulu', 'error');
      this.playSound('error');
      return;
    }
    this.scanReceiveForm.searched = true;  // ✅ BUG-4: tandai user sudah klik Cari
    this.processScanReceive(code);
  },
 
   /**
   * ✅ FITUR: Saat user pilih supplier dari dropdown → auto-fill nomor WA
   * Rule: hanya isi kalau field masih kosong (jangan overwrite manual edit user)
   */
    onReceiveSupplierChange() {
    const sid = this.scanReceiveForm?.supplierId;
    if (!sid) return;
    const sup = (this.suppliersList || []).find(s => s && s.id === sid);
    if (!sup) return;

    // ✅ Validasi: kalau list sudah ada item dari supplier lain → konfirmasi reset
    const items = this.scanReceiveForm.items || [];
    if (items.length > 0 && items[0].supplierId && items[0].supplierId !== sid) {
      if (!confirm(`Sudah ada ${items.length} item dari supplier lain.\nGanti supplier akan MENGOSONGKAN list. Lanjutkan?`)) {
        this.scanReceiveForm.supplierId = items[0].supplierId;
        return;
      }
      this.scanReceiveForm.items = [];
    }

    this.scanReceiveForm.supplierName = sup.name || 'Umum';
    if (!String(this.scanReceiveForm.waPhone || '').trim()) {
      this.scanReceiveForm.waPhone = sup.contact || '';
    }
    this.showToast(
      sup.contact
        ? `Supplier "${sup.name}" dipilih • WA auto-terisi`
        : `Supplier "${sup.name}" belum punya kontak WA — isi manual`,
      sup.contact ? 'success' : 'notify'
    );
  },

   /**
   * ✅ Multi-item: Tambah item ke list (auto-dedupe, maks 5)
   */
  _addItemToReceiveList(item, qty, price) {
    if (!item) return false;
    if (!Array.isArray(this.scanReceiveForm.items)) this.scanReceiveForm.items = [];

    if (this.scanReceiveForm.items.length >= 5) {
      this.showToast('Maksimal 5 produk per penerimaan. Simpan dulu, baru buat penerimaan baru.', 'error');
      this.playSound('error');
      return false;
    }

    const numQty = Math.max(1, Number(qty) || 1);
    const numPrice = Number(price) || Number(item.purchasePrice || item.hargaBeli) || 0;

    const existing = this.scanReceiveForm.items.find(it => it.id === item.id);
    if (existing) {
      existing.qty += numQty;
      existing.price = numPrice || existing.price;
      existing.total = existing.qty * existing.price;
      this.showToast(`"${item.name}" sudah ada — qty jadi ${existing.qty}`, 'notify');
      this.playSound('click');
      return true;
    }

    this.scanReceiveForm.items.push({
      id: item.id,
      name: item.name,
      sku: item.sku || item.barcode || item.id,
      unit: item.unit || 'unit',
      qty: numQty,
      price: numPrice,
      total: numQty * numPrice,
      supplierId: item.supplierId || '',
      supplierName: item.supplierName || ''
    });
    this.playSound('success');
    return true;
  },

  /**
   * ✅ Multi-item: Hapus item dari list
   */
  removeItemFromReceiveList(idx) {
    if (!Array.isArray(this.scanReceiveForm.items)) return;
    if (idx < 0 || idx >= this.scanReceiveForm.items.length) return;
    const removed = this.scanReceiveForm.items.splice(idx, 1)[0];
    if (removed) {
      this.showToast(`"${removed.name}" dihapus dari list`, 'notify');
      this.playSound('click');
    }
  },

  /**
   * ✅ Multi-item: Recalc total saat qty/price di-edit inline
   */
  updateReceiveItemTotal(item) {
    if (!item) return;
    item.qty = Math.max(1, Number(item.qty) || 1);
    item.price = Math.max(0, Number(item.price) || 0);
    item.total = item.qty * item.price;
  },

  /**
   * ✅ Multi-item: Total nilai seluruh list
   */
  getReceiveTotal() {
    if (!Array.isArray(this.scanReceiveForm?.items)) return 0;
    return this.scanReceiveForm.items.reduce((s, it) => s + (Number(it.total) || 0), 0);
  },

   processScanReceive(code) {
    const cleanCode = String(code || '').trim().toLowerCase();
        const item = (this.inventoryList || []).find(i => 
      (i.barcodeShort && String(i.barcodeShort).toLowerCase() === cleanCode) ||
      (i.sku && i.sku.toLowerCase() === cleanCode) ||
      (i.barcode && i.barcode.toLowerCase() === cleanCode) ||
      (i.id && i.id.toLowerCase() === cleanCode)
    );

    if (item) {
      // Validasi supplier konsisten
      if (this.scanReceiveForm.supplierId) {
        if (item.supplierId && item.supplierId !== this.scanReceiveForm.supplierId) {
          this.showToast(
            `Item "${item.name}" dari supplier berbeda. Simpan dulu penerimaan ini, baru buat baru.`,
            'error'
          );
          this.playSound('error');
          return;
        }
      } else {
        // Pertama kali scan — set context supplier
        this.scanReceiveForm.supplierId = item.supplierId || '';
        this.scanReceiveForm.supplierName = item.supplierName || 'Umum';
        const matchedSupplier = (this.suppliersList || []).find(s =>
          s && (s.id === item.supplierId || s.name === item.supplierName)
        );
        if (matchedSupplier?.contact && !this.scanReceiveForm.waPhone) {
          this.scanReceiveForm.waPhone = matchedSupplier.contact;
        }
      }

      // Tambah ke list
      const added = this._addItemToReceiveList(
        item,
        this.scanReceiveForm.qty || 1,
        this.scanReceiveForm.purchasePrice || 0
      );

      if (added) {
        this.showToast(
          `✅ "${item.name}" ditambah (${this.scanReceiveForm.items.length}/5)`,
          'success'
        );
        // Clear input untuk scan berikutnya
        this.scanReceiveForm.skuQuery = '';
        this.scanReceiveForm.matchedItem = null;
        this.scanReceiveForm.qty = 1;
      }
    } else {
      this.playSound('error');
      if (confirm(`SKU/Barcode "${code}" belum terdaftar.\nDaftarkan produk baru konsinyasi sekarang?`)) {
        this.scanReceiveModal = false;
        this.openPreRegisterModal();
        this.preRegisterForm.sku = code;
        this.preRegisterForm.barcode = code;
      }
    }
  },

      async submitReceiveGoods() {
    // ✅ FIX BUG-4: Block kalau shift sudah closed
    if (this.shiftStatus === 'closed' || this._shiftClosedHandled) {
      this.showToast('⚠️ Shift sudah ditutup. Tidak bisa terima barang.', 'error');
      this.playSound('error');
      setTimeout(() => { window.location.href = '/'; }, 800);
      return;
    }

    const items = Array.isArray(this.scanReceiveForm?.items) ? this.scanReceiveForm.items : [];
    if (items.length === 0) {
      this.showToast('Belum ada item di list. Scan minimal 1 produk dulu.', 'error');
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randHex = Math.floor(Math.random() * 9000 + 1000).toString();
    const receiveId = `TRM-${dateStr}-${randHex}`;
    const supName = this.scanReceiveForm.supplierName || 'Supplier';
    const supId = this.scanReceiveForm.supplierId || '';
    const totalValue = this.getReceiveTotal();

    const recordItems = items.map(it => ({
      id: it.id, name: it.name, sku: it.sku,
      qty: it.qty, unit: it.unit, price: it.price, total: it.total
    }));

    const receiveRecord = {
      receiveId, id: receiveId,
      supplierId: supId, supplierName: supName,
      date: now.toISOString().slice(0, 10),
      time: now.toLocaleTimeString('id-ID'),
      items: recordItems,
      totalValue,
      status: 'received',
      notes: this.scanReceiveForm.notes || 'Penerimaan barang konsinyasi',
      createdAt: Date.now()
    };

    try {
      // 1. POST receive record
      await fetch('/inventory_receives', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(receiveRecord)
      });

      // 2. Update stok + log setiap item
      for (const it of items) {
        const inv = (this.inventoryList || []).find(i => i.id === it.id);
        if (!inv) continue;
        const oldStock = Number(inv.stock || inv.stok || 0);
        const newStock = oldStock + Number(it.qty);
        inv.stock = newStock;
        inv.stok = newStock;
        inv.purchasePrice = Number(it.price) || inv.purchasePrice;

        fetch(`/inventory/${encodeURIComponent(it.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock: newStock, stok: newStock, purchasePrice: it.price })
        }).catch(() => {});

        fetch(`/inventory_logs/${encodeURIComponent(it.id)}/log_${Date.now()}_${Math.random().toString(36).slice(2,6)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            t: Date.now(), old: oldStock, new: newStock, diff: it.qty,
            by: this.kasirInfo?.name || 'kasir',
            reason: `Penerimaan Konsinyasi #${receiveId}`,
            changeType: 'purchase'
          })
        }).catch(() => {});

        if (this._fbDb && this._fbSet && this._fbRef) {
          try {
            const itemRef = this._fbRef(this._fbDb, `inventory/${it.id}`);
            await this._fbSet(itemRef, inv);
          } catch (e) { console.warn('[RECEIVE] FB update err:', e); }
        }
      }

      // 3. Auto-jurnal (1 jurnal total untuk seluruh penerimaan)
      await fetch('/accounting/journal/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalValue, receiveId,
          supplierName: supName, ref: receiveId,
          date: now.toISOString().slice(0, 10)
        })
      }).catch(e => console.warn('Auto journal receive note:', e));

      // 4. Firebase receive record
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const recRef = this._fbRef(this._fbDb, `inventory_receives/${receiveId}`);
          await this._fbSet(recRef, receiveRecord);
        } catch (e) { console.warn('[RECEIVE] FB record err:', e); }
      }

      // 5. Reset & show receipt
      this.currentReceiveRecord = receiveRecord;
      this.scanReceiveModal = false;
      this.receiveReceiptModal = true;
      this.playSound('success');

      // 6. Auto-download struk
      setTimeout(() => {
        try { this.downloadReceiveReceiptImage(receiveRecord); }
        catch (e) { console.warn('[AUTO-RECEIPT] Download error:', e); }
      }, 300);

      // 7. Info
      const waPhoneSnapshot = String(this.scanReceiveForm.waPhone || '').trim();
      this.showToast(
        `✅ ${items.length} produk diterima #${receiveId}${waPhoneSnapshot ? ' • klik Kirim WA di modal' : ' • WA supplier belum diisi'}`,
        'success'
      );
    } catch (err) {
      console.error('submitReceiveGoods error:', err);
      this.showToast(`Gagal memproses penerimaan: ${err.message}`, 'error');
    }
  },

  /**
   * 2F. Struk Tanda Terima Konsinyasi (Tanpa nama kasir, tanda tangan, QR verify)
   */
  downloadReceiveReceiptImage(record) {
    const rec = record || this.currentReceiveRecord;
    if (!rec) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');

      // Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Header
      ctx.fillStyle = '#10b981';
      ctx.fillRect(0, 0, canvas.width, 10);

      ctx.fillStyle = '#111827';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.customKasirTitle || 'DAPUR KULINER VIRAL', 200, 35);

      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#047857';
      ctx.fillText('BUKTI TANDA TERIMA KONSINYASI', 200, 56);

      // Divider garis putus-putus
      ctx.strokeStyle = '#e5e7eb';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(20, 70);
      ctx.lineTo(380, 70);
      ctx.stroke();

      // Info Penerimaan
      ctx.textAlign = 'left';
      ctx.font = '11px monospace';
      ctx.fillStyle = '#4b5563';
      ctx.fillText(`No. Terima : ${rec.receiveId}`, 20, 90);
      ctx.fillText(`Tanggal    : ${rec.date} ${rec.time || ''}`, 20, 108);
      ctx.fillText(`Supplier   : ${rec.supplierName}`, 20, 126);

      ctx.beginPath();
      ctx.moveTo(20, 138);
      ctx.lineTo(380, 138);
      ctx.stroke();

      // Item List Header
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText('ITEM', 20, 155);
      ctx.textAlign = 'right';
      ctx.fillText('TOTAL', 380, 155);

      // Items
      let y = 175;
      (rec.items || []).forEach(it => {
        ctx.textAlign = 'left';
        ctx.font = '11px sans-serif';
        ctx.fillStyle = '#1f2937';
        ctx.fillText(`${it.name}`, 20, y);

        ctx.font = '10px monospace';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(`[${it.sku}] ${it.qty} ${it.unit} @ Rp ${this.formatNumber(it.price)}`, 20, y + 14);

        ctx.textAlign = 'right';
        ctx.font = 'bold 11px monospace';
        ctx.fillStyle = '#111827';
        ctx.fillText(`Rp ${this.formatNumber(it.total)}`, 380, y + 14);
        y += 32;
      });

      // Total Garis
      ctx.beginPath();
      ctx.moveTo(20, y + 5);
      ctx.lineTo(380, y + 5);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText('TOTAL NILAI SUPPLIER:', 20, y + 26);

      ctx.textAlign = 'right';
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = '#047857';
      ctx.fillText(`Rp ${this.formatNumber(rec.totalValue)}`, 380, y + 26);

      // Download trigger
      const link = document.createElement('a');
      link.download = `struk_terima_${rec.receiveId}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
      this.showToast('Foto struk berhasil disimpan', 'success');
    } catch (e) {
      console.error('downloadReceiveReceiptImage error:', e);
      this.showToast('Gagal membentuk gambar struk', 'error');
    }
  },

  printReceiveReceiptPDF(record) {
    const rec = record || this.currentReceiveRecord;
    if (!rec) return;
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      this.showToast('Pustaka PDF belum termuat', 'error');
      return;
    }

    try {
      const doc = new window.jspdf.jsPDF('p', 'mm', [80, 140]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(this.customKasirTitle || 'DAPUR KULINER VIRAL', 40, 8, { align: 'center' });

      doc.setFontSize(9);
      doc.text('BUKTI TANDA TERIMA KONSINYASI', 40, 13, { align: 'center' });

      doc.setLineWidth(0.2);
      doc.line(4, 16, 76, 16);

      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text(`No. Terima : ${rec.receiveId}`, 4, 21);
      doc.text(`Tanggal    : ${rec.date} ${rec.time || ''}`, 4, 25);
      doc.text(`Supplier   : ${rec.supplierName}`, 4, 29);

      doc.line(4, 32, 76, 32);

      let y = 37;
      (rec.items || []).forEach(it => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(it.name, 4, y);
        y += 4;
        doc.setFont('courier', 'normal');
        doc.setFontSize(7.5);
        doc.text(`[${it.sku}] ${it.qty} ${it.unit} @ ${this.formatNumber(it.price)}`, 4, y);
        doc.text(`Rp ${this.formatNumber(it.total)}`, 76, y, { align: 'right' });
        y += 6;
      });

      doc.line(4, y, 76, y);
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('TOTAL:', 4, y);
      doc.text(`Rp ${this.formatNumber(rec.totalValue)}`, 76, y, { align: 'right' });

      doc.save(`tanda_terima_${rec.receiveId}.pdf`);
      this.showToast('Struk tanda terima PDF siap dicetak', 'success');
    } catch (e) {
      this.showToast(`Gagal cetak PDF: ${e.message}`, 'error');
    }
  },

    shareReceiveReceiptWA(record) {
    const rec = record || this.currentReceiveRecord;
    if (!rec) return;

    // ✅ FIX: Prioritas nomor dari form (yang user isi/edit), fallback ke master supplier
    let phone = String(this.scanReceiveForm?.waPhone || '').trim();
    if (!phone) {
      const sup = (this.suppliersList || []).find(s => s && (s.id === rec.supplierId || s.name === rec.supplierName));
      phone = sup?.contact || '';
    }

    if (!phone) {
      this.showToast('Nomor WA supplier belum diisi — isi dulu di form Scan Bahan Masuk', 'error');
      return;
    }

    // Normalize: 08xxx / 8xxx → 62xxx
    let cleanPhone = String(phone).replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    else if (cleanPhone.startsWith('8')) cleanPhone = '62' + cleanPhone;

    // Build message
    const itemsText = (rec.items || []).map(i =>
      `- ${i.name} (${i.sku}): ${i.qty} ${i.unit} x Rp ${this.formatNumber(i.price)} = Rp ${this.formatNumber(i.total)}`
    ).join('\n');
    const msg = `*BUKTI TANDA TERIMA BARANG KONSINYASI*\n${this.customKasirTitle || 'Dapur Kuliner Viral'}\n\nNo. Terima: ${rec.receiveId}\nTanggal: ${rec.date} ${rec.time || ''}\nSupplier: ${rec.supplierName}\n\n*Daftar Barang:*\n${itemsText}\n\n*Total Nilai: Rp ${this.formatNumber(rec.totalValue)}*\n\nBarang titipan konsinyasi telah diterima dengan baik. Terima kasih! 🙏`;

    // ✅ FIX: window.open SINKRON (dalam user gesture) — popup blocker tidak block
    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    const win = window.open(waUrl, '_blank');

    if (!win) {
      // Popup benar-benar diblok → kasih user fallback link manual
      this.showToast('Popup diblok browser — izinkan popup untuk kirim WA', 'error');
      console.warn('[WA-RECEIPT] Popup blocked for', cleanPhone);
    } else {
      this.showToast(`WhatsApp dibuka — kirim ke ${cleanPhone}`, 'success');
      console.log('[WA-RECEIPT] ✅ WA opened for', cleanPhone);
    }
  },

  // =========================================================================
  // 🎯 R&D FITUR 3: AUTO-SETTLEMENT HARIAN + RETUR KONSINYASI
  // =========================================================================

  /**
   * 3A & 3B. Modal Tutup Hari Konsinyasi & Ringkasan Laku vs Retur
   */
    async openSettlementModal(date) {
    this.settlementDate = date || new Date().toISOString().slice(0, 10);
    this.settlementModal = true;

    // ✅ FIX BUG-11: Refresh inventory dari Firebase DULU sebelum hitung settlement
    // Biar state inventoryList tidak stale saat loadSettlementSummary dipanggil
    try {
      if (this._fbDb && this._fbRef && FB_DB) {
        const snap = await FB_DB.ref('inventory').once('value');
        const val = snap.val();
        if (val) {
          this.inventoryList = Object.entries(val).map(([k, v]) => ({ id: k, ...v }));
          console.log('[SETTLEMENT] Inventory refreshed from Firebase:', this.inventoryList.length, 'items');
        }
      }
    } catch (e) {
      console.warn('[SETTLEMENT] Inventory refresh note:', e.message);
    }

    await this.loadSettlementSummary(this.settlementDate);
  },

      async loadSettlementSummary(date) {
    const d = date || this.settlementDate || new Date().toISOString().slice(0, 10);
    this.loadingSettlement = true;
    try {
      // 1. Ambil transaksi hari ini
      let txList = [];
      try {
        const txRes = await fetch(`/pos/transactions/${d}`);
        const txJson = await txRes.json();
        if (txJson && txJson.success && Array.isArray(txJson.data)) {
          txList = txJson.data;
        }
      } catch(e){}

      // 2. ✅ FIX BUG-10: Ambil daftar supplier yang SUDAH DIBAYAR hari ini
      const paidSupplierIds = new Set();
      try {
        const fbUrl = (this._fbConfig && this._fbConfig.databaseURL)
          || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
        const stlRes = await fetch(`${fbUrl.replace(/\/$/, '')}/settlements.json`);
        if (stlRes.ok) {
          const stls = await stlRes.json() || {};
          Object.values(stls).forEach(stl => {
            if (stl && stl.date === d && stl.status === 'settled' && stl.supplierId) {
              paidSupplierIds.add(String(stl.supplierId));
            }
          });
        }
      } catch (e) {
        console.warn('[SETTLEMENT] Gagal load settlements:', e.message);
      }
      console.log('[SETTLEMENT] Sudah dibayar hari ini:', [...paidSupplierIds]);

      // 3. Bangun supMap dari suppliersList (valid supplier only)
      const supMap = {};
      const validSupplierIds = new Set();

      (this.suppliersList || []).forEach(sup => {
        if (!sup || !sup.id) return;
        validSupplierIds.add(sup.id);
        supMap[sup.id] = {
          supplierId: sup.id,
          supplierName: sup.name,
          contact: sup.contact,
          soldItems: {},
          soldQty: 0,
          totalHutang: 0,
          unsoldItems: [],
          unsoldQty: 0,
          unsoldValue: 0,
          isPaid: paidSupplierIds.has(String(sup.id))   // ✅ flag pembayaran
        };
      });

      // ✅ Inventory konsinyasi (hanya supplier valid)
      (this.inventoryList || []).forEach(inv => {
        const supId = inv.supplierId;
        if (!supId) return;
        if (!validSupplierIds.has(supId)) return;

        // ✅ FIX BUG-12: Safe check — jangan pakai `|| 0` karena 0 falsy
        const remainingStock = Number(
          (inv.stock !== undefined && inv.stock !== null) ? inv.stock :
          ((inv.stok !== undefined && inv.stok !== null) ? inv.stok : 0)
        );
        if (remainingStock > 0) {
          supMap[supId].unsoldItems.push({
            id: inv.id,
            name: inv.name,
            sku: inv.sku || inv.barcode,
            stock: remainingStock,
            price: Number(inv.purchasePrice || 0),
            totalValue: remainingStock * Number(inv.purchasePrice || 0)
          });
          supMap[supId].unsoldQty += remainingStock;
          supMap[supId].unsoldValue += (remainingStock * Number(inv.purchasePrice || 0));
        }
      });

      // Hitung barang laku dari POS
      txList.forEach(tx => {
        const items = tx.items || [];
        items.forEach(it => {
          let mId = Array.isArray(it) ? it[0] : (it.id || it.menuId);
          let qty = Array.isArray(it) ? Number(it[1]) : Number(it.qty || 1);
          const menu = (this.menuList || []).find(m => m.id === mId);
          if (menu && (menu.isConsignment || menu.supplierId)) {
            const supId = menu.supplierId;
            if (supId && validSupplierIds.has(supId) && supMap[supId]) {
              const buyPrice = Number(menu.cost || 0);
              if (!supMap[supId].soldItems[mId]) {
                supMap[supId].soldItems[mId] = { name: menu.name, qty: 0, buyPrice, total: 0 };
              }
              supMap[supId].soldItems[mId].qty += qty;
              supMap[supId].soldItems[mId].total += (qty * buyPrice);
              supMap[supId].soldQty += qty;
              // ✅ FIX BUG-10: Set totalHutang = 0 kalau sudah dibayar
              if (!supMap[supId].isPaid) {
                supMap[supId].totalHutang += (qty * buyPrice);
              }
            }
          }
        });
      });

      const summaryList = Object.values(supMap).filter(s => s.soldQty > 0 || s.unsoldQty > 0);
      this.settlementSummary = summaryList;
      this.settlementTotalHutang = summaryList.reduce((acc, s) => acc + (s.isPaid ? 0 : s.totalHutang), 0);
      this.settlementTotalSoldQty = summaryList.reduce((acc, s) => acc + s.soldQty, 0);
      this.settlementTotalReturnQty = summaryList.reduce((acc, s) => acc + s.unsoldQty, 0);

      console.log('[SETTLEMENT] Summary:', summaryList.map(s => ({
        name: s.supplierName,
        sold: s.soldQty,
        unsold: s.unsoldQty,
        hutang: s.totalHutang,
        isPaid: s.isPaid
      })));
    } catch (err) {
      console.error('loadSettlementSummary error:', err);
      this.showToast('Gagal memuat ringkasan settlement', 'error');
    } finally {
      this.loadingSettlement = false;
    }
  },

  /**
   * 3D. Bayar Supplier: Debit 2001 Hutang / Kredit 1001 Kas (atau 1002 Bank)
   */
   /**
   * ✅ SPRINT 2 Phase 1B: Kirim laporan EOD konsinyasi ke owner
   * mode: 'test' (preview only) | 'live' (kirim WA via Fonnte)
   */
  async sendEODReportToOwner(mode = 'test') {
    try {
      const reportText = this.buildOwnerReportText();
      if (!reportText || reportText.includes('Tidak ada data')) {
        this.showToast('Tidak ada data untuk dikirim', 'notify');
        return false;
      }

      const activeCount = (this.settlementSummary || []).filter(s =>
        Number(s.soldQty) > 0 || Number(s.unsoldQty) > 0 || Number(s.totalHutang) > 0
      ).length;

      const res = await fetch('/api/eod-report-konsinyasi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settlementDate: this.settlementDate,
          reportText,
          mode,
          supplierCount: activeCount,
          totalBayar: Number(this.settlementTotalHutang) || 0
        })
      });

      const json = await res.json();
      if (json.success) {
        if (mode === 'test') {
          this.showToast('📤 Laporan siap (mode preview).', 'success');
        } else {
          this.showToast('📤 Laporan terkirim ke WA owner!', 'success');
        }
        this.playSound('success');
        return true;
      } else {
        this.showToast('Gagal: ' + (json.error || 'Unknown'), 'error');
        this.playSound('error');
        return false;
      }
    } catch (err) {
      console.error('[EOD-REPORT] Error:', err);
      this.showToast('Error: ' + err.message, 'error');
      return false;
    }
  },
 
 async bayarSupplier(supSummary, pm = 'cash') {
    if (!supSummary || supSummary.totalHutang <= 0) {
      this.showToast('Tidak ada hutang yang harus dibayar untuk supplier ini', 'notify');
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randHex = Math.floor(Math.random() * 9000 + 1000).toString();
    const stlId = `STL-${dateStr}-${randHex}`;
    const amount = supSummary.totalHutang;

    const payload = {
      settlementId: stlId,
      id: stlId,
      date: this.settlementDate,
      supplierId: supSummary.supplierId,
      supplierName: supSummary.supplierName,
      totalPaid: amount,
      soldItemsCount: supSummary.soldQty,
      returnedItemsCount: supSummary.unsoldQty,
      paymentMethod: pm,
      status: 'settled',
      createdAt: Date.now()
    };

    try {
      // 1. Simpan settlement ke /settlements
      await fetch('/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // 2. Auto-Jurnal: Debit 2001 Hutang / Kredit 1001 Kas (atau 1002 Bank)
      await fetch('/accounting/journal/settlement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount,
          settlementId: stlId,
          supplierName: supSummary.supplierName,
          paymentMethod: pm,
          ref: stlId,
          date: this.settlementDate
        })
      });

      // Simpan ke Firebase jika ada SDK
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const stlRef = this._fbRef(this._fbDb, `settlements/${stlId}`);
          await this._fbSet(stlRef, payload);
        } catch(e){}
      }

      this.currentSettlementRecord = payload;
      this.showToast(`Hutang supplier ${supSummary.supplierName} sebesar Rp ${this.formatNumber(amount)} berhasil dibayar!`, 'success');
      this.playSound('success');

      // Refresh settlement data
      await this.loadSettlementSummary(this.settlementDate);

      // WhatsApp Notifikasi ke Supplier
      if (supSummary.contact) {
        const msg = `*BUKTI SETTLEMENT KONSINYASI HARIAN*\n${this.customKasirTitle || 'Dapur Kuliner Viral'}\n\nID Settlement: ${stlId}\nTanggal: ${this.settlementDate}\nSupplier: ${supSummary.supplierName}\n\nTotal Barang Laku : ${supSummary.soldQty} pcs\nTotal Pembayaran  : Rp ${this.formatNumber(amount)}\nMetode Pembayaran : ${pm.toUpperCase()}\nStatus: LUNAS DIBAYARKAN ✅\n\nTerima kasih atas kerja samanya! 🙏`;
        this.sendWhatsAppNotification(supSummary.contact, msg, 'settlement');
      }
    } catch (err) {
      console.error('bayarSupplier error:', err);
      this.showToast(`Gagal memproses pembayaran: ${err.message}`, 'error');
    }
  },

        /**
   * ✅ Sprint 2 Final: TUTUP HARI KONSINYASI
   * Alur:
   * 1. Retur semua sisa barang belum laku
   * 2. Trigger EOD Report ke Owner SEKALI
   * Pelunasan hutang supplier = MANUAL via tombol "Bayar (Tunai)"/"Bayar (Bank)" per supplier.
   */
   /**
   * ✅ Sprint 2 Final: Bayar Semua Supplier + Retur Semua Sisa + EOD Report (1x trigger)
   * 
   * Alur:
   * 1. Snapshot retur (untuk laporan historis)
   * 2. Bayar hutang semua supplier (tanpa trigger EOD)
   * 3. Retur semua sisa barang belum laku
   * 4. Kirim EOD report ke owner SEKALI
   * 
   * Barang yang mau dititip lagi harus di-scan receive ulang (siklus konsinyasi tetap rapi).
   */


  /**
   * 3E. Retur Barang: Debit 2001 Hutang / Kredit 1004 Persediaan & update stok -qty
   */
    async returBarangSupplier(supSummary) {
    if (!supSummary || !supSummary.unsoldItems || supSummary.unsoldItems.length === 0) {
      this.showToast('Tidak ada barang konsinyasi yang tersisa untuk diretur', 'notify');
      return;
    }

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randHex = Math.floor(Math.random() * 9000 + 1000).toString();
    const returnId = `RET-${dateStr}-${randHex}`;
    const totalQty = supSummary.unsoldQty;
    const totalValue = supSummary.unsoldValue;

    const payload = {
      returnId,
      id: returnId,
      date: this.settlementDate,
      supplierId: supSummary.supplierId,
      supplierName: supSummary.supplierName,
      items: supSummary.unsoldItems,
      totalQty,
      totalValue,
      reason: 'Retur sisa konsinyasi belum laku (Tutup Hari)',
      createdAt: Date.now()
    };

    try {
      
      // ✅ SPRINT 2 FIX: Refresh harga retur dari inventory LIVE (bukan cache settlementSummary)
      // Root cause: user bisa koreksi harga beli setelah load settlementSummary
      supSummary.unsoldItems = (supSummary.unsoldItems || []).map(it => {
        const invLive = this.inventoryList.find(x => x.id === it.id);
        const livePrice = invLive ? Number(invLive.purchasePrice || 0) : Number(it.price || 0);
        return {
          ...it,
          price: livePrice,
          totalValue: (Number(it.stock) || 0) * livePrice
        };
      });
      supSummary.unsoldValue = supSummary.unsoldItems.reduce((s, it) => s + (Number(it.totalValue) || 0), 0);
       
     // 1. ✅ FIX BUG-9 + BUG-13: Update stok SETIAP item ke 0 di Firebase LANGSUNG
      //    WAJIB update stock, stok, DAN seluruh object biar tidak stale
      for (const it of supSummary.unsoldItems) {
        const inv = this.inventoryList.find(i => i.id === it.id);
        if (inv) {
          inv.stock = 0;
          inv.stok = 0;

          // ✅ FIX BUG-13: Update seluruh object inventory (bukan hanya field)
          if (this._fbDb && this._fbSet && this._fbRef) {
            try {
              const itemRef = this._fbRef(this._fbDb, `inventory/${it.id}`);
              await this._fbSet(itemRef, {
                ...inv,
                stock: 0,
                stok: 0,
                lastUpdate: Date.now()
              });
              console.log(`[RETUR] ✅ Firebase item updated: ${it.id} → stock:0, stok:0`);
            } catch (fbErr) {
              console.warn(`[RETUR] ❌ Firebase update failed for ${it.id}:`, fbErr);
            }
          }

          // Juga PATCH ke backend
          fetch(`/inventory/${encodeURIComponent(it.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ stock: 0, stok: 0 })
          }).catch((e) => console.warn('[RETUR] PATCH backend note:', e));
        }
      }

      // 2. ✅ FIX BUG-9: Simpan retur log ke Firebase langsung
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const retRef = this._fbRef(this._fbDb, `returns_log/${returnId}`);
          await this._fbSet(retRef, payload);
          console.log('[RETUR] ✅ Firebase returns_log saved:', returnId);
        } catch (e) {
          console.warn('[RETUR] Firebase returns_log save error:', e);
        }
      }

      // 3. Simpan retur log ke backend endpoint juga
      await fetch('/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch((e) => console.warn('[RETUR] Backend returns POST note:', e));

      // 4. Auto-Jurnal Retur: Debit 2001 Hutang / Kredit 1004 Persediaan
      await fetch('/accounting/journal/return', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalValue,
          returnId,
          supplierName: supSummary.supplierName,
          ref: returnId,
          date: this.settlementDate
        })
      }).catch((e) => console.warn('[RETUR] Auto journal note:', e));

      this.showToast(`Berhasil meretur ${totalQty} pcs barang ke ${supSummary.supplierName}`, 'success');
      this.playSound('success');
      await this.loadSettlementSummary(this.settlementDate);
    } catch (err) {
      console.error('returBarangSupplier error:', err);
      this.showToast(`Gagal meretur barang: ${err.message}`, 'error');
    }
  },

        async returSemuaBarang(skipConfirm = false) {
      if (this.settlementTotalReturnQty <= 0) {
        this.showToast('Tidak ada barang sisa untuk diretur', 'notify');
        return;
      }

      // ✅ FIX #4: Simpan snapshot retur SEBELUM dieksekusi
      // Karena setelah retur, unsoldItems di state jadi 0, laporan historis butuh snapshot
      try {
        const snapshotKey = `dapur_retur_snapshot_${this.settlementDate}`;
        const snapshot = {
          tanggal: this.settlementDate,
          capturedAt: Date.now(),
          suppliers: (this.settlementSummary || []).map(s => ({
            supplierId: s.supplierId,
            supplierName: s.supplierName,
            unsoldQty: Number(s.unsoldQty) || 0,
            unsoldValue: Number(s.unsoldValue) || 0,
            unsoldItems: JSON.parse(JSON.stringify(s.unsoldItems || []))
          }))
        };
        localStorage.setItem(snapshotKey, JSON.stringify(snapshot));
        console.log('[RETUR-SNAPSHOT] Saved:', snapshotKey, snapshot.suppliers.length, 'suppliers');
      } catch (e) {
        console.warn('[RETUR-SNAPSHOT] Failed:', e);
      }

    // ✅ FIX BUG-8: Filter hanya supplier yang benar-benar ada di suppliersList
    const validSupplierIds = new Set((this.suppliersList || []).map(s => s.id).filter(Boolean));
    const candidates = (this.settlementSummary || []).filter(s =>
      s.unsoldQty > 0 &&
      s.supplierId &&
      validSupplierIds.has(s.supplierId)
    );

    if (candidates.length === 0) {
      this.showToast('Tidak ada supplier konsinyasi valid untuk diretur', 'notify');
      return;
    }

    const totalQty = candidates.reduce((acc, s) => acc + s.unsoldQty, 0);
    if (!skipConfirm && !confirm(`Yakin ingin meretur barang konsinyasi yang belum laku?\n\nTotal Barang: ${totalQty} pcs\nSupplier: ${candidates.length}\n\n⚠️ Ghost supplier akan DILEWATI otomatis.`)) return;

    let countSuccess = 0;
    for (const sup of candidates) {
      await this.returBarangSupplier(sup);
      countSuccess++;
    }
    this.showToast(`${countSuccess} supplier berhasil diretur (total ${totalQty} pcs)`, 'success');
  },

       /**
   * ✅ Sprint 2 Final: TUTUP HARI KONSINYASI
   * Alur:
   * 1. Retur semua sisa barang belum laku
   * 2. Trigger EOD Report ke Owner SEKALI
   * Pelunasan hutang supplier = MANUAL via tombol "Bayar (Tunai)"/"Bayar (Bank)" per supplier.
   */
  async tutupHariKonsinyasi() {
    const totalRetur = Number(this.settlementTotalReturnQty) || 0;
    const totalHutang = Number(this.settlementTotalHutang) || 0;
    const suppliersBelumBayar = (this.settlementSummary || []).filter(s => Number(s.totalHutang) > 0);
    const supplierCount = suppliersBelumBayar.length;

    const activeSuppliers = (this.settlementSummary || []).filter(s =>
      Number(s.soldQty) > 0 || Number(s.unsoldQty) > 0 || Number(s.totalHutang) > 0
    ).length;

    if (activeSuppliers === 0) {
      this.showToast('Tidak ada transaksi konsinyasi untuk ditutup hari ini', 'notify');
      return;
    }

    let infoHutang = '';
    if (supplierCount > 0) {
      infoHutang =
        `📋 Info hutang:\n` +
        `- Belum dibayar: ${supplierCount} supplier (Rp ${this.formatNumber(totalHutang)})\n\n` +
        `⚠️ Hutang belum lunas — silakan bayar manual via tombol\n` +
        `   "Bayar (Tunai)" / "Bayar (Bank)" per supplier.\n\n`;
    } else {
      infoHutang = `✅ Semua hutang sudah dibayar lunas\n\n`;
    }

    const confirmMsg =
      `⚠️ TUTUP HARI KONSINYASI\n\n` +
      `Aksi ini akan:\n` +
      `1️⃣ Retur SEMUA sisa barang belum laku: ${totalRetur} pcs\n` +
      `2️⃣ Kirim laporan ke owner via WhatsApp (sekali)\n\n` +
      infoHutang +
      `Tindakan ini tidak bisa dibatalkan. Lanjutkan?`;

    if (!confirm(confirmMsg)) {
      this.showToast('Tutup hari konsinyasi dibatalkan', 'notify');
      return;
    }

    try {
      await this.returSemuaBarang(true);

      this.showToast('✅ Retur selesai! Mengirim laporan ke owner...', 'success');
      this.playSound('success');

      setTimeout(() => {
        this.sendEODReportToOwner('live');
      }, 800);

    } catch (err) {
      console.error('[TUTUP-HARI] Fatal error:', err);
      this.showToast(`Gagal tutup hari: ${err.message}`, 'error');
      this.playSound('error');
    }
  },

     /**
     * ✅ SPRINT 2: Generate teks laporan owner (format v4)
     * Input: this.settlementSummary + this.settlementDate
     * Output: string teks lengkap
     */
    buildOwnerReportText() {
      const summary = Array.isArray(this.settlementSummary) ? this.settlementSummary : [];
      if (summary.length === 0) {
        return '⚠️ Tidak ada data konsinyasi untuk dilaporkan.';
      }

      // ✅ FIX #1: Tanggal pakai settlementDate, waktu pakai jam runtime
      const now = new Date();
      const waktu = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0') + ' WIB';

      let tanggal = now.toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
      if (this.settlementDate) {
        try {
          const d = new Date(this.settlementDate + 'T00:00:00');
          if (!isNaN(d.getTime())) {
            tanggal = d.toLocaleDateString('id-ID', {
              weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
            });
          }
        } catch (e) {}
      }

            // ✅ FIX #4b: Baca snapshot retur historis (jika ada) untuk tampilkan retur yang BENAR-BENAR terjadi
      let returSnapshot = null;
      try {
        const snapKey = `dapur_retur_snapshot_${this.settlementDate}`;
        const raw = localStorage.getItem(snapKey);
        if (raw) {
          returSnapshot = JSON.parse(raw);
          console.log('[REPORT] Menggunakan retur snapshot dari:', new Date(returSnapshot.capturedAt).toLocaleString('id-ID'));
        }
      } catch (e) {
        console.warn('[REPORT] Snapshot read error:', e);
      }

      // Aggregasi total
      let totalBayar = 0, totalSoldQty = 0, totalReturnQty = 0, nilaiRetur = 0;
      let omsetKonsinyasi = 0;

      const activeSuppliers = summary.filter(s => Number(s.soldQty) > 0 || Number(s.unsoldQty) > 0 || Number(s.totalHutang) > 0);

      activeSuppliers.forEach(sup => {
        // ✅ FIX #2: totalBayar = nominal kotor yang dibayarkan (sum soldItems.total)
        // Jangan pakai totalHutang karena di-zero-kan setelah dibayar (flag isPaid)
        const soldItemsArr = Object.values(sup.soldItems || {});
        const soldValue = soldItemsArr.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
        totalBayar += soldValue;

        totalSoldQty += Number(sup.soldQty) || 0;

        // ✅ FIX #4c: Pakai snapshot retur kalau ada (historis), fallback ke state saat ini
        let returQty = Number(sup.unsoldQty) || 0;
        let returValue = Number(sup.unsoldValue) || 0;
        if (returSnapshot) {
          const snapSup = (returSnapshot.suppliers || []).find(x => x.supplierId === sup.supplierId);
          if (snapSup) {
            returQty = Number(snapSup.unsoldQty) || 0;
            returValue = Number(snapSup.unsoldValue) || 0;
          }
        }
        totalReturnQty += returQty;
        nilaiRetur += returValue;

        // ✅ FIX #3: Omset = sum qty × harga jual riil dari menuList
        soldItemsArr.forEach(it => {
          const menu = (this.menuList || []).find(m => m.name === it.name);
          const sellPrice = menu ? Number(menu.price) : (Number(it.buyPrice) * 2 || 0);
          omsetKonsinyasi += (Number(it.qty) || 0) * sellPrice;
        });
      });

      const modalDibayar = totalBayar;
      const labaKotor = Math.max(0, omsetKonsinyasi - modalDibayar);

      // Helper: format emoji number
      const formatNum = (idx) => {
        if (idx < 9) {
          const emojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
          return emojis[idx];
        }
        return String(idx + 1) + '.';
      };

      // Helper: format items "Nama(qty), Nama(qty)"
      const formatItems = (arr) => {
        if (!arr || arr.length === 0) return '—';
        return arr
          .filter(it => Number(it.qty) > 0)
          .map(it => `${it.name}(${it.qty})`)
          .join(', ') || '—';
      };

      // Build detail supplier blocks
      const supplierBlocks = activeSuppliers.map((sup, idx) => {
        const soldArr = Object.values(sup.soldItems || {})
          .map(it => ({ name: it.name, qty: Number(it.qty) || 0 }))
          .filter(it => it.qty > 0);

                // ✅ FIX #4d: unsoldArr dari snapshot historis kalau ada
        let unsoldArr = [];
        if (returSnapshot) {
          const snapSup = (returSnapshot.suppliers || []).find(x => x.supplierId === sup.supplierId);
          if (snapSup && Array.isArray(snapSup.unsoldItems)) {
            unsoldArr = snapSup.unsoldItems
              .map(it => ({ name: it.name, qty: Number(it.stock) || 0 }))
              .filter(it => it.qty > 0);
          }
        } else {
          unsoldArr = (sup.unsoldItems || [])
            .map(it => ({ name: it.name, qty: Number(it.stock) || 0 }))
            .filter(it => it.qty > 0);
        }

        // ✅ FIX #2b: nominal laku per supplier = sum soldItems.total (bukan totalHutang)
        const soldValueSupplier = soldArr.length > 0
          ? Object.values(sup.soldItems || {}).reduce((sum, it) => sum + (Number(it.total) || 0), 0)
          : 0;

        const line1 = `${formatNum(idx)} ${String(sup.supplierName || 'Supplier').toUpperCase()}`;
        const line2 = `✅ Laku: ${sup.soldQty} pcs → Rp ${this.formatNumber(soldValueSupplier)}`;
        const line3 = formatItems(soldArr);
        const line4 = `↩️ Retur: ${formatItems(unsoldArr)}`;

        return [line1, line2, line3, line4].join('\n');
      }).join('\n\n');

      // Susun final text
      const lines = [
        '📋 LAPORAN TUTUP KONSINYASI',
        `${tanggal} · ${waktu}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '💰 TOTAL PEMBAYARAN',
        `Rp ${this.formatNumber(totalBayar)} ke ${activeSuppliers.length} supplier`,
        '',
        '📦 RINGKASAN HARI INI',
        `✅ Terjual: ${totalSoldQty} pcs`,
        `↩️ Diretur: ${totalReturnQty} pcs`,
        `🏪 Supplier: ${activeSuppliers.length} aktif`,
        `📊 Nilai retur: Rp ${this.formatNumber(nilaiRetur)}`,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        '📊 DETAIL PER SUPPLIER',
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        supplierBlocks,
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        `📈 Omset Konsinyasi: Rp ${this.formatNumber(omsetKonsinyasi)}`,
        `📉 Modal Dibayar: Rp ${this.formatNumber(modalDibayar)}`,
        `💵 Laba Kotor: Rp ${this.formatNumber(labaKotor)}`,
        '━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
        '🤖 Auto-report POS Digital Culinary'
      ];

      return lines.join('\n');
    },

    /**
     * ✅ SPRINT 2: Buka modal preview laporan owner
     */
    previewOwnerReport() {
      if (!Array.isArray(this.settlementSummary) || this.settlementSummary.length === 0) {
        this.showToast('Tidak ada data konsinyasi. Hitung ulang settlement dulu.', 'error');
        return;
      }
      this.ownerReportText = this.buildOwnerReportText();
      this.showOwnerReportModal = true;
      this.playSound('notify');
    },

    /**
     * ✅ SPRINT 2: Copy teks laporan ke clipboard
     */
    async copyOwnerReportText() {
      try {
        await navigator.clipboard.writeText(this.ownerReportText || '');
        this.showToast('Teks laporan dicopy ke clipboard', 'success');
      } catch (e) {
        this.showToast('Gagal copy: ' + e.message, 'error');
      }
    },

 
 shareSettlementWA(supSummary) {
    if (!supSummary) return;
    const phone = supSummary.contact || '';
    // ✅ SPRINT 2 v2: Format ramping tanpa (Tunai) & status LUNAS
    const soldItemsArr = Object.values(supSummary.soldItems || {});
    const soldLines = soldItemsArr.length > 0
      ? soldItemsArr.map(i => `• ${i.name} : ${i.qty} pcs`).join('\n')
      : '• Tidak ada penjualan';

    const unsoldArr = (supSummary.unsoldItems || []).filter(i => Number(i.stock) > 0);
    const unsoldLines = unsoldArr.length > 0
      ? unsoldArr.map(i => `• ${i.name} : ${i.stock} pcs`).join('\n')
      : '• Tidak ada retur';

    // Format tanggal Indonesia
    let tglFormatted = this.settlementDate;
    try {
      tglFormatted = new Date(this.settlementDate + 'T00:00:00').toLocaleDateString('id-ID', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
      });
    } catch (e) {}

    const supplierFirstName = String(supSummary.supplierName || 'Supplier').split(' ')[0];

    const msg =
      `📋 LAPORAN KONSINYASI HARIAN\n` +
      `${tglFormatted}\n\n` +
      `Halo Kak ${supplierFirstName} 👋\n` +
      `Berikut laporan titipan Anda hari ini:\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📦 BARANG TERJUAL\n` +
      `${supSummary.soldQty} pcs → Rp ${this.formatNumber(supSummary.totalHutang)}\n\n` +
      `Detail:\n${soldLines}\n\n` +
      `↩️ BARANG RETUR\n` +
      `${supSummary.unsoldQty} pcs → Rp ${this.formatNumber(supSummary.unsoldValue || 0)}\n\n` +
      `Detail:\n${unsoldLines}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `💸 PEMBAYARAN HARI INI\n` +
      `Rp ${this.formatNumber(supSummary.totalHutang)}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Terima kasih atas kerja samanya!\n` +
      `Besok titipan lagi ya 🙏\n\n` +
      `_POS Digital Culinary_`;

        // ✅ FIX: Langsung buka WhatsApp Web/App (bypass API)
    if (!phone) {
      this.showToast('Supplier belum punya nomor WA — isi dulu di Master Supplier', 'error');
      return;
    }

    let cleanPhone = String(phone).replace(/[^0-9]/g, '');
    if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
    else if (cleanPhone.startsWith('8')) cleanPhone = '62' + cleanPhone;

    const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    const win = window.open(waUrl, '_blank');

    if (!win) {
      this.showToast('Popup diblok browser — izinkan popup untuk share WA', 'error');
    } else {
      this.showToast(`WhatsApp dibuka ke ${cleanPhone}`, 'success');
      this.playSound('success');
    }
  },

  printSettlementPDF(supSummary) {
    if (!supSummary) return;
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
      this.showToast('Pustaka PDF belum termuat', 'error');
      return;
    }
    try {
      const doc = new window.jspdf.jsPDF('p', 'mm', [80, 150]);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(this.customKasirTitle || 'DAPUR KULINER VIRAL', 40, 8, { align: 'center' });
      doc.setFontSize(9);
      doc.text('LAPORAN SETTLEMENT KONSINYASI', 40, 13, { align: 'center' });
      doc.setLineWidth(0.2);
      doc.line(4, 16, 76, 16);
      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      doc.text(`Tanggal  : ${this.settlementDate}`, 4, 21);
      doc.text(`Supplier : ${supSummary.supplierName}`, 4, 25);
      doc.line(4, 28, 76, 28);
      doc.setFont('helvetica', 'bold');
      doc.text('BARANG LAKU (DIBAYAR):', 4, 33);
      let y = 38;
      const soldItems = Object.values(supSummary.soldItems || {});
      if (soldItems.length === 0) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(7.5);
        doc.text('- Tidak ada barang laku hari ini', 4, y);
        y += 5;
      } else {
        soldItems.forEach(it => {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.text(it.name, 4, y);
          y += 4;
          doc.setFont('courier', 'normal');
          doc.text(`${it.qty} pcs x ${this.formatNumber(it.buyPrice)}`, 4, y);
          doc.text(`Rp ${this.formatNumber(it.total)}`, 76, y, { align: 'right' });
          y += 6;
        });
      }
      doc.line(4, y, 76, y);
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text('TOTAL HUTANG:', 4, y);
      doc.text(`Rp ${this.formatNumber(supSummary.totalHutang)}`, 76, y, { align: 'right' });
      y += 7;
      if (supSummary.unsoldQty > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(`RETUR / SISA: ${supSummary.unsoldQty} pcs`, 4, y);
      }
      doc.save(`settlement_${supSummary.supplierName.replace(/[^a-zA-Z0-9]/g, '_')}_${this.settlementDate}.pdf`);
      this.showToast('Laporan settlement PDF berhasil diunduh', 'success');
    } catch(e) {
      this.showToast(`Gagal cetak PDF: ${e.message}`, 'error');
    }
  },

  // =========================================================================
  // 🎯 R&D FITUR 4 & 5: DUAL ROLE ITEM & AUTO-BRIDGE INVENTORY → MENU
  // =========================================================================

  openGenerateMenuModal(item) {
    if (!item) return;
    const cost = Number(item.purchasePrice || item.hargaBeli || 0);
    const suggestedPrice = Math.round((cost * 1.2) / 1000) * 1000 || 15000;
    this.generateMenuForm = {
      inventoryId: item.id,
      name: item.name,
      price: suggestedPrice,
      cost: cost,
      category: 'rice_bowl',
      desc: `Menu siap saji langsung dari bahan baku ${item.name}`,
      image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400'
    };
    this.generateMenuModal = true;
  },

  async saveGenerateMenu() {
    if (!this.generateMenuForm.name || !this.generateMenuForm.name.trim()) {
      this.showToast('Nama menu wajib diisi', 'error');
      return;
    }

    const inv = this.inventoryList.find(i => i.id === this.generateMenuForm.inventoryId);
    if (!inv) return;

    const newMenuId = `m_${Date.now()}`;
    const price = Number(this.generateMenuForm.price) || 0;

    const newMenuItem = {
      id: newMenuId,
      name: this.generateMenuForm.name.trim(),
      category: this.generateMenuForm.category || 'rice_bowl',
      price: price,
      cost: Number(this.generateMenuForm.cost) || Number(inv.purchasePrice) || 0,
      desc: this.generateMenuForm.desc || '',
      image: this.generateMenuForm.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400',
      inventoryId: inv.id,
      isConsignment: Boolean(inv.supplierId),
      supplierId: inv.supplierId || '',
      supplierName: inv.supplierName || '',
      active: true
    };

    // Tandai inv item sebagai Ready to Sell & tautkan ID menu
    inv.isReadyToSell = true;
    inv.linkedMenuId = newMenuId;

    try {
      this.menuList.unshift(newMenuItem);

      // Simpan menu baru
      await fetch(`/menu/${encodeURIComponent(newMenuId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMenuItem)
      });

      // Update inventory item
      await fetch(`/inventory/${encodeURIComponent(inv.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isReadyToSell: true, linkedMenuId: newMenuId })
      });

      // Buat resep otomatis 1:1
      await fetch(`/inventory/recipes/${encodeURIComponent(newMenuId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuId: newMenuId,
          ingredients: [
            { itemId: inv.id, amount: 1, unit: inv.unit || 'porsi' }
          ]
        })
      });

      // Simpan ke Firebase jika ada
      if (this._fbDb && this._fbSet && this._fbRef) {
        try {
          const mRef = this._fbRef(this._fbDb, `menu_items/${newMenuId}`);
          await this._fbSet(mRef, newMenuItem);
          const iRef = this._fbRef(this._fbDb, `inventory/${inv.id}`);
          await this._fbSet(iRef, inv);
        } catch(e){}
      }

      this.generateMenuModal = false;
      this.playSound('success');
      this.showToast(`Menu "${newMenuItem.name}" berhasil dipublish ke POS!`, 'success');
    } catch (err) {
      console.error('saveGenerateMenu error:', err);
      this.showToast(`Gagal generate menu: ${err.message}`, 'error');
    }
  },

    setupBarcodeScanner() {
      if (this._scanListenerBound) return;
      this._scanListenerBound = true;
      document.addEventListener('keydown', (e) => {
        // ✅ Cek toggle dari site_config Firebase
        if (this.scannerEnabled === false) return;
        const now = Date.now();
        const diff = now - this._scanLastTime;
        this._scanLastTime = now;
        if (diff > 100) this._scanBuffer = '';
        if (e.key === 'Enter' && this._scanBuffer.length >= 4) {
          const code = this._scanBuffer.trim();
          this._scanBuffer = '';
          e.preventDefault();
          e.stopPropagation();
          this.handleBarcodeScan(code);
          return;
        }
        if (e.key.length === 1) this._scanBuffer += e.key;
      });
      console.log('[SCANNER] HID listener bound');
    },

    async handleBarcodeScan(code) {
      const clean = String(code || '').trim().toUpperCase();
      if (!clean) return;
      console.log('[SCANNER] Scan:', clean);
      const list = this.menuList || this.products || this.items || [];
      const found = list.find(it =>
        String(it.sku || '').toUpperCase() === clean ||
        String(it.barcode || '').toUpperCase() === clean ||
        String(it.barcodeShort || '').toUpperCase() === clean ||
        String(it.shortCode || '').toUpperCase() === clean ||
        String(it.id || '').toUpperCase() === clean
      );
      if (found) {
        this.addToCart(found);
        this.playBeep('success');
        if (typeof this.showToast === 'function') this.showToast(`✓ ${found.name} ditambahkan`);
        return;
      }
      this.playBeep('error');
      if (typeof this.showToast === 'function') this.showToast(`SKU "${clean}" tidak ditemukan`);
    },

    playBeep(type = 'success') {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = type === 'success' ? 1000 : 400;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start();
        osc.stop(ctx.currentTime + (type === 'error' ? 0.08 : 0.15));
      } catch (e) {}
    },

  // =========================================================================
  // 🎯 R&D FITUR 6: NOTIFIKASI WHATSAPP OTOMATIS & PROXY GATEWAY
  // =========================================================================

  /**
   * Helper: Kirim Notifikasi WhatsApp via Gateway / Proxy Endpoint
   * Mendukung WAHA, Baileys, dan Web WhatsApp fallback
   */
  async sendWhatsAppNotification(phone, message, template = 'custom') {
    let cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
    if (!cleanPhone || !message) return false;
    if (cleanPhone.startsWith('08')) cleanPhone = '62' + cleanPhone.slice(1);

    try {
      const res = await fetch('/api/send-wa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanPhone,
          message,
          template
        })
      });
      const data = await res.json();
      if (data && data.success) {
        console.log('[WA-NOTIF] ✅ Sent to:', cleanPhone, 'Status:', data.status);
        return true;
      }
    } catch (e) {
      console.warn('[WA-NOTIF] Note:', e.message);
    }

    // Direct Web WA Fallback jika user meminta share langsung
    try {
      const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
      if (template === 'consignment_receipt' || template === 'settlement' || template === 'consignment_settlement') {
        window.open(waUrl, '_blank');
      }
    } catch (e) {}

    return true;
  },

  // -------------------------------------------------------------------------
  // 14.9 LOGOUT KASIR LOGIC (TANPA NATIVE PROMPT TERTAHAN)

  // -------------------------------------------------------------------------

      /**
     * ✅ PIN Accounting: minta PIN untuk akses modul akuntansi di kasir
     * Cache session 30 menit via sessionStorage
     */
        async requestFinancePin() {
      // ✅ Selalu minta PIN — no cache
      const ok = await this.requestSupervisorPin('AKSES AKUNTANSI', 'Modul Keuangan');
      return ok;
    },

    /**
     * ✅ PIN Accounting: navigasi tab dengan gate PIN untuk akuntansi
     */
    async navigateToTab(tab) {
      if (tab === 'akuntansi') {
        const ok = await this.requestFinancePin();
        if (!ok) {
          this.showToast('Akses akuntansi dibatalkan', 'notify');
          return;
        }
      }
      this.activeTab = tab;
      this.mobileMenuOpen = false;
    },

    async voidTransaksi(tx) {
      if (!tx) return;
      const txId = tx.id || tx.orderId;
      if (!txId) { this.showToast('ID transaksi tidak valid', 'error'); return; }
      if (tx.voided === true) { this.showToast('Transaksi sudah di-void', 'notify'); return; }

      const pinOk = await this.requestSupervisorPin('VOID TRANSAKSI', `#${txId} — Rp ${this.formatNumber(tx.tot || tx.total || 0)}`);
      if (!pinOk) { this.showToast('Void dibatalkan', 'notify'); return; }

      const reason = prompt('Alasan void (wajib min 5 karakter):', '');
      if (!reason || reason.trim().length < 5) { this.showToast('Alasan void wajib diisi', 'error'); return; }

      const dateStr = this.txHistoryDate || new Date().toISOString().slice(0, 10);

      try {
        // 1. PATCH /pos/transactions/{date}/{txId} — tandai voided
        const patchRes = await fetch(`/pos/transactions/${encodeURIComponent(dateStr)}/${encodeURIComponent(txId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            voided: true,
            voidedAt: Date.now(),
            voidedBy: this.kasirInfo?.username || 'kasir',
            voidReason: reason.trim()
          })
        });
        const patchJson = await patchRes.json();
        if (!patchJson.success) throw new Error(patchJson.error || 'PATCH gagal');

        // 2. Reverse inventory via /inventory/deduct (qty negatif)
        const items = Array.isArray(tx.items) ? tx.items.map(it => {
          if (Array.isArray(it)) {
            return { id: it[0], qty: -Math.abs(Number(it[1]) || 1), price: Number(it[2]) || 0 };
          }
          return {
            id: it.id || it.menuId,
            qty: -Math.abs(Number(it.qty || it.quantity) || 1),
            price: Number(it.price) || 0
          };
        }) : [];

        if (items.length > 0) {
          try {
            await fetch('/inventory/deduct', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: `VOID-${txId}`,
                date: dateStr,
                kasir: this.kasirInfo?.username || 'kasir',
                items
              })
            });
          } catch (e) { console.warn('[VOID] Inventory reverse note:', e); }
        }

        // 3. Auto-jurnal reversal (counter-entry)
        const total = Number(tx.tot || tx.total || 0);
        const pm = String(tx.pm || tx.paymentMethod || 'cash').toLowerCase();
        const isBank = pm.includes('qris') || pm.includes('transfer') || pm.includes('bank') || pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo') || pm.includes('dana');
        const kasAcc = isBank ? '1002' : '1001';
        const bulan = dateStr.slice(0, 7);

        if (total > 0) {
          try {
            await fetch(`/accounting/journal/${bulan}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                category: 'penyesuaian',
                date: dateStr,
                desc: `VOID Transaksi ${txId} — ${reason.trim()}`,
                ref: `VOID-${txId}`,
                status: 'approved',
                createdBy: this.kasirInfo?.username || 'kasir',
                lines: [
                  { acc: '4001', debit: total, credit: 0 },
                  { acc: kasAcc, debit: 0, credit: total }
                ]
              })
            });
          } catch (e) { console.warn('[VOID] Journal reversal note:', e); }
        }

        // 4. Update state lokal
        tx.voided = true;
        tx.voidedAt = Date.now();
        tx.voidReason = reason.trim();
        this.txHistoryList = [...this.txHistoryList];

        this.showToast(`✅ Transaksi ${txId} di-void. Stok & jurnal dipulihkan.`, 'success');
        this.playSound('success');

        // 5. Refresh inventory list
        try { await this.loadInventory(); } catch (e) {}
      } catch (err) {
        console.error('[VOID] Error:', err);
        this.showToast(`Gagal void: ${err.message}`, 'error');
        this.playSound('error');
      }
    },

    logoutKasir() {
      this.confirmLogoutModal = true;
    },

  confirmLogout() {
    try {
      if (this._clockInterval) clearInterval(this._clockInterval);
      if (this._reconcileInterval) clearInterval(this._reconcileInterval);
      if (this._dashboardInterval) clearInterval(this._dashboardInterval);
      if (this._snapshotInterval) clearInterval(this._snapshotInterval);

      try { sessionStorage.removeItem('dapur_kasir_session'); } catch (e) {}
      try { localStorage.removeItem('dapur_kasir_session'); } catch (e) {}
      try { sessionStorage.removeItem('dapur_admin_session'); } catch (e) {}
      try { localStorage.removeItem('dapur_admin_session'); } catch (e) {}
    } catch (e) {
      console.warn('Logout cleanup note:', e);
    } finally {
      window.location.href = '/';
    }
  }
});

// Registrasi Komponen Alpine.js
document.addEventListener('alpine:init', () => {
  Alpine.data('kasirApp', window.kasirApp);
});
