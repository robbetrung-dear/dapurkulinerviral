/**
 * ============================================================================
 * SISTEM AKUNTANSI & KEUANGAN (DOUBLE-ENTRY ACCOUNTING ENGINE)
 * Dapur Kuliner Viral - Panel Admin & Ownerj.debitName || ('Akun '
 * 
 * Modul:
 * 1. Chart of Accounts (COA) Standar Resto & Catering (Real dari Firebase / Endpoint)
 * 2. Jurnal Umum (General Journal) & Validasi Double-Entry
 * 3. Buku Besar (General Ledger) dengan Saldo Berjalan Real-time
 * 4. Laporan Laba Rugi (Profit & Loss / P&L) dari Ledger Real
 * 5. Laporan Arus Kas (Cash Flow Statement)
 * 6. Laporan Neraca Keuangan (Balance Sheet)
 * 7. Visualisasi Tren Arus Kas 30 Hari (Chart.js)
 * 8. Generator Ekspor Dokumen Resmi (jsPDF & CSV)
 * 9. Hook Auto-Jurnal Realtime dari Transaksi POS Kasir
 * ============================================================================
 */

// Global Chart instance reference
let _accountingChartInstance = null;

// ============================================================================
// DEFINISI STRUKTUR STANDAR BAGAN AKUN (COA) RESTO & CATERING (SEMUA SALDO AWAL 0)
// ============================================================================
const DEFAULT_COA = [
  { code: '1001', name: 'Kas di Tangan (Cash on Hand)', type: 'Aset', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '1002', name: 'Kas di Bank (BCA Operasional)', type: 'Aset', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '1003', name: 'Piutang Usaha / Catering', type: 'Aset', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '1004', name: 'Persediaan Bahan Baku (Stok)', type: 'Aset', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '1005', name: 'Peralatan & Mesin Dapur', type: 'Aset', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '2001', name: 'Hutang Dagang / Supplier', type: 'Kewajiban', normalBalance: 'Kredit', initialBalance: 0, currentBalance: 0 },
  { code: '2002', name: 'Hutang Beban & Operasional', type: 'Kewajiban', normalBalance: 'Kredit', initialBalance: 0, currentBalance: 0 },
  { code: '3001', name: 'Modal Pemilik', type: 'Ekuitas', normalBalance: 'Kredit', initialBalance: 0, currentBalance: 0 },
  { code: '3002', name: 'Laba Ditahan', type: 'Ekuitas', normalBalance: 'Kredit', initialBalance: 0, currentBalance: 0 },
  { code: '3003', name: 'Prive Pemilik', type: 'Ekuitas', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '4001', name: 'Pendapatan Penjualan POS', type: 'Pendapatan', normalBalance: 'Kredit', initialBalance: 0, currentBalance: 0 },
  { code: '4002', name: 'Pendapatan Pesanan Catering', type: 'Pendapatan', normalBalance: 'Kredit', initialBalance: 0, currentBalance: 0 },
  { code: '5001', name: 'Harga Pokok Penjualan (HPP)', type: 'Beban', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '6001', name: 'Beban Gaji Karyawan', type: 'Beban', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '6002', name: 'Beban Sewa Tempat & Outlet', type: 'Beban', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '6003', name: 'Beban Listrik, Air & Gas', type: 'Beban', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
  { code: '6004', name: 'Beban Marketing & Iklan', type: 'Beban', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 },
    { code: '6005', name: 'Beban Operasional (Kurir/Ekspedisi/Lainnya)', type: 'Beban', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 }
];

// Mapping alias akun 3-digit (POS Kasir) dan 4-digit (Akuntansi)
const CODE_MAP = {
  '101': '1001', '1001': '101',
  '102': '1002', '1002': '102',
  '103': '1003', '1003': '103',
  '105': '1004', '1004': '105',
  '106': '1005', '1005': '106',
  '201': '2001', '2001': '201',
  '202': '2002', '2002': '202',
  '301': '3001', '3001': '301',
  '302': '3003', '3003': '302',
  '303': '3002', '3002': '303',
  '401': '4001', '4001': '401',
  '402': '4002', '4002': '402',
  '501': '5001', '5001': '501',
  '601': '6001', '6001': '601',
  '602': '6002', '6002': '602',
  '603': '6003', '6003': '603',
  '604': '6004', '6004': '604',
  '605': '6005', '6005': '605',
  '606': '6006', '6006': '606'
};

// Tidak ada dummy journals (array kosong murni)
const DEFAULT_JOURNALS = [];

// ============================================================================
// HELPER FUNCTIONS AKUNTANSI
// ============================================================================

/**
 * Format angka ke format Rupiah standar Indonesia
 */
function formatRupiah(num) {
  if (isNaN(num) || num === null || num === undefined) return 'Rp 0';
  const val = Math.round(Number(num));
  return 'Rp ' + val.toLocaleString('id-ID');
}

/**
 * Format Rupiah dengan tanda kurung untuk nilai negatif (dipakai di laporan).
 */
function formatRupiahSigned(num) {
  if (isNaN(num) || num === null || num === undefined) return 'Rp 0';
  const val = Math.round(Number(num));
  if (val < 0) return '(' + 'Rp ' + Math.abs(val).toLocaleString('id-ID') + ')';
  return 'Rp ' + val.toLocaleString('id-ID');
}

/**
 * Bersihkan teks agar aman di-render dengan font standar Helvetica (jsPDF).
 * Karakter di luar rentang cetak ASCII (emoji, tanda kutip spesial, simbol non-latin)
 * diganti agar tidak muncul karakter aneh pada hasil PDF.
 */
function sanitizeText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '?');
}

/**
 * Format tanggal dari timestamp atau string ke format lokal (YYYY-MM-DD)
 */
function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Validasi Double Entry Journal: Total Debit harus sama dengan Total Kredit
 */
function validateDoubleEntry(debitAmount, creditAmount) {
  const d = Math.round(Number(debitAmount) || 0);
  const c = Math.round(Number(creditAmount) || 0);
  return d > 0 && c > 0 && d === c;
}

/**
 * Hitung saldo akhir berdasarkan tipe akun dan mutasi debit/kredit
 */
function hitungSaldo(initialBalance, totalDebit, totalCredit, accountType) {
  const init = Number(initialBalance) || 0;
  const deb = Number(totalDebit) || 0;
  const kre = Number(totalCredit) || 0;

  // Akun Debit Normal (Aset, Beban, Prive)
  if (accountType === 'Aset' || accountType === 'Beban' || accountType === 'Prive') {
    return init + deb - kre;
  }
  // Akun Kredit Normal (Kewajiban, Ekuitas, Pendapatan)
  return init + kre - deb;
}

// ============================================================================
// ALPINE.JS COMPONENT: accountingApp()
// ============================================================================
window.accountingApp = function() {
  return {
    // ------------------------------------------------------------------------
    // STATE VARIABEL
    // ------------------------------------------------------------------------
    appReady: false,
    splashAkunTitle: 'AKUNTANSI',
    splashAkunSubtitle: 'Digital Culinary',
    activeTab: 'dashboard',
    reportSubTab: 'pl',
    mobileMenuOpen: false,
    siteName: 'Dapur Kuliner Viral',  // fallback, akan di-load dari site_config/brandName
        // ✅ PIN Accounting gate
    supervisorPin: '211211',          // default, overwrite dari Firebase saat init
    showFinancePinModal: false,       // modal PIN aktif
    financePinInput: '',
    financePinError: '',
    
    // Filter & Periode
    bulanAktif: '2026-09',
    tahunAktif: 2026,
    coaFilterType: 'all',
    jurnalFilterAkun: 'all',
        jurnalSearch: '',
    journalFilterDate: '',  // ✅ Batch B: filter tanggal Jurnal Umum (YYYY-MM-DD)
    ledgerFilterDate: '',   // ✅ Batch B: filter tanggal Ledger (YYYY-MM-DD)
    ledgerAkun: '1001',
    _ledgerMapByMonth: {},  // ✅ BUG-5: cache closing per akun dari /accounting/ledger

    // Trial/Live State
    isProductionMode: false,
    productionStartDate: '',
    dataPreview: { journals: 0, ledgers: 0, orders: 0, transactions: 0 },
    isNeracaBalanced: false,
    // State: simpan status per-periode yang sudah ditutup (contoh: {"2026-09": true})
    closedPeriods: {},

    // Helper: dipanggil dari HTML untuk cek apakah suatu bulan sudah ditutup
    isPeriodClosed(bulan) {
    if (!bulan) return false;
    return !!this.closedPeriods[bulan];
},

    // Modal state
    showClosePeriodModal: false,
    showResetModal: false,
    showGoLiveModal: false,

    // Supervisor PIN gate for destructive/sensitive actions
    showPinModal: false,
    pinInput: '',
    pinErrorMessage: '',
    pinContext: null,

    // Edit & Hapus Jurnal Modal State
    showEditJournalModal: false,
    editJournalForm: {
      id: '',
      noEntry: '',
      date: '',
      category: 'operasional',
      desc: '',
      ref: '',
      status: 'approved',
      lines: []
    },
    showDeleteJournalModal: false,
    deletingJournal: null,

    // Confirm text & password
    closePeriodConfirmText: '',
    closePeriodPassword: '',
    resetConfirmText: '',
    resetPassword1: '',
    resetPassword2: '',
    goLiveConfirmText: '',
    goLivePassword1: '',
    goLivePassword2: '',

    // Go-Live validation
    goLiveValidation: {
      neracaBalance: false,
      noDraftJournals: true,
      noPendingOrders: true
    },
    
    // Status UI
    loading: false,
    loadingSummary: false,
    toastMsg: '',
    toastType: 'success',
    toastVisible: false,

    // Real Summary Metrics dari Server / Firebase
    summary: {
      totalAset: 0,
      totalKewajiban: 0,
      totalEkuitas: 0,
      labaBulanIni: 0,
      kas: 0,
      bank: 0,
      piutang: 0,
      hutang: 0
    },

    // Data Master & Transaksi Real
    coaList: [],
    jurnalList: [],
    ledgerData: {
      account: null,
      openingBalance: 0,
      totalDebit: 0,
      totalCredit: 0,
      closingBalance: 0,
      transactions: []
    },

    // Laporan Keuangan (Real, Initial 0)
    laporanData: {
      pl: {
        pendapatanPOS: 0,
        pendapatanCatering: 0,
        totalPendapatan: 0,
        hpp: 0,
        labaKotor: 0,
        bebanGaji: 0,
        bebanSewa: 0,
        bebanListrik: 0,
        bebanMarketing: 0,
        bebanOperasional: 0,
        totalBeban: 0,
        labaBersih: 0
      },
      cashFlow: {
        penerimaanPelanggan: 0,
        pembayaranSupplier: 0,
        pembayaranGaji: 0,
        pembayaranOperasional: 0,
        kasBersihOperasi: 0,
        pembelianPeralatan: 0,
        kasBersihInvestasi: 0,
        setoranModal: 0,
        prive: 0,
        kasBersihPendanaan: 0,
        kenaikanKas: 0,
        kasAwal: 0,
        kasAkhir: 0
      },
      balanceSheet: {
        kas: 0,
        bank: 0,
        piutang: 0,
        persediaan: 0,
        totalAsetLancar: 0,
        peralatan: 0,
        totalAsetTetap: 0,
        totalAset: 0,
        hutangSupplier: 0,
        hutangBeban: 0,
        totalKewajiban: 0,
        modalPemilik: 0,
        labaDitahan: 0,
        labaBerjalan: 0,
        prive: 0,
        totalEkuitas: 0,
        totalKewajibanEkuitas: 0,
        isBalance: true,
        selisih: 0
      }
    },

    // Modals
    modalEditSaldo: false,
    modalAddAkun: false,
    modalDetailJurnal: false,
    modalViewProof: false,
    selectedProofImg: '',
    selectedJurnal: null,

    editingCoa: { code: '', name: '', initialBalance: 0 },
    newCoaForm: { code: '', name: '', type: 'Aset', initialBalance: 0 },

    // Form Jurnal Manual
    manualJournalForm: {
      date: new Date().toISOString().split('T')[0],
      desc: '',
      debitAccount: '6001',
      creditAccount: '1001',
      amount: 0,
      ref: '',
      proofImage: ''
    },

    // Form Export
    exportForm: {
      period: '2026-09',
      reportType: 'all',
      format: 'pdf'
    },

    // FITUR: Laporan Transaksi Detail (POS + Online-rekonsiliasi + Void) — 1 request/periode
    txDetail: {
      periode: '',
      periodeFile: '',
      rangeMode: 'month',   // 'month' (bulan terpilih) | 'week' (7 hari terakhir)
      rows: [],
      groups: [],
      voidRows: [],
      totals: { count: 0, subtotal: 0, diskon: 0, pajak: 0, total: 0, voidCount: 0, voidTotal: 0 },
      loading: false,
      error: ''
    },
    _menuNameMap: null,

    // Riwayat Export
    exportHistory: [],

    // Firebase Runtime Config
    _fbConfig: null,

    // ------------------------------------------------------------------------
    // 1. INITIALIZATION (init)
    // ------------------------------------------------------------------------
            async init() {
      console.log('[ACCT-APP] init() — PIN gate check...');

      // ✅ Load PIN dari Firebase — pakai fallback URL hostname (sama seperti loadSiteName)
      try {
        await this.initFirebaseConfig();
        let fbUrl = (this._fbConfig?.databaseURL || '').replace(/\/$/, '');
        if (!fbUrl && typeof window !== 'undefined' && window.location) {
          const host = window.location.hostname || '';
          if (host.includes('digitalculinary')) {
            fbUrl = 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
          } else if (host.includes('dapurkulinerviral')) {
            fbUrl = 'https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app';
          }
        }
        if (fbUrl) {
          const res = await fetch(`${fbUrl}/site_config/supervisorPin.json`);
          if (res.ok) {
            const pinVal = await res.json();
            if (pinVal) {
              this.supervisorPin = String(pinVal).trim();
              console.log('[ACCT-APP] ✅ PIN loaded from Firebase:', this.supervisorPin.slice(0,2) + '****');
            }
          } else {
            console.warn('[ACCT-APP] PIN fetch failed:', res.status, '— pakai fallback 211211');
          }
        }
      } catch (e) {
        console.warn('[ACCT-APP] Load PIN note:', e);
      }

      // ✅ Selalu tampilkan modal PIN — no session cache
      this.showFinancePinModal = true;
      this.financePinInput = '';
      this.financePinError = '';
    },

    async submitFinancePin() {
      const pin = String(this.financePinInput || '').trim();
      if (pin.length !== 6) {
        this.financePinError = '⚠️ PIN harus 6 digit';
        return;
      }
      const validPin = String(this.supervisorPin || '211211').trim();
      if (pin !== validPin) {
        this.financePinError = '❌ PIN salah. Coba lagi.';
        this.financePinInput = '';
        return;
      }
      // ✅ No session cache — PIN selalu diminta saat refresh/close tab
      this.showFinancePinModal = false;
      this.financePinError = '';
      this.financePinInput = '';
      await this._initApp();
    },

    cancelFinancePin() {
      this.showFinancePinModal = false;
      this.financePinInput = '';
      this.financePinError = '';
      window.location.href = '/';
    },

    /**
     * ✅ PIN Supervisor Gate untuk aksi destruktif / edit jurnal (konsisten dengan kasir-app.js)
     */
    requestSupervisorPin(actionLabel, targetLabel, forcePrompt = false) {
      const cached = sessionStorage.getItem('dapur_pin_verified_until');
      if (!forcePrompt && cached && Number(cached) > Date.now()) {
        return Promise.resolve(true);
      }
      return new Promise((resolve) => {
        this.pinContext = { actionLabel, targetLabel, resolve };
        this.pinInput = '';
        this.pinErrorMessage = '';
        this.showPinModal = true;
        this.$nextTick(() => {
          setTimeout(() => {
            const el = document.getElementById('supervisorPinInput');
            if (el) el.focus();
          }, 100);
        });
      });
    },

    submitSupervisorPin() {
      const pin = String(this.pinInput || '').trim();
      if (!pin || pin.length !== 6) {
        this.pinErrorMessage = '⚠️ PIN harus 6 digit angka';
        return;
      }
      const validPin = String(this.supervisorPin || '211211').trim();
      if (pin === validPin) {
        try {
          sessionStorage.setItem('dapur_pin_verified_until', String(Date.now() + 15 * 60 * 1000));
        } catch (e) {}
        const ctx = this.pinContext;
        this.showPinModal = false;
        this.pinErrorMessage = '';
        this.pinInput = '';
        if (ctx && typeof ctx.resolve === 'function') ctx.resolve(true);
      } else {
        this.pinErrorMessage = '❌ PIN Supervisor salah';
        this.pinInput = '';
      }
    },

    cancelSupervisorPin() {
      const ctx = this.pinContext;
      this.showPinModal = false;
      this.pinErrorMessage = '';
      this.pinInput = '';
      if (ctx && typeof ctx.resolve === 'function') ctx.resolve(false);
    },

    async _initApp() {
      console.log('[ACCT-APP] Initializing accounting application...');
      
      // 1. Cek sesi admin / manajemen
      const adminSession = sessionStorage.getItem('dapur_admin_session');
      if (!adminSession) {
        alert('Akses Terbatas: Silakan login sebagai Admin / Owner terlebih dahulu.');
        window.location.href = '/';
        return;
      }

      // Set tahun dan bulan aktif saat ini
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = String(now.getMonth() + 1).padStart(2, '0');
      this.bulanAktif = `${curYear}-${curMonth}`;
      this.tahunAktif = curYear;
      this.exportForm.period = this.bulanAktif;

      this.loading = true;

      // 2. Muat konfigurasi Firebase jika ada
      await this.initFirebaseConfig();
            await this.loadSiteName();

            // 3. Muat Data Real dari Backend (Summary, Ledger, COA, Journal)
      await this.loadSummary(this.bulanAktif);
      await this.loadLedgerMap(this.bulanAktif);  // ✅ BUG-5: load dulu sebelum COA
      await this.loadCOA();
      await this.loadJournal(this.bulanAktif);

      // 4. Hitung Saldo & Muat Dashboard
      await this.loadDashboard();

      // 5. Muat Riwayat Export dari LocalStorage
      this.loadExportHistory();

      // 6. Listener perubahan periode bulan
            this.$watch('bulanAktif', async (newVal) => {
        console.log(`[ACCT-APP] Bulan aktif changed to: ${newVal}`);
        this.exportForm.period = newVal;
        this.loading = true;
        await this.loadSummary(newVal);
        await this.loadLedgerMap(newVal);  // ✅ BUG-5: refresh ledger map
        await this.loadCOA();              // ✅ BUG-5: recalculate dengan ledger baru
        await this.loadJournal(newVal);
        await this.loadDashboard();
        if (this.activeTab === 'ledger') {
          await this.loadLedger(this.ledgerAkun, newVal);
        }
        if (this.activeTab === 'trial-live') {
          await this.loadTrialPreview();
        }
        this.loading = false;
      });

      this.$watch('ledgerAkun', async (newVal) => {
        if (newVal) {
          await this.loadLedger(newVal, this.bulanAktif);
        }
      });

      this.loading = false;

      // 7. Render Chart Dashboard setelah DOM selesai
      this.$nextTick(() => {
        this.renderCashFlowChart();
      });

      // 8. Load status Trial/Live
      await this.loadTrialPreview();

      // 9. Daftarkan hook global ke window
      window._accountingAppInstance = this;
      console.log('[ACCT-APP] Accounting App initialized with real data');

      // ✅ Splash minimum display 1800ms
      if (typeof window.__splashStart === 'undefined') window.__splashStart = Date.now();
      const _elapsed = Date.now() - window.__splashStart;
      const _remaining = Math.max(0, 1800 - _elapsed);
      setTimeout(() => { this.appReady = true; }, _remaining);
    },

    /**
     * Inisialisasi Firebase Config
     */
      async loadSiteName() {
      try {
        // ✅ Fallback cepat: pakai nama outlet yang pernah di-cache di localStorage
        // (kalau fetch /site_config/brandName gagal atau lambat, header PDF tetap benar)
        try {
          const cached = localStorage.getItem('dapur_site_name');
          if (cached && cached.trim()) {
            this.siteName = cached.trim();
            this.splashAkunTitle = 'AKUNTANSI';
            this.splashAkunSubtitle = this.siteName || 'Digital Culinary';
          }
        } catch (e) {}

        if (!this._fbConfig || !this._fbConfig.databaseURL) {
          await this.initFirebaseConfig();
        }
        let dbUrl = (this._fbConfig?.databaseURL || '').replace(/\/$/, '');
        // Fallback: derive dari hostname kalau endpoint gagal
        if (!dbUrl && typeof window !== 'undefined' && window.location) {
          const host = window.location.hostname || '';
          if (host.includes('digitalculinary')) {
            dbUrl = 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app';
          } else if (host.includes('dapurkulinerviral')) {
            dbUrl = 'https://dapurkulinerviral-default-rtdb.asia-southeast1.firebasedatabase.app';
          }
        }
        if (!dbUrl) return;
        const res = await fetch(`${dbUrl}/site_config/brandName.json`);
        if (res.ok) {
          const name = await res.json();
          if (name && typeof name === 'string' && name.trim()) {
            this.siteName = name.trim();
            this.splashAkunTitle = 'AKUNTANSI';
            this.splashAkunSubtitle = this.siteName || 'Digital Culinary';
            try { localStorage.setItem('dapur_site_name', this.siteName); } catch (e) {}
            console.log('[ACCT-APP] Site name loaded:', this.siteName);
          }
        }
      } catch (e) {
        console.warn('[ACCT-APP] loadSiteName error:', e);
      }
    },

    async initFirebaseConfig() {
      try {
        const res = await fetch('/api/firebase-config');
        if (res.ok) {
          this._fbConfig = await res.json();
        }
      } catch (e) {
        console.warn('[ACCT-APP] Firebase config fetch note:', e);
      }
    },

    // ------------------------------------------------------------------------
    // 2. RINGKASAN EKSEKUTIF / SUMMARY KEUANGAN
    // ------------------------------------------------------------------------
    
    /**
     * GET /accounting/summary/{bulan}
     * Mengambil summary real dari backend Firebase
     */
    async loadSummary(bulan) {
      const targetBulan = bulan || this.bulanAktif;
      try {
        this.loadingSummary = true;
        console.log(`[ACCT-APP] Fetching summary for period ${targetBulan}...`);
        const res = await fetch(`/accounting/summary/${encodeURIComponent(targetBulan)}`);
        const json = await res.json();

        if (json && json.success && json.data) {
          const d = json.data;
          console.log(`[ACCT-APP] Summary data received for ${targetBulan}:`, d);

          const totalAset = Number(d.totalAset) || 0;
          const totalKewajiban = Number(d.totalKewajiban) || 0;
          const totalEkuitas = Number(d.totalEkuitas) || 0;
          const labaBulanIni = Number(d.labaBersih) || 0;
          const kas = Number(d.saldoKas) || 0;
          const bank = Number(d.saldoBank) || 0;
          const piutang = Number(d.piutang) || 0;
          const hutang = Number(d.hutangSupplier) || 0;

          this.summary = {
            totalAset,
            totalKewajiban,
            totalEkuitas,
            labaBulanIni,
            kas,
            bank,
            piutang,
            hutang
          };

          // Sinkronkan ke laporanData.pl jika tersedia rincian
          const revPOS = Number(d.pendapatan?.penjualanPos) || 0;
          const revCatering = Number(d.pendapatan?.penjualanCatering) || 0;
          const totalPendapatan = Number(d.pendapatan?.totalPendapatan) || (revPOS + revCatering);
          const hpp = Number(d.hpp?.totalHpp) || Number(d.hpp?.bahanBaku) || 0;
          const labaKotor = Number(d.labaKotor) || (totalPendapatan - hpp);
          const bebanGaji = Number(d.beban?.gaji) || 0;
          const bebanSewa = Number(d.beban?.sewa) || 0;
          const bebanListrik = Number(d.beban?.utilitas) || 0;
          const bebanMarketing = Number(d.beban?.marketing) || 0;
          const bebanKurir = Number(d.beban?.kurir) || 0;
          const bebanPenyusutan = Number(d.beban?.penyusutan) || 0;
          const totalBeban = Number(d.beban?.totalBeban) || (bebanGaji + bebanSewa + bebanListrik + bebanMarketing + bebanKurir + bebanPenyusutan);

          this.laporanData.pl = {
            pendapatanPOS: revPOS,
            pendapatanCatering: revCatering,
            totalPendapatan,
            hpp,
            labaKotor,
            bebanGaji,
            bebanSewa,
            bebanListrik,
            bebanMarketing,
            bebanOperasional: bebanKurir + bebanPenyusutan,
            totalBeban,
            labaBersih: labaBulanIni
          };

          // Sinkronkan ke balanceSheet
          this.laporanData.balanceSheet.kas = kas;
          this.laporanData.balanceSheet.bank = bank;
          this.laporanData.balanceSheet.piutang = piutang;
          this.laporanData.balanceSheet.persediaan = Number(d.persediaanAkhir) || 0;
          this.laporanData.balanceSheet.totalAset = totalAset || (kas + bank + piutang + (Number(d.persediaanAkhir) || 0));
          this.laporanData.balanceSheet.hutangSupplier = hutang;
          this.laporanData.balanceSheet.totalKewajiban = totalKewajiban;
          this.laporanData.balanceSheet.totalEkuitas = totalEkuitas;
          this.laporanData.balanceSheet.labaBerjalan = labaBulanIni;
        } else {
          console.warn(`[ACCT-APP] Summary data empty for ${targetBulan}, reset to 0`);
          this.summary = {
            totalAset: 0,
            totalKewajiban: 0,
            totalEkuitas: 0,
            labaBulanIni: 0,
            kas: 0,
            bank: 0,
            piutang: 0,
            hutang: 0
          };
        }
      } catch (err) {
        console.error('[ACCT-APP] Load summary error:', err);
        this.showToast(`Gagal memuat ringkasan keuangan untuk ${targetBulan}`, 'error');
        this.summary = {
          totalAset: 0,
          totalKewajiban: 0,
          totalEkuitas: 0,
          labaBulanIni: 0,
          kas: 0,
          bank: 0,
          piutang: 0,
          hutang: 0
        };
      } finally {
        this.loadingSummary = false;
      }
    },

    /**
     * Getter Metrics untuk Dashboard UI
     */
    get summaryMetrics() {
      const getVal = (v1, v2) => {
        if (v1 !== undefined && v1 !== null && !isNaN(Number(v1))) return Number(v1);
        if (v2 !== undefined && v2 !== null && !isNaN(Number(v2))) return Number(v2);
        return 0;
      };
      return {
        totalAset: getVal(this.summary?.totalAset, this.laporanData.balanceSheet?.totalAset),
        totalKewajiban: getVal(this.summary?.totalKewajiban, this.laporanData.balanceSheet?.totalKewajiban),
        totalEkuitas: getVal(this.summary?.totalEkuitas, this.laporanData.balanceSheet?.totalEkuitas),
        labaBulanIni: getVal(this.summary?.labaBulanIni ?? this.summary?.labaBersih, this.laporanData.pl?.labaBersih),
        kasDiTangan: getVal(this.summary?.kas ?? this.summary?.saldoKas, this.laporanData.balanceSheet?.kas),
        kasDiBank: getVal(this.summary?.bank ?? this.summary?.saldoBank, this.laporanData.balanceSheet?.bank),
        piutang: getVal(this.summary?.piutang, this.laporanData.balanceSheet?.piutang),
        hutangSupplier: getVal(this.summary?.hutang ?? this.summary?.hutangSupplier, this.laporanData.balanceSheet?.hutangSupplier)
      };
    },

    /**
     * Status apakah database masih kosong (semua saldo 0 dan belum ada jurnal)
     */
    get isDatabaseEmpty() {
      const s = this.summaryMetrics;
      return (
        s.totalAset === 0 &&
        s.totalKewajiban === 0 &&
        s.totalEkuitas === 0 &&
        s.labaBulanIni === 0 &&
        (!this.jurnalList || this.jurnalList.length === 0)
      );
    },

    // ------------------------------------------------------------------------
    // 3. CHART OF ACCOUNTS (COA)
    // ------------------------------------------------------------------------
    
        /**
     * ✅ BUG-5: Fetch /accounting/ledger/{bulan} → dapat opening/debit/credit/closing
     * untuk SEMUA akun di bulan tersebut. Sumber kebenaran saldo akumulatif.
     */
    async loadLedgerMap(bulan) {
      const targetBulan = bulan || this.bulanAktif;
      try {
        const res = await fetch(`/accounting/ledger?bulan=${encodeURIComponent(targetBulan)}`);
        // Endpoint versi 1: GET /accounting/ledger (no acc) sudah return semua akun untuk bulan aktif
        // Fallback: pakai endpoint /accounting/ledger tanpa path param, backend pakai bulan berjalan
        // Untuk aman, coba 2 endpoint:
        let data = null;
        if (res.ok) {
          const json = await res.json();
          if (json && json.success && json.data) {
            data = json.data;
          }
        }

        // Fallback: fetch langsung Firebase REST
        if (!data) {
          const fbUrl = (this._fbConfig?.databaseURL || 'https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/$/, '');
          const rawRes = await fetch(`${fbUrl}/accounting/ledger.json`);
          if (rawRes.ok) {
            const all = await rawRes.json();
            const monthMap = {};
            if (all && typeof all === 'object') {
              for (const [code, months] of Object.entries(all)) {
                if (months && months[targetBulan]) {
                  monthMap[code] = months[targetBulan];
                }
              }
            }
            data = monthMap;
          }
        }

        this._ledgerMapByMonth[targetBulan] = data || {};
        console.log(`[ACCT-APP] ✅ Ledger map loaded for ${targetBulan}: ${Object.keys(this._ledgerMapByMonth[targetBulan]).length} akun`);
      } catch (e) {
        console.warn('[ACCT-APP] loadLedgerMap error:', e);
        this._ledgerMapByMonth[targetBulan] = {};
      }
    },

    /**
     * GET /accounting/coa & hitung saldo berjalan berdasarkan mutasi jurnal
     */
    async loadCOA() {
      try {
        console.log('[ACCT-APP] Loading COA from /accounting/coa...');
        let loadedCoa = null;

        try {
          const res = await fetch('/accounting/coa');
          if (res.ok) {
            const json = await res.json();
            if (json && json.success && json.data) {
              if (Array.isArray(json.data) && json.data.length > 0) {
                loadedCoa = json.data;
              } else if (typeof json.data === 'object' && Object.keys(json.data).length > 0) {
                // Map object format { "101": { n: "Kas", t: "asset" } } to array format
                const typeMap = { asset: 'Aset', liability: 'Kewajiban', equity: 'Ekuitas', revenue: 'Pendapatan', expense: 'Beban' };
                const normalMap = { asset: 'Debit', liability: 'Kredit', equity: 'Kredit', revenue: 'Kredit', expense: 'Debit' };
                loadedCoa = Object.entries(json.data).map(([code, item]) => ({
                  code,
                  name: item.n || item.name || `Akun ${code}`,
                  type: typeMap[item.t] || item.type || 'Aset',
                  normalBalance: normalMap[item.t] || (code.startsWith('2') || code.startsWith('3') || code.startsWith('4') ? 'Kredit' : 'Debit'),
                  initialBalance: Number(item.initialBalance) || 0,
                  currentBalance: Number(item.currentBalance) || 0
                }));
              }
              if (loadedCoa && loadedCoa.length > 0) {
                console.log(`[ACCT-APP] Loaded ${loadedCoa.length} COA accounts from API`);
              }
            }
          }
        } catch (err) {
          console.warn('[ACCT-APP] Fetch /accounting/coa note:', err);
        }

        // Coba dari LocalStorage jika offline
        if (!loadedCoa) {
          const localCoa = localStorage.getItem('dapur_accounting_coa');
          if (localCoa) {
            try { 
              const parsed = JSON.parse(localCoa);
              if (Array.isArray(parsed) && parsed.length > 0) {
                loadedCoa = parsed;
              }
            } catch (e) {}
          }
        }

        // Default COA template dengan semua saldo 0
        if (!loadedCoa || loadedCoa.length === 0) {
          loadedCoa = DEFAULT_COA.map(acc => ({
            ...acc,
            initialBalance: 0,
            currentBalance: 0
          }));
        }

        this.coaList = loadedCoa;
        this.recalculateAllAccountBalances();
      } catch (e) {
        console.error('[ACCT-APP] Error loadCOA:', e);
        this.showToast('Gagal memuat Bagan Akun (COA)', 'error');
        this.coaList = DEFAULT_COA.map(acc => ({ ...acc, initialBalance: 0, currentBalance: 0 }));
      }
    },

    async openEditCoaWithPin(item) {
      if (!item) return;
      const pinOk = await this.requestSupervisorPin('EDIT COA', `Akun ${item.code} - ${item.name}`);
      if (!pinOk) return;
      this.editingCoa = { ...item };
      this.modalEditSaldo = true;
    },

    /**
     * Simpan Perubahan Saldo Awal Akun
     * PATCH /accounting/coa/{accCode}/saldoAwal = nilai
     */
    async updateSaldoAwal(accCode, nilai) {
      const amt = Number(nilai) || 0;
      const target = this.coaList.find(c => c.code === accCode);
      if (!target) return;

      target.initialBalance = amt;
      this.recalculateAllAccountBalances();

      // Simpan ke local & server
      localStorage.setItem('dapur_accounting_coa', JSON.stringify(this.coaList));

      try {
        await fetch(`/accounting/coa/${encodeURIComponent(accCode)}/saldoAwal`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ saldoAwal: amt })
        });
      } catch (e) {
        console.warn('[ACCT-APP] Server update saldo awal note:', e);
      }

      this.showToast(`Saldo awal akun [${accCode}] berhasil diperbarui`, 'success');
      this.modalEditSaldo = false;
      await this.loadDashboard();
    },

    /**
     * Tambah Akun Baru ke COA
     */
    async tambahAkun() {
      const { code, name, type, initialBalance } = this.newCoaForm;
      if (!code || !name) {
        this.showToast('Kode dan Nama Akun wajib diisi', 'error');
        return;
      }

      // Cek duplikasi kode akun
      if (this.coaList.some(c => c.code === code.trim())) {
        this.showToast(`Kode akun [${code}] sudah digunakan`, 'error');
        return;
      }

      const newAcc = {
        code: code.trim(),
        name: name.trim(),
        type: type || 'Aset',
        normalBalance: (type === 'Kewajiban' || type === 'Ekuitas' || type === 'Pendapatan') ? 'Kredit' : 'Debit',
        initialBalance: Number(initialBalance) || 0,
        currentBalance: Number(initialBalance) || 0
      };

      this.coaList.push(newAcc);
      this.coaList.sort((a, b) => a.code.localeCompare(b.code));

      // Simpan
      localStorage.setItem('dapur_accounting_coa', JSON.stringify(this.coaList));

      try {
        await fetch('/accounting/coa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newAcc)
        });
      } catch (e) {}

      this.showToast(`Akun [${newAcc.code} - ${newAcc.name}] berhasil ditambahkan!`, 'success');
      this.newCoaForm = { code: '', name: '', type: 'Aset', initialBalance: 0 };
      this.modalAddAkun = false;
      this.recalculateAllAccountBalances();
      await this.loadDashboard();
    },

    /**
     * Hitung ulang seluruh saldo akun berjalan berdasarkan mutasi seluruh jurnal
     */
    recalculateAllAccountBalances() {
      const totalsByAcc = {};

      // Inisialisasi dari saldo awal
      this.coaList.forEach(acc => {
        totalsByAcc[acc.code] = {
          initial: Number(acc.initialBalance) || 0,
          debit: 0,
          credit: 0,
          type: acc.type
        };
      });

      const addToAcc = (rawCode, dAmt, cAmt) => {
        const c = String(rawCode || '').trim();
        if (totalsByAcc[c]) {
          totalsByAcc[c].debit += dAmt;
          totalsByAcc[c].credit += cAmt;
        }
        const mapped = CODE_MAP[c];
        if (mapped && totalsByAcc[mapped]) {
          totalsByAcc[mapped].debit += dAmt;
          totalsByAcc[mapped].credit += cAmt;
        }
      };

      // Akumulasikan semua mutasi jurnal real (hanya yang tidak ditolak)
      this.jurnalList.forEach(j => {
        if (j.status === 'rejected') return;

        if (Array.isArray(j.lines)) {
          j.lines.forEach(l => {
            const raw = String(l.acc || l.code || '');
            const dAmt = Number(l.debit) || 0;
            const cAmt = Number(l.credit) || 0;
            addToAcc(raw, dAmt, cAmt);
          });
        } else {
          const dCode = j.debitCode;
          const cCode = j.creditCode;
          const dAmt = Number(j.debitAmount) || 0;
          const cAmt = Number(j.creditAmount) || 0;
          addToAcc(dCode, dAmt, 0);
          addToAcc(cCode, 0, cAmt);
        }
      });

      // Update current balance per akun dan simpan total mutasi debit & kredit
      // ✅ BUG-5: PRIORITAS data ledger (opening/closing real) di atas hitungan jurnal lokal
      const rawLedgerMap = this._ledgerMapByMonth[this.bulanAktif] || {};

      // ✅ BUG-5 FIX v2: Normalize ledger map keys — COA dari /accounting/coa pakai 3-digit
      // (101), tapi ledger Firebase pakai 4-digit (1001). Bangun alias bidirectional.
      const ledgerMap = {};
      for (const [code, val] of Object.entries(rawLedgerMap)) {
        ledgerMap[code] = val;
        const alias = CODE_MAP[code];   // CODE_MAP sudah bidirectional: '1001'→'101', '101'→'1001'
        if (alias) ledgerMap[alias] = val;
      }
      const hasLedgerData = Object.keys(rawLedgerMap).length > 0;
      console.log(`[ACCT-APP] ledgerMap normalized: ${Object.keys(ledgerMap).length} keys (dari ${Object.keys(rawLedgerMap).length} raw)`);
      this.coaList.forEach(acc => {
        const stat = totalsByAcc[acc.code];
        const ledger = ledgerMap[acc.code];  // key di Firebase sudah 4-digit

        if (ledger && (ledger.opening !== undefined || ledger.closing !== undefined)) {
          // ✅ Pakai data ledger — authoritative
          acc.initialBalance = Number(ledger.opening) || 0;
          acc.totalDebit = Number(ledger.debit) || 0;
          acc.totalCredit = Number(ledger.credit) || 0;
          acc.currentBalance = Number(ledger.closing) || 0;
        } else if (stat) {
          // Fallback: hitung dari jurnal lokal (kalau ledger belum tersedia)
          acc.totalDebit = stat.debit;
          acc.totalCredit = stat.credit;
          acc.currentBalance = hitungSaldo(stat.initial, stat.debit, stat.credit, stat.type);
        }
      });

      console.log(`[ACCT-APP] recalculate: ${hasLedgerData ? 'using LEDGER' : 'using JURNAL fallback'}`);
    },

    // ------------------------------------------------------------------------
    // 4. JURNAL UMUM (GENERAL JOURNAL)
    // ------------------------------------------------------------------------

    /**
     * Alias loadJurnal -> loadJournal
     */
    async loadJurnal(bulan) {
      return this.loadJournal(bulan);
    },

    /**
     * GET /accounting/journal/{bulan}
     * Memuat daftar jurnal real dari Firebase untuk periode tertentu
     */
        /**
     * ✅ Batch B: Filtered jurnal — reaktif terhadap akun + search + tanggal
     */
    get filteredJurnalList() {
      const list = Array.isArray(this.jurnalList) ? this.jurnalList : [];
      const filterAkun = String(this.jurnalFilterAkun || 'all');
      const search = String(this.jurnalSearch || '').toLowerCase().trim();
      const filterDate = String(this.journalFilterDate || '').trim();

      return list.filter(j => {
        if (!j) return false;
        // Filter akun
        if (filterAkun !== 'all') {
          const matchDebit = String(j.debitCode || '') === filterAkun;
          const matchCredit = String(j.creditCode || '') === filterAkun;
          if (!matchDebit && !matchCredit) return false;
        }
        // Filter tanggal
        if (filterDate) {
          const jDate = String(j.date || '').slice(0, 10);
          if (jDate !== filterDate) return false;
        }
        // Filter search
        if (search) {
          const desc = String(j.desc || '').toLowerCase();
          const ref = String(j.ref || '').toLowerCase();
          const noEntry = String(j.noEntry || '').toLowerCase();
          if (!desc.includes(search) && !ref.includes(search) && !noEntry.includes(search)) return false;
        }
        return true;
      });
    },

    get filteredJurnalCount() {
      return this.filteredJurnalList.length;
    },

    /**
     * ✅ Batch B: Filtered ledger transactions — reaktif terhadap ledgerFilterDate
     */
    get filteredLedgerTransactions() {
      const list = Array.isArray(this.ledgerData?.transactions) ? this.ledgerData.transactions : [];
      const filterDate = String(this.ledgerFilterDate || '').trim();
      if (!filterDate) return list;
      return list.filter(t => {
        const tDate = String(t.date || '').slice(0, 10);
        return tDate === filterDate;
      });
    },

    async loadJournal(bulan) {
      const targetBulan = bulan || this.bulanAktif;
      try {
        console.log(`[ACCT-APP] Loading Journal for period ${targetBulan}...`);
        let list = null;

        try {
          const res = await fetch(`/accounting/journal/${encodeURIComponent(targetBulan)}`);
          if (res.ok) {
            const json = await res.json();
            if (json && json.success && Array.isArray(json.data)) {
              list = json.data;
              console.log(`[ACCT-APP] Loaded ${list.length} journals from API for ${targetBulan}`);
            }
          }
        } catch (e) {
          console.warn('[ACCT-APP] Fetch journal note:', e);
        }

        if (!list) {
          const stored = localStorage.getItem(`dapur_journal_${targetBulan}`);
          if (stored) {
            try { list = JSON.parse(stored); } catch (e) {}
          }
        }

        // Jika tidak ada data, list kosong (TIDAK ADA DATA DUMMY)
        this.jurnalList = Array.isArray(list) ? list : [];

        // Normalisasi struktur jurnal jika diperlukan
        // Helper: mapping kode akun → nama
const _getAccNameById = (code) => {
  const map = {
    '1001': 'Kas di Tangan', '1002': 'Bank BCA', '1003': 'Piutang Usaha',
    '1004': 'Persediaan Bahan Baku', '1005': 'Peralatan & Mesin Dapur',
    '2001': 'Hutang Dagang / Supplier', '2002': 'Hutang Beban & Operasional',
    '3001': 'Modal Pemilik', '3002': 'Laba Ditahan', '3003': 'Prive Pemilik',
    '4001': 'Pendapatan Penjualan POS', '4002': 'Pendapatan Pesanan Catering',
    '5001': 'Harga Pokok Penjualan (HPP)',
    '6001': 'Beban Gaji Karyawan', '6002': 'Beban Sewa Tempat & Outlet',
    '6003': 'Beban Listrik, Air & Gas', '6004': 'Beban Marketing & Iklan',
    '6005': 'Beban Operasional & Kurir', '6006': 'Beban Penyusutan',
    // Legacy 3-digit
    '101':'Kas di Tangan','102':'Bank','103':'Piutang Usaha','105':'Persediaan Bahan Baku',
    '201':'Hutang Supplier','301':'Modal Pemilik','302':'Prive Pemilik',
    '401':'Pendapatan Penjualan','402':'Pendapatan Catering','501':'HPP',
    '601':'Beban Gaji','602':'Beban Sewa','603':'Beban Listrik & Air',
    '604':'Beban Marketing','605':'Beban Operasional (Kurir/Ekspedisi/Lainnya)','606':'Beban Penyusutan'
  };
  return map[String(code)] || ('Akun ' + code);
};

this.jurnalList.forEach(j => {
  if (!j.debitCode && Array.isArray(j.lines)) {
    const debitLine = j.lines.find(l => Number(l.debit) > 0);
    const creditLine = j.lines.find(l => Number(l.credit) > 0);
    if (debitLine) {
      j.debitCode = debitLine.acc;
      j.debitAmount = debitLine.debit;
    }
    if (creditLine) {
      j.creditCode = creditLine.acc;
      j.creditAmount = creditLine.credit;
    }
  }
  // ✅ FIX: Always populate names (fallback kalau kosong setelah edit PATCH)
  if (j.debitCode && !j.debitName) j.debitName = _getAccNameById(j.debitCode);
  if (j.creditCode && !j.creditName) j.creditName = _getAccNameById(j.creditCode);
});

        // Sort timestamp DESC
        this.jurnalList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        this.recalculateAllAccountBalances();
      } catch (err) {
        console.error('[ACCT-APP] Error loadJournal:', err);
        this.showToast(`Gagal memuat Jurnal Umum periode ${targetBulan}`, 'error');
        this.jurnalList = [];
        this.recalculateAllAccountBalances();
      }
    },

    /**
     * Tambah Jurnal Manual (Double-Entry Validation)
     */
    async tambahJurnalManual() {
      const { date, desc, debitAccount, creditAccount, amount, ref, proofImage } = this.manualJournalForm;
      const amt = Number(amount) || 0;

      if (!desc || amt <= 0) {
        this.showToast('Deskripsi dan nominal transaksi valid wajib diisi', 'error');
        return;
      }

      if (!debitAccount || !creditAccount) {
        this.showToast('Pilih Akun Debit dan Akun Kredit yang sesuai', 'error');
        return;
      }

      if (debitAccount === creditAccount) {
        this.showToast('Akun Debit dan Akun Kredit tidak boleh sama!', 'error');
        return;
      }

      // Validasi Double-Entry: Total Debit = Total Kredit
      if (!validateDoubleEntry(amt, amt)) {
        this.showToast('Transaksi tidak seimbang (Double-entry mismatch)', 'error');
        return;
      }

      const debitAccObj = this.coaList.find(c => c.code === debitAccount) || { name: 'Akun ' + debitAccount };
      const creditAccObj = this.coaList.find(c => c.code === creditAccount) || { name: 'Akun ' + creditAccount };

      const entryId = 'J' + Date.now();
      const noEntry = 'JE-' + Date.now().toString().slice(-6);
      const txDate = date || new Date().toISOString().split('T')[0];
      const bulanKey = txDate.substring(0, 7);

      const newEntry = {
        id: entryId,
        date: txDate,
        timestamp: new Date(txDate).getTime() || Date.now(),
        noEntry: noEntry,
        desc: desc.trim(),
        debitCode: debitAccount,
        debitName: debitAccObj.name,
        debitAmount: amt,
        creditCode: creditAccount,
        creditName: creditAccObj.name,
        creditAmount: amt,
        lines: [
          { acc: debitAccount, debit: amt, credit: 0 },
          { acc: creditAccount, debit: 0, credit: amt }
        ],
        status: 'approved',
        ref: ref ? ref.trim() : `MANUAL-${entryId.slice(-4)}`,
        proof: proofImage || ''
      };

      // Tambahkan ke jurnal
      this.jurnalList.unshift(newEntry);

      // Simpan ke LocalStorage & Server
      localStorage.setItem(`dapur_journal_${bulanKey}`, JSON.stringify(this.jurnalList));

        try {
        const postRes = await fetch(`/accounting/journal/${encodeURIComponent(bulanKey)}/${encodeURIComponent(entryId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEntry)
        });
        const postJson = await postRes.json().catch(() => ({}));
        console.log(`[ACCT-APP] POST ${bulanKey}/${entryId} → HTTP ${postRes.status}`, postJson);
        if (!postRes.ok || !postJson.success) {
          alert(`❌ GAGAL SIMPAN JURNAL\n\nHTTP ${postRes.status}\nError: ${postJson.error || '(tidak ada pesan)'}`);
          this.showToast(`Gagal: ${postJson.error || 'HTTP ' + postRes.status}`, 'error');
          // Rollback optimistic UI
          this.jurnalList = this.jurnalList.filter(j => j.id !== entryId);
          return;
        }
      } catch (e) {
        console.warn('[ACCT-APP] Post journal exception:', e);
        alert(`❌ Network error: ${e.message}`);
        return;
      }
            // ✅ FIX BUG-3: Tunggu backend update ledger, lalu re-fetch SEMUA
      await new Promise(r => setTimeout(r, 800));
      await this.loadLedgerMap(this.bulanAktif);   // ← re-fetch ledger
      await this.loadJournal(bulanKey);            // ← re-fetch jurnal dari server
      await this.loadSummary(this.bulanAktif);     // ← re-fetch summary
      await this.loadCOA();                        // ← recalc COA dengan ledger baru
      await this.loadDashboard();                  // ← refresh laba rugi, arus kas, neraca
            // ✅ FIX BUG-3: Re-fetch dari server (ID & state konsisten setelah POST)
      try {
        await this.loadJournal(bulanKey);
        await this.loadLedgerMap(bulanKey);
        await this.loadCOA();
      } catch (e) {
        console.warn('[ACCT-APP] Re-fetch after POST note:', e);
      }
            // ✅ FIX: Re-fetch dari server biar ID & state konsisten
      try {
        await new Promise(r => setTimeout(r, 600));
        await this.loadJournal(bulanKey);
        await this.loadLedgerMap(bulanKey);
        await this.loadCOA();
      } catch (e) {
        console.warn('[ACCT-APP] Re-fetch after POST note:', e);
      }
      this.recalculateAllAccountBalances();
      await this.loadSummary(this.bulanAktif);
      await this.loadDashboard();

      this.showToast(`Jurnal [${noEntry}] sebesar ${formatRupiah(amt)} berhasil dicatat!`, 'success');

      // Reset form
      this.manualJournalForm = {
        date: new Date().toISOString().split('T')[0],
        desc: '',
        debitAccount: '6001',
        creditAccount: '1001',
        amount: 0,
        ref: '',
        proofImage: ''
      };

      this.setTab('jurnal');
    },

    /**
     * Upload File Bukti Transaksi
     */
    handleProofUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        this.showToast('Ukuran file maksimal 2MB', 'error');
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        this.manualJournalForm.proofImage = e.target.result;
        this.showToast('Bukti transaksi berhasil dilampirkan', 'success');
      };
      reader.readAsDataURL(file);
    },

    async prefillReversal(jrn) {
      if (!jrn) return;
      const pinOk = await this.requestSupervisorPin('BUAT JURNAL REVERSAL', `Jurnal ${jrn.noEntry || jrn.id}`);
      if (!pinOk) {
        this.showToast('Pembuatan reversal dibatalkan', 'notify');
        return;
      }
      const dCode = jrn.debitCode || '';
      const cCode = jrn.creditCode || '';
      const dAmt = Number(jrn.debitAmount) || 0;
      const cAmt = Number(jrn.creditAmount) || 0;
      const amount = Math.max(dAmt, cAmt);
      if (amount <= 0) {
        this.showToast('Jurnal tidak punya nominal valid untuk reversal', 'error');
        return;
      }
      this.manualJournalForm = {
        date: new Date().toISOString().split('T')[0],
        desc: `REVERSAL dari ${jrn.noEntry || jrn.id} — ${jrn.desc || ''}`.slice(0, 200),
        debitAccount: cCode,
        creditAccount: dCode,
        amount: amount,
        ref: `REV-${jrn.noEntry || jrn.id}`,
        proofImage: ''
      };
      this.modalDetailJurnal = false;
      this.setTab('input');
      this.$nextTick(() => {
        const sD = document.querySelector('select[data-role="debit-select"]');
        const sK = document.querySelector('select[data-role="kredit-select"]');
        const norm = (c) => {
          const m = { '1001':'101','1002':'102','1003':'103','1004':'105','1005':'111','2001':'201','2002':'202','3001':'301','3002':'303','3003':'302','4001':'401','4002':'402','5001':'501','6001':'601','6002':'602','6003':'603','6004':'604','6005':'605','6006':'606' };
          if (!c) return '';
          if (c.length === 4 && m[c]) return m[c];
          return c;
        };
        if (sD) sD.value = norm(cCode);
        if (sK) sK.value = norm(dCode);
      });
      this.showToast(`Form reversal siap — Debit: ${cCode}, Kredit: ${dCode}`, 'success');
    },

    /**
     * Preset Transaksi Cepat untuk mempermudah form input manual
     */
    applyPreset(type) {
      const today = new Date().toISOString().split('T')[0];
      switch(type) {
        case 'operasional':
          this.manualJournalForm = {
            date: today,
            desc: 'Pembayaran Beban Operasional / Perlengkapan Toko',
            debitAccount: '6005',
            creditAccount: '1001',
            amount: 0,
            ref: 'OPS-' + Date.now().toString().slice(-4),
            proofImage: ''
          };
          break;
        case 'setorBank':
          this.manualJournalForm = {
            date: today,
            desc: 'Setor Kas Harian Kasir ke Rekening Bank BCA',
            debitAccount: '1002',
            creditAccount: '1001',
            amount: 0,
            ref: 'SETOR-BCA-' + Date.now().toString().slice(-4),
            proofImage: ''
          };
          break;
        case 'beliBahan':
          this.manualJournalForm = {
            date: today,
            desc: 'Pembelian Bahan Baku Segar Ayam, Daging & Sayur',
            debitAccount: '5001',
            creditAccount: '1001',
            amount: 0,
            ref: 'BELI-BAHAN-' + Date.now().toString().slice(-4),
            proofImage: ''
          };
          break;
        case 'prive':
          this.manualJournalForm = {
            date: today,
            desc: 'Penarikan Prive untuk Keperluan Pribadi Pemilik',
            debitAccount: '3003',
            creditAccount: '1002',
            amount: 0,
            ref: 'PRIVE-' + Date.now().toString().slice(-4),
            proofImage: ''
          };
          break;
        case 'pemasukanLain':
          this.manualJournalForm = {
            date: today,
            desc: 'Penerimaan Pendapatan Pesanan Catering / Event Khusus',
            debitAccount: '1002',
            creditAccount: '4002',
            amount: 0,
            ref: 'CAT-EVENT-' + Date.now().toString().slice(-4),
            proofImage: ''
          };
          break;
        case 'adjustment':
          this.manualJournalForm = {
            date: today,
            desc: 'Penyesuaian Selisih Kas Fisik / Stock Opname Bahan',
            debitAccount: '6005',
            creditAccount: '1004',
            amount: 0,
            ref: 'ADJ-' + Date.now().toString().slice(-4),
            proofImage: ''
          };
          break;
      }
      setTimeout(() => {
        const d = document.querySelector('select[data-role="debit-select"]');
        const k = document.querySelector('select[data-role="kredit-select"]');
        if (d) d.value = this.manualJournalForm.debitAccount;
        if (k) k.value = this.manualJournalForm.creditAccount;
      }, 50);
      this.showToast(`Template [${type}] dipilih, silakan masukkan nominal`, 'success');
    },

    /**
     * =========================================================================
     * EDIT & HAPUS JURNAL UMUM DENGAN SUPERVISOR PIN GATE & REALTIME BACKEND SYNC
     * =========================================================================
     */

    async openEditJournalModal(jrn) {
      if (!jrn) return;
      const today = new Date().toISOString().split('T')[0];
      const todayWIB = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
      const jrnDate = String(jrn.date || jrn.tgl || '').split('T')[0];
      const isToday = (jrnDate === today || jrnDate === todayWIB);
      if (jrn.status === 'approved' && !isToday) {
        alert("⚠️ Jurnal approved dari hari sebelumnya tidak dapat diedit. Buat jurnal reversal.");
        return;
      }

      const pinOk = await this.requestSupervisorPin('EDIT JURNAL', `Jurnal ${jrn.noEntry || jrn.id}`, true);
      if (!pinOk) return;

      let lines = [];
      if (Array.isArray(jrn.lines) && jrn.lines.length > 0) {
        lines = jrn.lines.map(l => ({
          acc: String(l.acc || '1001'),
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0
        }));
      } else {
        lines = [
          { acc: String(jrn.debitCode || '1001'), debit: Number(jrn.debitAmount) || 0, credit: 0 },
          { acc: String(jrn.creditCode || '4001'), debit: 0, credit: Number(jrn.creditAmount) || 0 }
        ];
      }

      this.editJournalForm = {
        id: jrn.id,
        noEntry: jrn.noEntry || '',
        date: jrn.date || today,
        category: jrn.category || 'operasional',
        desc: jrn.desc || '',
        ref: jrn.ref || '',
        status: jrn.status || 'approved',
        lines: lines
      };
      this.showEditJournalModal = true;
    },

    addEditJournalLine() {
      this.editJournalForm.lines.push({ acc: '1001', debit: 0, credit: 0 });
    },

    removeEditJournalLine(idx) {
      if (this.editJournalForm.lines.length <= 2) {
        this.showToast('Jurnal minimal memiliki 2 baris (Debit & Kredit)', 'error');
        return;
      }
      this.editJournalForm.lines.splice(idx, 1);
    },

    getEditJournalTotalDebit() {
      return (this.editJournalForm.lines || []).reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
    },

    getEditJournalTotalCredit() {
      return (this.editJournalForm.lines || []).reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
    },

    isEditJournalBalanced() {
      const d = this.getEditJournalTotalDebit();
      const c = this.getEditJournalTotalCredit();
      return d > 0 && Math.abs(d - c) < 0.01;
    },

    async submitEditJournal() {
      if (!this.isEditJournalBalanced()) {
        this.showToast('Total Debit dan Total Kredit harus sama dan lebih dari 0', 'error');
        return;
      }
      if (!this.editJournalForm.desc || !this.editJournalForm.desc.trim()) {
        this.showToast('Deskripsi jurnal wajib diisi', 'error');
        return;
      }

      this.loading = true;
      try {
        const payload = {
          date: this.editJournalForm.date,
          category: this.editJournalForm.category,
          desc: this.editJournalForm.desc.trim(),
          ref: this.editJournalForm.ref.trim(),
          lines: this.editJournalForm.lines.map(l => ({
            acc: String(l.acc),
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0
          }))
        };

        const res = await fetch(`/accounting/journal/${encodeURIComponent(this.editJournalForm.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          alert(`❌ GAGAL EDIT JURNAL\n\n${data.error || 'Terjadi kesalahan sistem'}`);
          this.loading = false;
          return;
        }

        this.showToast('✅ Jurnal berhasil diperbarui!', 'success');
        this.showEditJournalModal = false;

        // Refresh journalList & ledger dari server
        const bulanKey = (this.editJournalForm.date || '').substring(0, 7) || this.bulanAktif;
        await this.loadJournal(bulanKey);
        await this.loadLedgerMap(bulanKey);
        await this.loadCOA();
        await this.loadSummary(this.bulanAktif);
        await this.loadDashboard();
      } catch (err) {
        console.error('[ACCT-APP] submitEditJournal error:', err);
        alert(`❌ Error: ${err.message}`);
      } finally {
        this.loading = false;
      }
    },

    async openDeleteJournalModal(jrn) {
      if (!jrn) return;
      const today = new Date().toISOString().split('T')[0];
      const todayWIB = new Date(Date.now() + 7 * 3600 * 1000).toISOString().split('T')[0];
      const jrnDate = String(jrn.date || jrn.tgl || '').split('T')[0];
      const isToday = (jrnDate === today || jrnDate === todayWIB);
      if (jrn.status === 'approved' && !isToday) {
        alert("⚠️ Jurnal approved dari hari sebelumnya tidak dapat dihapus. Buat jurnal reversal.");
        return;
      }

      const pinOk = await this.requestSupervisorPin('HAPUS JURNAL', `Jurnal ${jrn.noEntry || jrn.id}`, true);
      if (!pinOk) return;

      this.deletingJournal = jrn;
      this.showDeleteJournalModal = true;
    },

    async submitDeleteJournal() {
      if (!this.deletingJournal) return;
      this.loading = true;
      try {
        const res = await fetch(`/accounting/journal/${encodeURIComponent(this.deletingJournal.id)}`, {
          method: 'DELETE'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          alert(`❌ GAGAL HAPUS JURNAL\n\n${data.error || 'Terjadi kesalahan sistem'}`);
          this.loading = false;
          return;
        }

        this.showToast('✅ Jurnal berhasil dihapus!', 'success');
        this.showDeleteJournalModal = false;
        const bulanKey = (this.deletingJournal.date || '').substring(0, 7) || this.bulanAktif;
        this.deletingJournal = null;

        // Refresh journalList & ledger dari server
        await this.loadJournal(bulanKey);
        await this.loadLedgerMap(bulanKey);
        await this.loadCOA();
        await this.loadSummary(this.bulanAktif);
        await this.loadDashboard();
      } catch (err) {
        console.error('[ACCT-APP] submitDeleteJournal error:', err);
        alert(`❌ Error: ${err.message}`);
      } finally {
        this.loading = false;
      }
    },

    // ------------------------------------------------------------------------
    // 5. BUKU BESAR (GENERAL LEDGER)
    // ------------------------------------------------------------------------

    /**
     * GET /accounting/ledger/{accCode}/{bulan}
     * Memuat buku besar real akun tertentu
     */
    async loadLedger(accCode, bulan) {
      const targetAcc = accCode || this.ledgerAkun || '1001';
      const targetBulan = bulan || this.bulanAktif;
      this.ledgerAkun = targetAcc;

      const accObj = this.coaList.find(c => c.code === targetAcc) || {
        code: targetAcc,
        name: 'Akun ' + targetAcc,
        type: 'Aset',
        initialBalance: 0
      };

      try {
        console.log(`[ACCT-APP] Loading Ledger for acc ${targetAcc} bulan ${targetBulan}...`);
        const res = await fetch(`/accounting/ledger/${encodeURIComponent(targetAcc)}/${encodeURIComponent(targetBulan)}`);
        let serverLedger = null;
        if (res.ok) {
          const json = await res.json();
          if (json && json.success && json.data) {
            serverLedger = json.data;
          }
        }

        // Susun baris mutasi transaksi secara kronologis dari jurnalList
        let openingBal = serverLedger ? Number(serverLedger.opening) || 0 : (Number(accObj.initialBalance) || 0);
        let runningBalance = openingBal;
        let totalDebit = 0;
        let totalCredit = 0;
        const transactions = [];

        // ✅ FIX: Normalisasi kode akun 3-digit → 4-digit
        const _ACC_MAP = {
          '101':'1001','102':'1002','103':'1003','105':'1004','106':'1005',
          '201':'2001','202':'2002',
          '301':'3001','302':'3003','303':'3002',
          '401':'4001','402':'4002',
          '501':'5001',
          '601':'6001','602':'6002','603':'6003','604':'6004','605':'6005','606':'6006'
        };
        const _normalizeAcc = (acc) => {
          const clean = String(acc || '').trim();
          return _ACC_MAP[clean] || clean;
        };
        const targetAccNorm = _normalizeAcc(targetAcc);

        const relatedJournals = (this.jurnalList || [])
          .filter(j => {
            if (_normalizeAcc(j.debitCode) === targetAccNorm) return true;
            if (_normalizeAcc(j.creditCode) === targetAccNorm) return true;
            if (Array.isArray(j.lines)) {
              return j.lines.some(l => _normalizeAcc(l.acc || l.code) === targetAccNorm);
            }
            return false;
          })
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

          relatedJournals.forEach(j => {
          let dAmt = 0;
          let cAmt = 0;
            
          // ✅ FIX: Hanya pakai 1 sumber — prioritas lines, fallback debitCode/creditCode
          if (Array.isArray(j.lines) && j.lines.length > 0) {
            j.lines.forEach(l => {
              if (_normalizeAcc(l.acc || l.code) === targetAccNorm) {
                dAmt += Number(l.debit) || 0;
                cAmt += Number(l.credit) || 0;
              }
            });
          } else {
            if (_normalizeAcc(j.debitCode) === targetAccNorm) dAmt += Number(j.debitAmount) || 0;
            if (_normalizeAcc(j.creditCode) === targetAccNorm) cAmt += Number(j.creditAmount) || 0;
          }

          totalDebit += dAmt;
          totalCredit += cAmt;

          if (accObj.type === 'Aset' || accObj.type === 'Beban' || accObj.type === 'Prive') {
            runningBalance += (dAmt - cAmt);
          } else {
            runningBalance += (cAmt - dAmt);
          }

          transactions.push({
            date: j.date || formatDate(j.timestamp),
            ref: j.ref || j.noEntry || j.id || '-',
            desc: j.desc || j.keterangan || '-',
            debit: dAmt,
            credit: cAmt,
            runningBalance: runningBalance
          });
        });

        if (serverLedger) {
          this.ledgerData = {
            account: accObj,
            openingBalance: Number(serverLedger.opening) || 0,
            totalDebit: Number(serverLedger.debit) || totalDebit,
            totalCredit: Number(serverLedger.credit) || totalCredit,
            closingBalance: Number(serverLedger.closing) || runningBalance,
            transactions: transactions
          };
        } else {
          this.ledgerData = {
            account: accObj,
            openingBalance: openingBal,
            totalDebit: totalDebit,
            totalCredit: totalCredit,
            closingBalance: runningBalance,
            transactions: transactions
          };
        }
      } catch (err) {
        console.error(`[ACCT-APP] Error loadLedger acc ${targetAcc}:`, err);
        this.showToast(`Gagal memuat Buku Besar akun ${targetAcc}`, 'error');
        this.ledgerData = {
          account: accObj,
          openingBalance: 0,
          totalDebit: 0,
          totalCredit: 0,
          closingBalance: 0,
          transactions: []
        };
      }

      return this.ledgerData;
    },

    // ------------------------------------------------------------------------
    // 6. LAPORAN KEUANGAN (LABA RUGI, ARUS KAS, NERACA)
    // ------------------------------------------------------------------------

    /**
     * 6A. Laporan Laba Rugi (P&L)
     */
    async loadLabaRugi(bulan) {
      let revPOS = 0;
      let revCatering = 0;
      let hpp = 0;
      let gaji = 0;
      let sewa = 0;
      let listrik = 0;
      let marketing = 0;
      let operasional = 0;

      // Hitung mutasi dari jurnal
      this.jurnalList.forEach(j => {
        const dAmt = Number(j.debitAmount) || 0;
        const cAmt = Number(j.creditAmount) || 0;

        // Pendapatan (Kredit menambah, Debit mengurangi)
        if (j.creditCode === '4001' || j.creditCode === '401') revPOS += cAmt;
        if (j.debitCode === '4001' || j.debitCode === '401') revPOS -= dAmt;

        if (j.creditCode === '4002' || j.creditCode === '402') revCatering += cAmt;
        if (j.debitCode === '4002' || j.debitCode === '402') revCatering -= dAmt;

        // HPP (Debit menambah, Kredit mengurangi)
        if (j.debitCode === '5001' || j.debitCode === '501') hpp += dAmt;
        if (j.creditCode === '5001' || j.creditCode === '501') hpp -= cAmt;

        // Beban Operasional (Debit menambah, Kredit mengurangi)
        if (j.debitCode === '6001' || j.debitCode === '601') gaji += dAmt;
        if (j.creditCode === '6001' || j.creditCode === '601') gaji -= cAmt;

        if (j.debitCode === '6002' || j.debitCode === '602') sewa += dAmt;
        if (j.creditCode === '6002' || j.creditCode === '602') sewa -= cAmt;

        if (j.debitCode === '6003' || j.debitCode === '603') listrik += dAmt;
        if (j.creditCode === '6003' || j.creditCode === '603') listrik -= cAmt;

        if (j.debitCode === '6004' || j.debitCode === '604') marketing += dAmt;
        if (j.creditCode === '6004' || j.creditCode === '604') marketing -= cAmt;

        if (j.debitCode === '6005' || j.debitCode === '605') operasional += dAmt;
        if (j.creditCode === '6005' || j.creditCode === '605') operasional -= cAmt;
      });

      // Tambahkan saldo dari COA jika belum terangkum
      const getAccBal = (code) => {
        const found = this.coaList.find(c => c.code === code);
        return found ? Number(found.currentBalance) || 0 : 0;
      };

      if (revPOS === 0 && getAccBal('4001') > 0) revPOS = getAccBal('4001');
      if (revCatering === 0 && getAccBal('4002') > 0) revCatering = getAccBal('4002');
      if (hpp === 0 && getAccBal('5001') > 0) hpp = getAccBal('5001');
      if (gaji === 0 && getAccBal('6001') > 0) gaji = getAccBal('6001');
      if (sewa === 0 && getAccBal('6002') > 0) sewa = getAccBal('6002');
      if (listrik === 0 && getAccBal('6003') > 0) listrik = getAccBal('6003');
      if (marketing === 0 && getAccBal('6004') > 0) marketing = getAccBal('6004');
      if (operasional === 0 && getAccBal('6005') > 0) operasional = getAccBal('6005');

      const totalPendapatan = revPOS + revCatering;
      const labaKotor = totalPendapatan - hpp;
      const totalBeban = gaji + sewa + listrik + marketing + operasional;
      const labaBersih = labaKotor - totalBeban;

      this.laporanData.pl = {
        pendapatanPOS: revPOS,
        pendapatanCatering: revCatering,
        totalPendapatan,
        hpp,
        labaKotor,
        bebanGaji: gaji,
        bebanSewa: sewa,
        bebanListrik: listrik,
        bebanMarketing: marketing,
        bebanOperasional: operasional,
        totalBeban,
        labaBersih
      };

      return this.laporanData.pl;
    },

    /**
     * 6B. Laporan Arus Kas (Cash Flow)
     */
    async loadArusKas(bulan) {
      let penerimaanPelanggan = 0;
      let pembayaranSupplier = 0;
      let pembayaranGaji = 0;
      let pembayaranOperasional = 0;

      let pembelianPeralatan = 0;
      let setoranModal = 0;
      let prive = 0;

      const isKasOrBank = (code) => code === '1001' || code === '1002' || code === '101' || code === '102';

      this.jurnalList.forEach(j => {
        const dAmt = Number(j.debitAmount) || 0;
        const cAmt = Number(j.creditAmount) || 0;

        // Arus Kas Masuk (DEBIT Kas / Bank)
        if (isKasOrBank(j.debitCode)) {
          if (j.creditCode === '4001' || j.creditCode === '4002' || j.creditCode === '1003' || j.creditCode === '401' || j.creditCode === '402' || j.creditCode === '103') {
            penerimaanPelanggan += dAmt;
          } else if (j.creditCode === '3001' || j.creditCode === '301') {
            setoranModal += dAmt;
          }
        }

        // Arus Kas Keluar (KREDIT Kas / Bank)
        if (isKasOrBank(j.creditCode)) {
          if (j.debitCode === '5001' || j.debitCode === '2001' || j.debitCode === '1004' || j.debitCode === '501' || j.debitCode === '201' || j.debitCode === '105') {
            pembayaranSupplier += cAmt;
          } else if (j.debitCode === '6001' || j.debitCode === '601') {
            pembayaranGaji += cAmt;
          } else if (j.debitCode === '6002' || j.debitCode === '6003' || j.debitCode === '6004' || j.debitCode === '6005' ||
                     j.debitCode === '602' || j.debitCode === '603' || j.debitCode === '604' || j.debitCode === '605') {
            pembayaranOperasional += cAmt;
          } else if (j.debitCode === '1005' || j.debitCode === '106') {
            pembelianPeralatan += cAmt;
          } else if (j.debitCode === '3003') {
            prive += cAmt;
          }
        }
      });

      const kasBersihOperasi = penerimaanPelanggan - (pembayaranSupplier + pembayaranGaji + pembayaranOperasional);
      const kasBersihInvestasi = -pembelianPeralatan;
      const kasBersihPendanaan = setoranModal - prive;
      const kenaikanKas = kasBersihOperasi + kasBersihInvestasi + kasBersihPendanaan;

      const kasAwal = ((this.coaList.find(c => c.code === '1001' || c.code === '101') || {}).initialBalance || 0) +
                      ((this.coaList.find(c => c.code === '1002' || c.code === '102') || {}).initialBalance || 0);
      const kasAkhir = kasAwal + kenaikanKas;

      this.laporanData.cashFlow = {
        penerimaanPelanggan,
        pembayaranSupplier,
        pembayaranGaji,
        pembayaranOperasional,
        kasBersihOperasi,
        pembelianPeralatan,
        kasBersihInvestasi,
        setoranModal,
        prive,
        kasBersihPendanaan,
        kenaikanKas,
        kasAwal,
        kasAkhir
      };

      return this.laporanData.cashFlow;
    },

    /**
     * 6C. Laporan Neraca (Balance Sheet - Aset = Kewajiban + Ekuitas)
     */
        async loadNeraca(bulan) {
      const getBal = (code) => {
        const f = this.coaList.find(c => c.code === code);
        return f ? Number(f.currentBalance) || 0 : 0;
      };

      // ✅ FIX BUG-20: Ambil dari COA list DULU (computed dari ledger)
      const kas = getBal('1001') || getBal('101') || 0;
      const bank = getBal('1002') || getBal('102') || 0;
      const piutang = getBal('1003') || getBal('103') || 0;
      const persediaan = getBal('1004') || getBal('105') || 0;
      const totalAsetLancar = kas + bank + piutang + persediaan;

      const peralatan = getBal('1005') || getBal('106') || 0;
      const totalAsetTetap = peralatan;
      
      // ✅ FIX: Total Aset HARUS = Aset Lancar + Aset Tetap
      // JANGAN pakai summary.totalAset kalau tidak match
      const totalAsetComputed = totalAsetLancar + totalAsetTetap;
      const summaryTotalAset = Number(this.summary?.totalAset);
      const totalAset = (!isNaN(summaryTotalAset) && Math.abs(summaryTotalAset - totalAsetComputed) < 100)
        ? summaryTotalAset
        : totalAsetComputed;  // Prioritas komputasi kalau beda

      // ✅ FIX: Kewajiban & Ekuitas dari COA list
      const hutangSupplier = getBal('2001') || getBal('201') || 0;
      const hutangBeban = getBal('2002') || 0;
      const totalKewajiban = hutangSupplier + hutangBeban;

      const modalPemilik = getBal('3001') || getBal('301') || 0;
      const labaDitahan = getBal('3002') || getBal('302') || 0;
      const labaBerjalan = Number(this.laporanData.pl.labaBersih) || 0;
      const prive = getBal('3003') || 0;
      
      // ✅ FIX: Ekuitas = Modal + Laba Ditahan + Laba Berjalan - Prive
      const totalEkuitas = modalPemilik + labaDitahan + labaBerjalan - prive;
      const totalKewajibanEkuitas = totalKewajiban + totalEkuitas;

      const selisih = Math.abs(totalAset - totalKewajibanEkuitas);
      const isBalance = selisih < 1000;

      this.laporanData.balanceSheet = {
        kas,
        bank,
        piutang,
        persediaan,
        totalAsetLancar,
        peralatan,
        totalAsetTetap,
        totalAset,
        hutangSupplier,
        hutangBeban,
        totalKewajiban,
        modalPemilik,
        labaDitahan,
        labaBerjalan,
        prive,
        totalEkuitas,
        totalKewajibanEkuitas,
        isBalance,
        selisih
      };

      console.log('[NERACA]', {
        totalAset,
        totalAsetComputed,
        totalKewajiban,
        totalEkuitas,
        totalKewajibanEkuitas,
        isBalance,
        selisih
      });

      return this.laporanData.balanceSheet;
    },

    // ------------------------------------------------------------------------
    // 7. DASHBOARD EXECUTIVE METRICS & CHART
    // ------------------------------------------------------------------------
    
    /**
     * Hitung ringkasan angka untuk Dashboard
     */
    async loadDashboard() {
      await this.loadLabaRugi(this.bulanAktif);
      await this.loadArusKas(this.bulanAktif);
      await this.loadNeraca(this.bulanAktif);

      this.renderCashFlowChart();
    },

    /**
     * Render Grafik Arus Kas 30 Hari (Chart.js)
     */
    renderCashFlowChart() {
      const canvas = document.getElementById('cashFlowChartCanvas');
      if (!canvas) return;

      if (_accountingChartInstance) {
        _accountingChartInstance.destroy();
        _accountingChartInstance = null;
      }

      // Generate 30 Hari Terakhir
      const labels = [];
      const inflowData = [];
      const outflowData = [];

      const today = new Date();
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dayLabel = `${d.getDate()}/${d.getMonth() + 1}`;
        labels.push(dayLabel);

        let dayInflow = 0;
        let dayOutflow = 0;

        const dateStr = d.toISOString().split('T')[0];
        this.jurnalList.forEach(j => {
          if (j.date === dateStr) {
            if (j.debitCode === '1001' || j.debitCode === '1002' || j.debitCode === '101' || j.debitCode === '102') {
              dayInflow += Number(j.debitAmount) || 0;
            }
            if (j.creditCode === '1001' || j.creditCode === '1002' || j.creditCode === '101' || j.creditCode === '102') {
              dayOutflow += Number(j.creditAmount) || 0;
            }
          }
        });

        inflowData.push(dayInflow);
        outflowData.push(dayOutflow);
      }

      const ctx = canvas.getContext('2d');
      _accountingChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Kas Masuk (Inflow)',
              data: inflowData,
              borderColor: '#10b981', // emerald-500
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              borderWidth: 2.5,
              tension: 0.35,
              fill: true,
              pointRadius: 2,
              pointHoverRadius: 5
            },
            {
              label: 'Kas Keluar (Outflow)',
              data: outflowData,
              borderColor: '#f43f5e', // rose-500
              backgroundColor: 'rgba(244, 63, 94, 0.04)',
              borderWidth: 2,
              tension: 0.35,
              fill: true,
              pointRadius: 2,
              pointHoverRadius: 5
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            legend: {
              display: false
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  let label = context.dataset.label || '';
                  if (label) label += ': ';
                  if (context.parsed.y !== null) {
                    label += 'Rp ' + Number(context.parsed.y).toLocaleString('id-ID');
                  }
                  return label;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { font: { size: 10, family: 'Plus Jakarta Sans' }, color: '#78716c' }
            },
            y: {
              grid: { color: '#f5f5f4' },
              ticks: {
                font: { size: 10, family: 'JetBrains Mono' },
                color: '#78716c',
                callback: function(val) {
                  return 'Rp ' + (val / 1000).toLocaleString('id-ID') + 'k';
                }
              }
            }
          }
        }
      });
    },

    // ------------------------------------------------------------------------
    // 7b. LAPORAN TRANSAKSI DETAIL (POS + Online-rekonsiliasi + Void)
    // ------------------------------------------------------------------------
    // Sumber data TUNGGAL: GET /pos/transactions?month=YYYY-MM (1 request per periode,
    // endpoint range/month sudah didukung backend — lihat CLEANUP-1).
    // Order online yang tampil di sini hanya yang sudah masuk /pos/transactions (reconciled).

    /** Peta id menu → nama (1 request /menu, di-cache per sesi halaman). */
    async loadMenuNameMap() {
      if (this._menuNameMap && Object.keys(this._menuNameMap).length > 0) return this._menuNameMap;
      const map = {};
      try {
        const res = await fetch('/menu');
        const ct = res.headers.get('content-type') || '';
        if (res.ok && ct.includes('application/json')) {
          const json = await res.json();
          const list = Array.isArray(json.data) ? json.data : [];
          list.forEach(m => { if (m && m.id) map[m.id] = m.name || m.id; });
        }
      } catch (e) {
        console.warn('[TX-DETAIL] nama menu gagal dimuat, pakai id menu:', e && e.message ? e.message : e);
      }
      this._menuNameMap = map;
      return map;
    },

    /** Items ringkas: handle format POS [[id, qty, price]] maupun object. */
    txDetailItemsText(items) {
      const list = Array.isArray(items) ? items : [];
      const map = this._menuNameMap || {};
      return list.map(it => {
        if (Array.isArray(it)) {
          const id = it[0];
          const qty = Number(it[1]) || 1;
          return `${map[id] || id || 'Item'} x${qty}`;
        }
        const qty = Number(it.qty || it.quantity) || 1;
        return `${it.name || map[it.id] || it.id || 'Item'} x${qty}`;
      }).join(', ');
    },

    /** Order online = sumber landing page / punya online_order_id (Q2: reconciled only). */
    isOnlineTx(t) {
      if (!t) return false;
      const oid = t.online_order_id;
      return t.source === 'landing-page' || (oid !== undefined && oid !== null && oid !== '');
    },

    txDetailMethod(t) {
      if (this.isOnlineTx(t)) return 'Online / Rekonsiliasi';
      const pm = String((t && (t.pm || t.paymentMethod)) || '').toLowerCase();
      if (pm.includes('qris')) return 'QRIS';
      if (pm.includes('transfer') || pm.includes('bank') || pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo') || pm.includes('dana') || pm.includes('shopee')) return 'Transfer / E-Wallet';
      return 'Tunai';
    },

    txDetailSumber(t) {
      if (t && t.voided === true) return 'Void';
      if (this.isOnlineTx(t)) return 'Online-rekonsiliasi';
      return 'POS langsung';
    },

    /**
     * Muat + kelompokkan transaksi 1 periode bulan (YYYY-MM).
     * Hasil: this.txDetail { rows, groups, voidRows, totals }
     */
    async loadTransaksiDetail(bulan, mode) {
      const rangeMode = (mode === 'week' || mode === 'month') ? mode : (this.txDetail.rangeMode || 'month');
      this.txDetail.rangeMode = rangeMode;
      const pad = (n) => String(n).padStart(2, '0');
      const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      let url = '';
      let periode = '';
      let periodeFile = '';
      if (rangeMode === 'week') {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 6);
        const s = fmtDate(start);
        const e = fmtDate(end);
        url = `/pos/transactions?start=${s}&end=${e}`;
        periode = `Mingguan (7 hari) ${s} s/d ${e}`;
        periodeFile = `${s}_${e}`;
      } else {
        const p = String(bulan || this.exportForm.period || this.bulanAktif || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(p)) {
          this.txDetail.error = 'Periode tidak valid (format YYYY-MM)';
          return this.txDetail;
        }
        url = `/pos/transactions?month=${p}`;
        periode = p;
        periodeFile = p;
      }

      this.txDetail.loading = true;
      this.txDetail.error = '';
      try {
        await this.loadMenuNameMap();
        const res = await fetch(url);
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('application/json')) {
          throw new Error('endpoint /pos/transactions tidak mengembalikan JSON (HTTP ' + res.status + ')');
        }
        const json = await res.json();
        const raw = Array.isArray(json.data) ? json.data : [];

        const rows = raw.map(t => {
          const ts = Number(t.t) || Number(t.timestamp) || 0;
          const sub = Number(t.sub !== undefined ? t.sub : (t.subtotal || 0)) || 0;
          const disc = Number(t.disc !== undefined ? t.disc : (t.discount || 0)) || 0;
          const tax = Number(t.tax || t.pajak || 0) || 0;
          const tot = Number(t.tot !== undefined ? t.tot : (t.total || 0)) || 0;
          const isVoid = t.voided === true;
          return {
            id: t.id || t.orderId || '-',
            orderId: t.online_order_id || t.orderId || t.id || '-',
            tanggal: t.date || (ts ? new Date(ts).toISOString().slice(0, 10) : ''),
            jam: ts ? new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : (t.time || '-'),
            metode: this.txDetailMethod(t),
            sumber: this.txDetailSumber(t),
            itemsText: this.txDetailItemsText(t.items),
            subtotal: sub,
            diskon: disc,
            pajak: tax,
            total: tot,
            status: isVoid ? 'VOID' : 'Normal',
            isVoid,
            kasir: t.ksr || t.kasir || t.cashier || '-',
            shift: t.shf || t.shiftId || '-',
            voidReason: t.voidReason || t.void_reason || ''
          };
        }).sort((a, b) => String(a.tanggal + a.jam).localeCompare(String(b.tanggal + b.jam)));

        const normal = rows.filter(r => !r.isVoid);
        const voidRows = rows.filter(r => r.isVoid);
        const urutan = ['Tunai', 'QRIS', 'Transfer / E-Wallet', 'Online / Rekonsiliasi'];
        const groups = urutan.map(m => {
          const list = normal.filter(r => r.metode === m);
          return { metode: m, rows: list, count: list.length, subtotal: list.reduce((s, r) => s + r.total, 0) };
        }).filter(g => g.count > 0);

        this.txDetail.periode = periode;
        this.txDetail.periodeFile = periodeFile;
        this.txDetail.rows = rows;
        this.txDetail.groups = groups;
        this.txDetail.voidRows = voidRows;
        this.txDetail.totals = {
          count: normal.length,
          subtotal: normal.reduce((s, r) => s + r.subtotal, 0),
          diskon: normal.reduce((s, r) => s + r.diskon, 0),
          pajak: normal.reduce((s, r) => s + r.pajak, 0),
          total: normal.reduce((s, r) => s + r.total, 0),
          voidCount: voidRows.length,
          voidTotal: voidRows.reduce((s, r) => s + r.total, 0)
        };
        console.log(`[TX-DETAIL] ${periode}: ${normal.length} transaksi (${groups.length} metode) + ${voidRows.length} void`);
        return this.txDetail;
      } catch (e) {
        this.txDetail.error = 'Gagal memuat transaksi: ' + (e && e.message ? e.message : e);
        this.txDetail.rows = [];
        this.txDetail.groups = [];
        this.txDetail.voidRows = [];
        return this.txDetail;
      } finally {
        this.txDetail.loading = false;
      }
    },

    /** Dipanggil saat dropdown "Jenis Laporan" berubah. */
    async onReportTypeChange() {
      if (this.exportForm.reportType === 'txDetail') {
        await this.loadTransaksiDetail(this.exportForm.period);
      }
    },

    /** Alias aman: handleExportData lama memanggil generatePDFReport() yang tidak pernah ada. */
    generatePDFReport(type, bulan) {
      if (type === 'txDetail') return this.exportTxDetailPDF(bulan);
      return this.exportPDF(type, bulan);
    },

    // ------------------------ EXPORT: PDF TRANSAKSI DETAIL -------------------
    txDetailLine(doc, y, r, idx) {
      const X = { tglJam: 10, order: 34, metode: 70, items: 102, sub: 190, disc: 206, tax: 222, tot: 240, status: 258 };
      const isVoid = r.isVoid;
      const itemsLines = doc.splitTextToSize(String(r.itemsText || '-'), 86);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      if (isVoid) doc.setTextColor(150, 30, 30);
      doc.text(`${r.tanggal || '-'} ${r.jam || ''}`.trim(), X.tglJam, y);
      doc.text(String(r.orderId || '-').slice(0, 30), X.order, y);
      doc.text(String(r.metode || '-').slice(0, 22), X.metode, y);
      doc.text(String(itemsLines[0] || '-').slice(0, 60), X.items, y);
      doc.text(formatRupiah(r.subtotal), X.sub, y, { align: 'right' });
      doc.text(r.diskon > 0 ? '-' + formatRupiah(r.diskon) : '-', X.disc, y, { align: 'right' });
      doc.text(r.pajak > 0 ? formatRupiah(r.pajak) : '-', X.tax, y, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(isVoid ? '(VOID) ' + formatRupiah(r.total) : formatRupiah(r.total), X.tot, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.text(isVoid ? 'VOID' : 'Normal', X.status, y);
      doc.setTextColor(0, 0, 0);

      // baris kedua: kasir/shift/sumber + kelanjutan nama menu
      doc.setFontSize(7);
      doc.setTextColor(110, 110, 110);
      doc.text(`Kasir: ${r.kasir}  Shift: ${r.shift}  Sumber: ${r.sumber}${isVoid && r.voidReason ? '  Alasan: ' + r.voidReason : ''}`, X.order, y + 3.6);
      doc.setTextColor(0, 0, 0);
      y += 7;

      if (itemsLines.length > 1) {
        doc.setFontSize(7);
        doc.setTextColor(110, 110, 110);
        itemsLines.slice(1, 3).forEach(extra => { doc.text(String(extra).slice(0, 60), X.items, y - 3.4); y += 3.4; });
        doc.setTextColor(0, 0, 0);
      }
      return y;
    },

    txDetailPageBreak(doc, y, need = 14) {
      if (y + need <= 195) return y;
      doc.addPage('a4', 'landscape');
      return 20;
    },

    async exportTxDetailPDF(bulan) {
      try {
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) { this.showToast('Pustaka jsPDF belum dimuat', 'error'); return; }

        const data = (this.txDetail && this.txDetail.rows && this.txDetail.rows.length > 0
          && this.txDetail.periodeFile === String(bulan || '').slice(0, 7))
          ? this.txDetail
          : await this.loadTransaksiDetail(bulan);
        const periodeStr = data.periode || bulan || this.bulanAktif;
        if (!data.rows || data.rows.length === 0) {
          this.showToast('Tidak ada transaksi pada periode ' + periodeStr, 'info');
        }

        // pastikan nama outlet terbaru (site_config.brandName) — kalau fetch saat init sempat gagal
        if (!this.siteName || this.siteName === 'Dapur Kuliner Viral') {
          try { await this.loadSiteName(); } catch (e) {}
        }
        const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
        const brand = String(this.siteName || 'DAPUR KULINER VIRAL').toUpperCase();

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(15);
        doc.text(brand, 148, 14, { align: 'center' });
        doc.setFontSize(12);
        doc.text('LAPORAN TRANSAKSI DETAIL', 148, 21, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.text(`Periode: ${periodeStr}  |  Dicetak: ${new Date().toLocaleString('id-ID')}`, 148, 25, { align: 'center' });

        const X = { tglJam: 10, order: 34, metode: 70, items: 102, sub: 190, disc: 206, tax: 222, tot: 240, status: 258 };
        let y = 36;

        // Header kolom
        const headerKolom = () => {
          doc.setFillColor(240, 240, 240);
          doc.rect(8, y - 4.5, 281, 6.5, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.text('TANGGAL & JAM', X.tglJam, y);
          doc.text('ORDER ID', X.order, y);
          doc.text('METODE', X.metode, y);
          doc.text('ITEMS', X.items, y);
          doc.text('SUBTOTAL', X.sub, y, { align: 'right' });
          doc.text('DISKON', X.disc, y, { align: 'right' });
          doc.text('PAJAK', X.tax, y, { align: 'right' });
          doc.text('TOTAL', X.tot, y, { align: 'right' });
          doc.text('STATUS', X.status, y);
          y += 5;
          doc.setFont('helvetica', 'normal');
        };

        headerKolom();

        // Section per metode (+ subtotal)
        (data.groups || []).forEach(g => {
          y = this.txDetailPageBreak(doc, y, 20);
          if (y === 20) headerKolom();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(5, 120, 90);
          doc.text(`METODE: ${String(g.metode).toUpperCase()} — ${g.count} transaksi`, 10, y);
          doc.setTextColor(0, 0, 0);
          y += 5;
          g.rows.forEach(r => {
            y = this.txDetailPageBreak(doc, y, 12);
            if (y === 20) headerKolom();
            y = this.txDetailLine(doc, y, r, 0);
          });
          y = this.txDetailPageBreak(doc, y, 12);
          if (y === 20) headerKolom();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.text(`Subtotal ${g.metode}:`, X.metode - 40, y);
          doc.text(formatRupiah(g.subtotal), X.tot, y, { align: 'right' });
          y += 8;
        });

        // Section VOID (audit trail, Q3)
        if ((data.voidRows || []).length > 0) {
          y = this.txDetailPageBreak(doc, y, 24);
          if (y === 20) headerKolom();
          doc.setFillColor(254, 226, 226);
          doc.rect(8, y - 4.5, 281, 6.5, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9.5);
          doc.setTextColor(160, 20, 20);
          doc.text(`TRANSAKSI VOID / DIBATALKAN — ${data.voidRows.length} transaksi (audit, TIDAK dihitung sebagai penjualan)`, 10, y);
          doc.setTextColor(0, 0, 0);
          y += 6;
          data.voidRows.forEach(r => {
            y = this.txDetailPageBreak(doc, y, 12);
            if (y === 20) headerKolom();
            y = this.txDetailLine(doc, y, r, 0);
          });
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.text('Total VOID (tidak masuk penjualan):', X.metode - 60, y);
          doc.text('(VOID) ' + formatRupiah(data.totals.voidTotal), X.tot, y, { align: 'right' });
          y += 9;
        }

        // Ringkasan total
        y = this.txDetailPageBreak(doc, y, 30);
        if (y === 20) headerKolom();
        doc.setFillColor(236, 253, 245);
        doc.rect(8, y - 4.5, 281, 7, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(5, 120, 90);
        doc.text(`GRAND TOTAL PENJUALAN (${data.totals.count} transaksi normal)`, 10, y);
        doc.text(formatRupiah(data.totals.total), X.tot + 18, y, { align: 'right' });
        doc.setTextColor(0, 0, 0);
        y += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`Rincian: Subtotal ${formatRupiah(data.totals.subtotal)} — Diskon -${formatRupiah(data.totals.diskon)} — Pajak ${formatRupiah(data.totals.pajak)}`, 10, y);
        y += 14;

        // Tanda tangan
        if (y > 170) { doc.addPage('a4', 'landscape'); y = 30; }
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Disiapkan oleh:', 30, y);
        doc.text('Disetujui oleh:', 200, y);
        doc.text('( Bagian Keuangan )', 30, y + 18);
        doc.text('( Owner / Direksi )', 200, y + 18);

        const fileTag = data.periodeFile || periodeStr;
        const filename = `Laporan_Transaksi_Detail_${fileTag}.pdf`;
        doc.save(filename);
        this.addExportHistory('Laporan Transaksi Detail', periodeStr, 'PDF');
        this.showToast(`Laporan ${filename} berhasil diunduh!`, 'success');
      } catch (err) {
        console.error('[TX-DETAIL] export PDF error:', err);
        this.showToast('Gagal membuat PDF transaksi detail', 'error');
      }
    },

    // ------------------------ EXPORT: CSV TRANSAKSI DETAIL -------------------
    async exportTxDetailCSV(bulan) {
      try {
        const data = (this.txDetail && this.txDetail.rows && this.txDetail.rows.length > 0)
          ? this.txDetail
          : await this.loadTransaksiDetail(bulan);
        const periodeStr = data.periode || bulan || this.bulanAktif;
        const esc = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;

        let csv = 'Tanggal,Jam,Order ID,Metode,Items,Subtotal,Diskon,Pajak,Total,Status,Kasir,Shift,Sumber,Alasan Void\n';
        (data.rows || []).forEach(r => {
          csv += `${esc(r.tanggal)},${esc(r.jam)},${esc(r.orderId)},${esc(r.metode)},${esc(r.itemsText)},${r.subtotal},${r.diskon},${r.pajak},${r.total},${esc(r.status)},${esc(r.kasir)},${esc(r.shift)},${esc(r.sumber)},${esc(r.voidReason)}\n`;
        });

        csv += '\nSUBTOTAL PER METODE (tanpa void)\nMetode,Jumlah Order,Subtotal\n';
        (data.groups || []).forEach(g => { csv += `${esc(g.metode)},${g.count},${g.subtotal}\n`; });
        csv += `\nTOTAL PENJUALAN,,${data.totals.total}\n`;
        csv += `TOTAL VOID (audit),${data.totals.voidCount},${data.totals.voidTotal}\n`;

        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Laporan_Transaksi_Detail_${data.periodeFile || periodeStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.addExportHistory('Laporan Transaksi Detail', periodeStr, 'CSV');
        this.showToast('File CSV transaksi detail berhasil diunduh', 'success');
      } catch (e) {
        console.error('[TX-DETAIL] export CSV error:', e);
        this.showToast('Gagal export CSV transaksi detail', 'error');
      }
    },

    // ------------------------------------------------------------------------
    // 8. EXPORT DATA (PDF & CSV GENERATOR)
    // ------------------------------------------------------------------------

    // ------------------------ HELPERS LAYOUT LAPORAN PDF ----------------------
    /** Header dokumen standar (brand + judul + periode). Return y awal konten. */
    reportHeader(doc, title, periodeStr, generatedDate) {
      const brand = sanitizeText(String(this.siteName || 'DAPUR KULINER VIRAL')).toUpperCase();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(brand, 105, 18, { align: 'center' });
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text('Sistem Akuntansi & Laporan Keuangan', 105, 24, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(sanitizeText(title), 105, 33, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'italic');
      doc.text(`Periode: ${sanitizeText(periodeStr)} | Dicetak: ${sanitizeText(generatedDate)}`, 105, 38, { align: 'center' });
      doc.line(15, 42, 195, 42);
      return 50;
    },

    /** Blok tanda tangan di akhir laporan. */
    reportSignature(doc, y) {
      if (y > 245) { doc.addPage('a4', 'portrait'); y = 30; }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('Disiapkan oleh:', 30, y + 10);
      doc.text('Disetujui oleh:', 140, y + 10);
      doc.text('( Bagian Keuangan )', 30, y + 30);
      doc.text('( Owner / Direksi )', 140, y + 30);
    },

    /** Page break portrait sederhana. */
    reportPageBreak(doc, y, need = 20) {
      if (y + need <= 275) return y;
      doc.addPage('a4', 'portrait');
      return 20;
    },

    /** Baris nilai laporan (label + nominal rata kanan). */
    reportLine(doc, y, label, val, opts = {}) {
      const { bold = false, indent = 0, signed = false, size = 9.5 } = opts;
      y = this.reportPageBreak(doc, y, 7);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(bold ? 10 : size);
      const text = signed ? formatRupiahSigned(val) : formatRupiah(val);
      doc.text(label, 15 + indent, y);
      doc.text(text, 195, y, { align: 'right' });
      return y + (bold ? 7 : 5.5);
    },

    /** Muat ulang data akuntansi untuk periode terpilih (biar laporan selalu segar). */
    async ensureReportData(bulan) {
      const target = bulan || this.bulanAktif;
      try {
        if (target !== this.bulanAktif) this.bulanAktif = target;
        await this.loadSummary(target);
        await this.loadLedgerMap(target);
        await this.loadCOA();
        await this.loadJournal(target);
        await this.loadLabaRugi(target);
        await this.loadArusKas(target);
        await this.loadNeraca(target);
      } catch (e) {
        console.warn('[ACCT-APP] ensureReportData error:', e);
      }
    },

    // ------------------------ SECTION LAPORAN PDF -----------------------------
    plSection(doc, y) {
      const pl = this.laporanData.pl;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('I. PENDAPATAN OPERASIONAL', 15, y); y += 6;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text('Pendapatan Penjualan POS Kasir', 20, y);
      doc.text(formatRupiah(pl.pendapatanPOS), 195, y, { align: 'right' }); y += 5;

      doc.text('Pendapatan Pesanan Catering', 20, y);
      doc.text(formatRupiah(pl.pendapatanCatering), 195, y, { align: 'right' }); y += 5;

      doc.setFont('helvetica', 'bold');
      doc.text('TOTAL PENDAPATAN', 20, y);
      doc.text(formatRupiah(pl.totalPendapatan), 195, y, { align: 'right' }); y += 8;

      doc.text('II. HARGA POKOK PENJUALAN (HPP)', 15, y); y += 6;
      doc.setFont('helvetica', 'normal');
      doc.text('Harga Pokok Penjualan Bahan Baku', 20, y);
      doc.text('(' + formatRupiah(pl.hpp) + ')', 195, y, { align: 'right' }); y += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('LABA KOTOR', 15, y);
      doc.text(formatRupiah(pl.labaKotor), 195, y, { align: 'right' }); y += 8;

      doc.text('III. BEBAN OPERASIONAL', 15, y); y += 6;
      doc.setFont('helvetica', 'normal');
      doc.text('Beban Gaji Karyawan', 20, y); doc.text(formatRupiah(pl.bebanGaji), 195, y, { align: 'right' }); y += 5;
      doc.text('Beban Sewa Tempat & Outlet', 20, y); doc.text(formatRupiah(pl.bebanSewa), 195, y, { align: 'right' }); y += 5;
      doc.text('Beban Listrik, Air & Gas', 20, y); doc.text(formatRupiah(pl.bebanListrik), 195, y, { align: 'right' }); y += 5;
      doc.text('Beban Marketing & Iklan', 20, y); doc.text(formatRupiah(pl.bebanMarketing), 195, y, { align: 'right' }); y += 5;
      doc.text('Beban Operasional & Kurir', 20, y); doc.text(formatRupiah(pl.bebanOperasional), 195, y, { align: 'right' }); y += 6;

      doc.setFont('helvetica', 'bold');
      doc.text('TOTAL BEBAN OPERASIONAL', 20, y);
      doc.text('(' + formatRupiah(pl.totalBeban) + ')', 195, y, { align: 'right' }); y += 8;

      doc.setFillColor(240, 253, 244);
      doc.rect(15, y - 4, 180, 8, 'F');
      doc.setTextColor(5, 150, 105);
      doc.text('LABA BERSIH (NET PROFIT)', 20, y + 1.5);
      doc.text(formatRupiah(pl.labaBersih), 190, y + 1.5, { align: 'right' });
      doc.setTextColor(0, 0, 0);
      y += 18;
      return y;
    },

    cashFlowSection(doc, y) {
      const cf = this.laporanData.cashFlow || {};
      const line = (label, val, bold, signed) => this.reportLine(doc, y, label, val, { bold, signed });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('A. AKTIVITAS OPERASI', 15, y); y += 7;
      y = line('Penerimaan dari Pelanggan', cf.penerimaanPelanggan);
      y = line('Pembayaran ke Supplier / Bahan Baku', cf.pembayaranSupplier, false, true);
      y = line('Pembayaran Gaji Karyawan', cf.pembayaranGaji, false, true);
      y = line('Pembayaran Beban Operasional', cf.pembayaranOperasional, false, true);
      y = line('Kas Bersih dari Aktivitas Operasi', cf.kasBersihOperasi, true, true);
      y += 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('B. AKTIVITAS INVESTASI', 15, y); y += 7;
      y = line('Pembelian Peralatan & Mesin', cf.pembelianPeralatan, false, true);
      y = line('Kas Bersih dari Aktivitas Investasi', cf.kasBersihInvestasi, true, true);
      y += 4;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('C. AKTIVITAS PENDANAAN', 15, y); y += 7;
      y = line('Setoran Modal Pemilik', cf.setoranModal);
      y = line('Penarikan Prive', cf.prive, false, true);
      y = line('Kas Bersih dari Aktivitas Pendanaan', cf.kasBersihPendanaan, true, true);
      y += 4;
      y = line('KENAIKAN (PENURUNAN) BERSIH KAS', cf.kenaikanKas, true, true);
      y = line('Saldo Kas Awal Periode', cf.kasAwal);
      y = line('SALDO KAS AKHIR PERIODE', cf.kasAkhir, true);
      return y;
    },

    balanceSheetSection(doc, y) {
      const bs = this.laporanData.balanceSheet || {};
      const line = (label, val, opts = {}) => this.reportLine(doc, y, label, val, opts);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('ASET', 15, y); y += 7;
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold');
      doc.text('Aset Lancar', 20, y); y += 6;
      y = line('Kas di Tangan', bs.kas, { indent: 6 });
      y = line('Kas di Bank', bs.bank, { indent: 6 });
      y = line('Piutang Usaha', bs.piutang, { indent: 6 });
      y = line('Persediaan Bahan Baku', bs.persediaan, { indent: 6 });
      y = line('Total Aset Lancar', bs.totalAsetLancar, { indent: 6, bold: true });
      y += 3;
      doc.setFont('helvetica', 'bold');
      doc.text('Aset Tetap', 20, y); y += 6;
      y = line('Peralatan & Mesin Dapur', bs.peralatan, { indent: 6 });
      y = line('Total Aset Tetap', bs.totalAsetTetap, { indent: 6, bold: true });
      y += 3;
      y = line('TOTAL ASET', bs.totalAset, { bold: true });
      y += 6;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('KEWAJIBAN & EKUITAS', 15, y); y += 7;
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold');
      doc.text('Kewajiban', 20, y); y += 6;
      y = line('Hutang Dagang / Supplier', bs.hutangSupplier, { indent: 6 });
      y = line('Hutang Beban & Operasional', bs.hutangBeban, { indent: 6 });
      y = line('Total Kewajiban', bs.totalKewajiban, { indent: 6, bold: true });
      y += 3;
      doc.setFont('helvetica', 'bold');
      doc.text('Ekuitas', 20, y); y += 6;
      y = line('Modal Pemilik', bs.modalPemilik, { indent: 6 });
      y = line('Laba Ditahan', bs.labaDitahan, { indent: 6 });
      y = line('Laba (Rugi) Berjalan', bs.labaBerjalan, { indent: 6, signed: true });
      y = line('Prive Pemilik', bs.prive, { indent: 6, signed: true });
      y = line('Total Ekuitas', bs.totalEkuitas, { indent: 6, bold: true });
      y += 3;
      y = line('TOTAL KEWAJIBAN & EKUITAS', bs.totalKewajibanEkuitas, { bold: true });
      y += 4;
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9);
      doc.setTextColor(bs.isBalance ? 5 : 180, bs.isBalance ? 150 : 30, bs.isBalance ? 105 : 30);
      doc.text(bs.isBalance ? 'Neraca seimbang (Aset = Kewajiban + Ekuitas)' : ('Neraca TIDAK seimbang — selisih ' + formatRupiah(bs.selisih)), 15, y);
      doc.setTextColor(0, 0, 0);
      y += 8;
      return y;
    },

    journalSection(doc, y) {
      const accName = (code, name) => {
        if (name) return String(name);
        const m = { '1001':'Kas di Tangan','1002':'Kas di Bank','1003':'Piutang Usaha','1004':'Persediaan Bahan Baku','1005':'Peralatan & Mesin Dapur','2001':'Hutang Dagang / Supplier','2002':'Hutang Beban & Operasional','3001':'Modal Pemilik','3002':'Laba Ditahan','3003':'Prive Pemilik','4001':'Pendapatan Penjualan POS','4002':'Pendapatan Pesanan Catering','5001':'Harga Pokok Penjualan (HPP)','6001':'Beban Gaji Karyawan','6002':'Beban Sewa Tempat','6003':'Beban Listrik, Air & Gas','6004':'Beban Marketing & Iklan','6005':'Beban Operasional & Kurir','6006':'Beban Penyusutan' };
        return m[String(code)] || ('Akun ' + code);
      };
      const list = (this.jurnalList || [])
        .filter(j => j && (j.status === 'approved' || !j.status))
        .slice()
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
      const X = { tgl: 15, ref: 36, desc: 64, acc: 112, deb: 168, kre: 195 };
      const LINE_H = 4.5;
      // Kolom No Ref (x36→64 = 28mm) cukup untuk ref maksimal 18 karakter,
      // misal "INV-20261007-5CR" (17 char) tanpa tumpang tindih ke Keterangan.
      const REF_W = X.desc - X.ref - 2;
      // Keterangan WAJIB wrap dengan splitTextToSize, lebar dibatasi hingga batas
      // kolom Akun (x112) minus margin, tepat agar tidak timpa Akun sebelahnya.
      const DESC_W = X.acc - X.desc - 2; // 46mm (x64→110), kolom AKUN dimulai x112
      // Akun WAJIB wrap dengan splitTextToSize, lebar dibatasi hingga batas
      // kolom Debit (x168) minus margin, agar nama akun panjang tidak timpa Debit/Kredit.
      const ACC_W = X.deb - X.acc - 2; // 54mm (x112→166), kolom DEBIT dimulai x168
      const drawHeader = () => {
        doc.setFillColor(240, 240, 240);
        doc.rect(15, y - 4.5, 180, 6.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
        doc.text('TANGGAL', X.tgl, y);
        doc.text('NO REF', X.ref, y);
        doc.text('KETERANGAN', X.desc, y);
        doc.text('AKUN', X.acc, y);
        doc.text('DEBIT', X.deb, y, { align: 'right' });
        doc.text('KREDIT', X.kre, y, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        y += 5;
      };
      drawHeader();
      if (list.length === 0) {
        doc.setFontSize(9); doc.setTextColor(120, 120, 120);
        doc.text('Tidak ada jurnal pada periode ini.', 15, y + 4);
        doc.setTextColor(0, 0, 0);
        y += 12;
      } else {
        const LINE_H = 4.5;
        list.forEach(j => {
          const dName = sanitizeText(accName(j.debitCode, j.debitName));
          const cName = sanitizeText(accName(j.creditCode, j.creditName));
          const descLines = doc.splitTextToSize(sanitizeText(String(j.desc || '-')), DESC_W);
          const dLines = doc.splitTextToSize(dName, ACC_W);
          const cLines = doc.splitTextToSize(cName, ACC_W);
          const numBody = Math.max(descLines.length, dLines.length, 1);
          const need = LINE_H * (numBody + 2); // body + 1 baris kredit + spasi antar entri
          y = this.reportPageBreak(doc, y, need);
          if (y === 20) drawHeader();
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
          doc.text(String(j.date || '-').slice(0, 10), X.tgl, y);
          const refLines = doc.splitTextToSize(sanitizeText(String(j.noEntry || j.ref || '-')).slice(0, 18), REF_W);
          doc.text(refLines[0] || '-', X.ref, y);
          // Baris pertama entri: keterangan + akun debit + nominal debet (satu grup per entri)
          doc.text(descLines[0] || '-', X.desc, y);
          doc.text(dLines[0] || '-', X.acc, y);
          doc.text(formatRupiah(j.debitAmount), X.deb, y, { align: 'right' });
          // Sisa baris keterangan / akun debit yang wrap ke bawah
          for (let k = 1; k < numBody; k++) {
            const ky = y + k * LINE_H;
            if (descLines[k]) doc.text(descLines[k], X.desc, ky);
            if (dLines[k]) doc.text(dLines[k], X.acc, ky);
          }
          // Baris kredit: akun kredit + nominal kredit, selalu di baris tersendiri di bawah debet
          const creditY = y + numBody * LINE_H;
          doc.text(cLines[0] || '-', X.acc, creditY);
          doc.text(formatRupiah(j.creditAmount), X.kre, creditY, { align: 'right' });
          for (let k = 1; k < cLines.length; k++) {
            doc.text(cLines[k], X.acc, creditY + k * LINE_H);
          }
          y = creditY + cLines.length * LINE_H + LINE_H;
        });
        const totalDebit = list.reduce((s, j) => s + (Number(j.debitAmount) || 0), 0);
        const totalCredit = list.reduce((s, j) => s + (Number(j.creditAmount) || 0), 0);
        y = this.reportPageBreak(doc, y, 10);
        if (y === 20) drawHeader();
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.text('TOTAL', X.desc, y);
        doc.text(formatRupiah(totalDebit), X.deb, y, { align: 'right' });
        doc.text(formatRupiah(totalCredit), X.kre, y, { align: 'right' });
        y += 7;
      }
      return y;
    },

    async ledgerSection(doc, y, bulan) {
      const accounts = (this.coaList || []).slice().sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      const X = { tgl: 15, desc: 33, deb: 130, kre: 155, saldo: 195 };
      for (const acc of accounts) {
        const ld = await this.loadLedger(acc.code, bulan);
        y = this.reportPageBreak(doc, y, 30);
        doc.setFillColor(245, 245, 245);
        doc.rect(15, y - 5, 180, 7, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
        doc.text(`${acc.code} — ${sanitizeText(acc.name || (ld.account && ld.account.name) || '')} (${acc.type || ''})`, 17, y);
        y += 6;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        doc.text('Saldo Awal:', 17, y);
        doc.text(formatRupiah(ld.openingBalance), X.saldo, y, { align: 'right' });
        y += 5.5;
        if ((ld.transactions || []).length > 0) {
          doc.setFillColor(240, 240, 240);
          doc.rect(15, y - 4, 180, 6, 'F');
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
          doc.text('TANGGAL', X.tgl, y);
          doc.text('KETERANGAN', X.desc, y);
          doc.text('DEBIT', X.deb, y, { align: 'right' });
          doc.text('KREDIT', X.kre, y, { align: 'right' });
          doc.text('SALDO', X.saldo, y, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          y += 4.5;
          const txs = Array.isArray(ld.transactions) ? ld.transactions : [];
          txs.forEach(t => {
            // Normalisasi: handle format data bervariasi per akun (date/tgl, desc/keterangan,
            // debit/credit vs dr/cr/debitAmount/creditAmount, runningBalance vs saldo/balance)
            const n = {
              tanggal: t.date || t.tanggal || t.tgl || '-',
              keterangan: t.desc || t.keterangan || '-',
              debit: Number(t.debit ?? t.dr ?? t.debitAmount ?? 0) || 0,
              credit: Number(t.credit ?? t.cr ?? t.creditAmount ?? 0) || 0,
              saldo: Number(t.runningBalance ?? t.saldo ?? t.balance ?? 0) || 0
            };
            y = this.reportPageBreak(doc, y, 8);
            doc.setFontSize(7.5);
            doc.text(String(n.tanggal).slice(0, 10), X.tgl, y);
            doc.text(String(sanitizeText(n.keterangan)).slice(0, 48), X.desc, y);
            doc.text(n.debit ? formatRupiah(n.debit) : '-', X.deb, y, { align: 'right' });
            doc.text(n.credit ? formatRupiah(n.credit) : '-', X.kre, y, { align: 'right' });
            doc.text(formatRupiah(n.saldo), X.saldo, y, { align: 'right' });
            y += 4;
          });
        }
        y = this.reportPageBreak(doc, y, 12);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
        doc.text('TOTAL MUTASI', X.desc, y);
        doc.text(formatRupiah(ld.totalDebit), X.deb, y, { align: 'right' });
        doc.text(formatRupiah(ld.totalCredit), X.kre, y, { align: 'right' });
        y += 5.5;
        doc.text('SALDO AKHIR', X.desc, y);
        doc.text(formatRupiah(ld.closingBalance), X.saldo, y, { align: 'right' });
        y += 8;
      }
      if (accounts.length === 0) {
        y = this.reportPageBreak(doc, y, 10);
        doc.setFontSize(9); doc.setTextColor(120, 120, 120);
        doc.text('Tidak ada akun pada Chart of Accounts.', 15, y);
        doc.setTextColor(0, 0, 0);
        y += 8;
      }
      return y;
    },

    /** Paket lengkap: cover + semua laporan multi-halaman. */
    async exportAllReportsPDF(doc, periodeStr, generatedDate) {
      const brand = sanitizeText(String(this.siteName || 'DAPUR KULINER VIRAL')).toUpperCase();
      const sectionTitles = [
        'LAPORAN LABA RUGI (PROFIT & LOSS)',
        'LAPORAN ARUS KAS (CASH FLOW STATEMENT)',
        'LAPORAN NERACA KEUANGAN (BALANCE SHEET)',
        'JURNAL UMUM',
        'BUKU BESAR (GENERAL LEDGER)',
        'LAPORAN TRANSAKSI DETAIL'
      ];

      // 1. Cover page
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text(brand, 105, 60, { align: 'center' });
      doc.setFontSize(15);
      doc.text('LAPORAN KEUANGAN LENGKAP', 105, 72, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.text(`Periode: ${periodeStr}`, 105, 82, { align: 'center' });
      doc.text(`Dicetak: ${generatedDate}`, 105, 89, { align: 'center' });
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('DAFTAR ISI LAPORAN', 105, 106, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      const list = [
        'Laporan Laba Rugi (P&L)',
        'Laporan Arus Kas (Cash Flow)',
        'Neraca Keuangan (Balance Sheet)',
        'Jurnal Umum',
        'Buku Besar (General Ledger)',
        'Laporan Transaksi Detail'
      ];
      let cy = 116;
      list.forEach((s, i) => { doc.text(`${i + 1}. ${s}`, 65, cy); cy += 8; });

      // 2. P&L
      doc.addPage('a4', 'portrait');
      let y = this.reportHeader(doc, sectionTitles[0], periodeStr, generatedDate);
      y = this.plSection(doc, y);
      this.reportSignature(doc, y);

      // 3. Cash Flow
      doc.addPage('a4', 'portrait');
      y = this.reportHeader(doc, sectionTitles[1], periodeStr, generatedDate);
      y = this.cashFlowSection(doc, y);
      this.reportSignature(doc, y);

      // 4. Balance Sheet
      doc.addPage('a4', 'portrait');
      y = this.reportHeader(doc, sectionTitles[2], periodeStr, generatedDate);
      y = this.balanceSheetSection(doc, y);
      this.reportSignature(doc, y);

      // 5. Jurnal Umum
      doc.addPage('a4', 'portrait');
      y = this.reportHeader(doc, sectionTitles[3], periodeStr, generatedDate);
      y = this.journalSection(doc, y);
      this.reportSignature(doc, y);

      // 6. Buku Besar
      doc.addPage('a4', 'portrait');
      y = this.reportHeader(doc, sectionTitles[4], periodeStr, generatedDate);
      y = await this.ledgerSection(doc, y, periodeStr);
      this.reportSignature(doc, y);

      // 7. Laporan Transaksi Detail (landscape, ringkas)
      const tx = await this.loadTransaksiDetail(periodeStr);
      this.txDetailCompactSection(doc, tx, periodeStr);
    },

    /** Section ringkas Laporan Transaksi Detail (dipakai di paket lengkap). */
    txDetailCompactSection(doc, data, periodeStr) {
      doc.addPage('a4', 'landscape');
      const brand = String(this.siteName || 'DAPUR KULINER VIRAL').toUpperCase();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      doc.text(brand, 148, 12, { align: 'center' });
      doc.setFontSize(11);
      doc.text('LAPORAN TRANSAKSI DETAIL', 148, 18, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
      doc.text(`Periode: ${periodeStr}`, 148, 23, { align: 'center' });
      doc.line(10, 26, 287, 26);

      const totals = data.totals || { count: 0, total: 0, voidCount: 0, voidTotal: 0 };
      let y = 31;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.text(`RINGKASAN — ${totals.count} transaksi normal, ${totals.voidCount} void`, 10, y);
      y += 6;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      (data.groups || []).forEach(g => {
        doc.text(`${sanitizeText(g.metode)}: ${g.count} transaksi`, 12, y);
        doc.text(formatRupiah(g.subtotal), 120, y, { align: 'right' });
        y += 5;
      });
      y += 2;
      doc.setFont('helvetica', 'bold');
      doc.text('GRAND TOTAL PENJUALAN', 12, y);
      doc.text(formatRupiah(totals.total), 120, y, { align: 'right' });
      y += 5;
      if (totals.voidCount > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(160, 20, 20);
        doc.text(`Total VOID (tidak dihitung sebagai penjualan): ${formatRupiah(totals.voidTotal)}`, 12, y);
        doc.setTextColor(0, 0, 0);
        y += 5;
      }
      y += 7;

      // Tabel ringkas transaksi
      const X = { tgl: 10, order: 32, metode: 66, items: 98, tot: 250, status: 275 };
      const drawHeader = () => {
        doc.setFillColor(240, 240, 240);
        doc.rect(8, y - 4.5, 281, 6.5, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text('TANGGAL & JAM', X.tgl, y);
        doc.text('ORDER ID', X.order, y);
        doc.text('METODE', X.metode, y);
        doc.text('ITEMS', X.items, y);
        doc.text('TOTAL', X.tot, y, { align: 'right' });
        doc.text('STATUS', X.status, y);
        doc.setFont('helvetica', 'normal');
        y += 5;
      };
      drawHeader();
      (data.rows || []).forEach(r => {
        if (y + 7 > 195) { doc.addPage('a4', 'landscape'); y = 20; drawHeader(); }
        doc.setFontSize(7.5);
        if (r.isVoid) doc.setTextColor(150, 30, 30);
        doc.text(`${sanitizeText(r.tanggal || '-')} ${sanitizeText(r.jam || '')}`.trim(), X.tgl, y);
        doc.text(sanitizeText(String(r.orderId || '-').slice(0, 28)), X.order, y);
        doc.text(sanitizeText(String(r.metode || '-').slice(0, 20)), X.metode, y);
        doc.text(sanitizeText(String(r.itemsText || '-').slice(0, 80)), X.items, y);
        doc.text(r.isVoid ? '(VOID) ' + formatRupiah(r.total) : formatRupiah(r.total), X.tot, y, { align: 'right' });
        doc.text(r.isVoid ? 'VOID' : 'Normal', X.status, y);
        doc.setTextColor(0, 0, 0);
        y += 4.5;
      });
    },

    /**
     * Ekspor Laporan Keuangan ke format PDF (jsPDF)
     */
    async exportPDF(type, bulan) {
      try {
        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) {
          this.showToast('Pustaka jsPDF belum dimuat', 'error');
          return;
        }

        // pastikan nama outlet terbaru (site_config.brandName) — ada localStorage fallback
        if (!this.siteName || this.siteName === 'Dapur Kuliner Viral') {
          try { await this.loadSiteName(); } catch (e) {}
        }
        const periodeStr = bulan || this.bulanAktif;
        const generatedDate = new Date().toLocaleString('id-ID');

        // Muat ulang data periode terpilih (summary/ledger/coa/journal + hitung laporan)
        await this.ensureReportData(periodeStr);

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const TITLE = {
          pl: 'LAPORAN LABA RUGI (PROFIT & LOSS)',
          cashFlow: 'LAPORAN ARUS KAS (CASH FLOW STATEMENT)',
          balanceSheet: 'LAPORAN NERACA KEUANGAN (BALANCE SHEET)',
          journal: 'JURNAL UMUM',
          ledger: 'BUKU BESAR (GENERAL LEDGER)',
          all: 'LAPORAN KEUANGAN LENGKAP'
        };
        const title = TITLE[type] || 'LAPORAN KEUANGAN';

        if (type === 'all') {
          // PAKET LENGKAP: cover + 6 section multi-halaman
          await this.exportAllReportsPDF(doc, periodeStr, generatedDate);
        } else {
          let y = this.reportHeader(doc, title, periodeStr, generatedDate);
          if (type === 'cashFlow') {
            y = this.cashFlowSection(doc, y);
          } else if (type === 'balanceSheet') {
            y = this.balanceSheetSection(doc, y);
          } else if (type === 'journal') {
            y = this.journalSection(doc, y);
          } else if (type === 'ledger') {
            y = await this.ledgerSection(doc, y, periodeStr);
          } else {
            y = this.plSection(doc, y);
          }
          this.reportSignature(doc, y);
        }

        const filename = `Laporan_${type.toUpperCase()}_${periodeStr}.pdf`;
        doc.save(filename);

        this.addExportHistory(title, periodeStr, 'PDF');
        this.showToast(`Laporan ${filename} berhasil diunduh!`, 'success');
      } catch (err) {
        console.error('[ACCT-APP] Export PDF error:', err);
        this.showToast('Gagal membuat file PDF', 'error');
      }
    },

    /**
     * Ekspor Data Jurnal & Laporan ke CSV
     */
    async exportCSV(type, bulan) {
      try {
        let csvContent = '';
        const periodeStr = bulan || this.bulanAktif;

        if (type === 'jurnal' || type === 'all') {
          csvContent += 'No Entry,Tanggal,Deskripsi,Akun Debit,Debit (Rp),Akun Kredit,Kredit (Rp),Ref\n';
          this.jurnalList.forEach(j => {
            const desc = `"${(j.desc || '').replace(/"/g, '""')}"`;
            csvContent += `${j.noEntry},${j.date},${desc},${j.debitCode} - ${j.debitName},${j.debitAmount},${j.creditCode} - ${j.creditName},${j.creditAmount},${j.ref || '-'}\n`;
          });
        } else if (type === 'coa') {
          csvContent += 'Kode Akun,Nama Akun,Tipe,Saldo Awal,Saldo Saat Ini\n';
          this.coaList.forEach(c => {
            csvContent += `${c.code},"${c.name}",${c.type},${c.initialBalance},${c.currentBalance}\n`;
          });
        }

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `Akuntansi_${type}_${periodeStr}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.addExportHistory(`Data ${type.toUpperCase()}`, periodeStr, 'CSV');
        this.showToast('File CSV berhasil diunduh', 'success');
      } catch (e) {
        console.error('[ACCT-APP] Export CSV error:', e);
        this.showToast('Gagal export CSV', 'error');
      }
    },

    /**
     * Ekspor format .xlsx (SheetJS). Fallback ke CSV kalau CDN belum termuat.
     */
    async exportXLSX(type, bulan) {
      try {
        if (!window.XLSX) {
          this.showToast('Pustaka SheetJS belum dimuat — fallback ke CSV', 'error');
          if (type === 'txDetail') await this.exportTxDetailCSV(bulan);
          else await this.exportCSV(type, bulan);
          return;
        }
        const periodeStr = bulan || this.bulanAktif;

        if (type === 'txDetail') {
          await this.exportTxDetailXLSX(bulan);
          return;
        }

        // Muat data segar untuk periode terpilih
        await this.ensureReportData(periodeStr);

        const wb = XLSX.utils.book_new();
        const sheets = [];
        if (type === 'all') {
          sheets.push({ name: 'Laba Rugi', data: this._plRows() });
          sheets.push({ name: 'Arus Kas', data: this._cashFlowRows() });
          sheets.push({ name: 'Neraca', data: this._balanceSheetRows() });
          sheets.push({ name: 'Jurnal Umum', data: this._journalRows() });
          sheets.push({ name: 'Buku Besar', data: await this._ledgerRows(periodeStr) });
          const tx = await this.loadTransaksiDetail(periodeStr);
          sheets.push({ name: 'Transaksi Detail', data: this._txDetailRows(tx) });
        } else if (type === 'pl') {
          sheets.push({ name: 'Laba Rugi', data: this._plRows() });
        } else if (type === 'cashFlow') {
          sheets.push({ name: 'Arus Kas', data: this._cashFlowRows() });
        } else if (type === 'balanceSheet') {
          sheets.push({ name: 'Neraca', data: this._balanceSheetRows() });
        } else if (type === 'journal') {
          sheets.push({ name: 'Jurnal Umum', data: this._journalRows() });
        } else if (type === 'ledger') {
          sheets.push({ name: 'Buku Besar', data: await this._ledgerRows(periodeStr) });
        } else {
          sheets.push({ name: 'Laba Rugi', data: this._plRows() });
        }

        sheets.forEach(s => {
          const ws = this._xlsxSheet(s.data.headers, s.data.rows, s.data.currencyCols);
          XLSX.utils.book_append_sheet(wb, ws, s.name);
        });

        this._downloadXlsx(wb, `Laporan_${type.toUpperCase()}_${periodeStr}.xlsx`);
        this.addExportHistory(`Laporan ${type.toUpperCase()}`, periodeStr, 'XLSX');
        this.showToast(`Laporan XLSX berhasil diunduh!`, 'success');
      } catch (err) {
        console.error('[ACCT-APP] Export XLSX error:', err);
        this.showToast('Gagal membuat file XLSX', 'error');
      }
    },

    async exportTxDetailXLSX(bulan) {
      try {
        if (!window.XLSX) {
          this.showToast('Pustaka SheetJS belum dimuat — fallback ke CSV', 'error');
          await this.exportTxDetailCSV(bulan);
          return;
        }
        const data = (this.txDetail && this.txDetail.rows && this.txDetail.rows.length > 0
          && this.txDetail.periodeFile === String(bulan || '').slice(0, 7))
          ? this.txDetail
          : await this.loadTransaksiDetail(bulan);
        const periodeStr = data.periode || bulan || this.bulanAktif;

        const d = this._txDetailRows(data);
        const ws = this._xlsxSheet(d.headers, d.rows, d.currencyCols);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Transaksi Detail');

        this._downloadXlsx(wb, `Laporan_Transaksi_Detail_${data.periodeFile || periodeStr}.xlsx`);
        this.addExportHistory('Laporan Transaksi Detail', periodeStr, 'XLSX');
        this.showToast('File XLSX transaksi detail berhasil diunduh', 'success');
      } catch (e) {
        console.error('[TX-DETAIL] export XLSX error:', e);
        this.showToast('Gagal export XLSX transaksi detail', 'error');
      }
    },

    /** Bangun worksheet dari header + rows; header bold, auto width, angka = number + format Rp. */
    _xlsxSheet(headers, rows, currencyCols = []) {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      // Auto column width
      const cols = headers.map((h, i) => {
        let max = String(h).length;
        rows.forEach(r => {
          const v = r[i];
          let len = 0;
          if (v === null || v === undefined) len = 0;
          else if (typeof v === 'number') len = String(Math.round(v)).length + 5;
          else len = String(v).length;
          if (len > max) max = len;
        });
        return { wch: Math.max(8, Math.min(max + 2, 60)) };
      });
      ws['!cols'] = cols;

      // Header bold + latar abu
      headers.forEach((h, ci) => {
        const ref = XLSX.utils.encode_cell({ r: 0, c: ci });
        if (!ws[ref]) ws[ref] = { t: 's', v: String(h) };
        ws[ref].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E7E5E4' } } };
      });

      // Format mata uang Rp untuk kolom angka
      (currencyCols || []).forEach(ci => {
        rows.forEach((r, ri) => {
          const ref = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
          const cell = ws[ref];
          if (cell && typeof cell.v === 'number') cell.z = '"Rp" #,##0';
        });
      });
      return ws;
    },

    _downloadXlsx(wb, filename) {
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
      const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },

    _plRows() {
      const pl = this.laporanData.pl || {};
      const n = (v) => Number(v) || 0;
      return {
        headers: ['Komponen', 'Nominal (Rp)'],
        currencyCols: [1],
        rows: [
          ['Pendapatan Penjualan POS Kasir', n(pl.pendapatanPOS)],
          ['Pendapatan Pesanan Catering', n(pl.pendapatanCatering)],
          ['TOTAL PENDAPATAN', n(pl.totalPendapatan)],
          ['Harga Pokok Penjualan (HPP)', -n(pl.hpp)],
          ['LABA KOTOR', n(pl.labaKotor)],
          ['Beban Gaji Karyawan', -n(pl.bebanGaji)],
          ['Beban Sewa Tempat & Outlet', -n(pl.bebanSewa)],
          ['Beban Listrik, Air & Gas', -n(pl.bebanListrik)],
          ['Beban Marketing & Iklan', -n(pl.bebanMarketing)],
          ['Beban Operasional & Kurir', -n(pl.bebanOperasional)],
          ['TOTAL BEBAN OPERASIONAL', -n(pl.totalBeban)],
          ['LABA BERSIH (NET PROFIT)', n(pl.labaBersih)]
        ]
      };
    },

    _cashFlowRows() {
      const cf = this.laporanData.cashFlow || {};
      const n = (v) => Number(v) || 0;
      return {
        headers: ['Komponen', 'Nominal (Rp)'],
        currencyCols: [1],
        rows: [
          ['Penerimaan dari Pelanggan', n(cf.penerimaanPelanggan)],
          ['Pembayaran ke Supplier / Bahan Baku', -n(cf.pembayaranSupplier)],
          ['Pembayaran Gaji Karyawan', -n(cf.pembayaranGaji)],
          ['Pembayaran Beban Operasional', -n(cf.pembayaranOperasional)],
          ['Kas Bersih dari Aktivitas Operasi', n(cf.kasBersihOperasi)],
          ['Pembelian Peralatan & Mesin', -n(cf.pembelianPeralatan)],
          ['Kas Bersih dari Aktivitas Investasi', n(cf.kasBersihInvestasi)],
          ['Setoran Modal Pemilik', n(cf.setoranModal)],
          ['Penarikan Prive', -n(cf.prive)],
          ['Kas Bersih dari Aktivitas Pendanaan', n(cf.kasBersihPendanaan)],
          ['KENAIKAN (PENURUNAN) BERSIH KAS', n(cf.kenaikanKas)],
          ['Saldo Kas Awal Periode', n(cf.kasAwal)],
          ['SALDO KAS AKHIR PERIODE', n(cf.kasAkhir)]
        ]
      };
    },

    _balanceSheetRows() {
      const bs = this.laporanData.balanceSheet || {};
      const n = (v) => Number(v) || 0;
      return {
        headers: ['Komponen', 'Nominal (Rp)'],
        currencyCols: [1],
        rows: [
          ['ASET', null],
          ['  Kas di Tangan', n(bs.kas)],
          ['  Kas di Bank', n(bs.bank)],
          ['  Piutang Usaha', n(bs.piutang)],
          ['  Persediaan Bahan Baku', n(bs.persediaan)],
          ['  Total Aset Lancar', n(bs.totalAsetLancar)],
          ['  Peralatan & Mesin Dapur', n(bs.peralatan)],
          ['  Total Aset Tetap', n(bs.totalAsetTetap)],
          ['TOTAL ASET', n(bs.totalAset)],
          ['KEWAJIBAN & EKUITAS', null],
          ['  Hutang Dagang / Supplier', n(bs.hutangSupplier)],
          ['  Hutang Beban & Operasional', n(bs.hutangBeban)],
          ['  Total Kewajiban', n(bs.totalKewajiban)],
          ['  Modal Pemilik', n(bs.modalPemilik)],
          ['  Laba Ditahan', n(bs.labaDitahan)],
          ['  Laba (Rugi) Berjalan', n(bs.labaBerjalan)],
          ['  Prive Pemilik', -n(bs.prive)],
          ['  Total Ekuitas', n(bs.totalEkuitas)],
          ['TOTAL KEWAJIBAN & EKUITAS', n(bs.totalKewajibanEkuitas)],
          [bs.isBalance ? 'Status: SEIMBANG' : ('Status: TIDAK SEIMBANG, selisih ' + formatRupiah(bs.selisih)), null]
        ]
      };
    },

    _journalRows() {
      const accName = (code, name) => {
        if (name) return String(name);
        const m = { '1001':'Kas di Tangan','1002':'Kas di Bank','1003':'Piutang Usaha','1004':'Persediaan Bahan Baku','1005':'Peralatan & Mesin Dapur','2001':'Hutang Dagang / Supplier','2002':'Hutang Beban & Operasional','3001':'Modal Pemilik','3002':'Laba Ditahan','3003':'Prive Pemilik','4001':'Pendapatan Penjualan POS','4002':'Pendapatan Pesanan Catering','5001':'Harga Pokok Penjualan (HPP)','6001':'Beban Gaji Karyawan','6002':'Beban Sewa Tempat','6003':'Beban Listrik, Air & Gas','6004':'Beban Marketing & Iklan','6005':'Beban Operasional & Kurir','6006':'Beban Penyusutan' };
        return m[String(code)] || ('Akun ' + code);
      };
      const list = (this.jurnalList || [])
        .filter(j => j && (j.status === 'approved' || !j.status))
        .slice()
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
      const rows = [];
      list.forEach(j => {
        rows.push([String(j.date || '').slice(0, 10), String(j.noEntry || j.ref || '-'), String(j.desc || '-'), accName(j.debitCode, j.debitName), Number(j.debitAmount) || 0, null]);
        rows.push(['', '', '', accName(j.creditCode, j.creditName), null, Number(j.creditAmount) || 0]);
      });
      return {
        headers: ['Tanggal', 'No Ref', 'Keterangan', 'Akun', 'Debit (Rp)', 'Kredit (Rp)'],
        currencyCols: [4, 5],
        rows
      };
    },

    async _ledgerRows(bulan) {
      const accounts = (this.coaList || []).slice().sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
      const rows = [];
      for (const acc of accounts) {
        const ld = await this.loadLedger(acc.code, bulan);
        rows.push([String(acc.code), String(acc.name || ''), '-', 'SALDO AWAL', null, null, Number(ld.openingBalance) || 0]);
        (ld.transactions || []).forEach(t => {
          rows.push([String(acc.code), String(acc.name || ''), String(t.date || '').slice(0, 10), String(t.desc || '-'), Number(t.debit) || 0, Number(t.credit) || 0, Number(t.runningBalance) || 0]);
        });
        rows.push([String(acc.code), String(acc.name || ''), '-', 'SALDO AKHIR', Number(ld.totalDebit) || 0, Number(ld.totalCredit) || 0, Number(ld.closingBalance) || 0]);
      }
      return {
        headers: ['Kode Akun', 'Nama Akun', 'Tanggal', 'Keterangan', 'Debit (Rp)', 'Kredit (Rp)', 'Saldo Berjalan (Rp)'],
        currencyCols: [4, 5, 6],
        rows
      };
    },

    _txDetailRows(tx) {
      const rows = (tx.rows || []).map(r => [
        String(r.tanggal || ''), String(r.jam || ''), String(r.orderId || ''), String(r.metode || ''),
        String(r.itemsText || ''), Number(r.subtotal) || 0, Number(r.diskon) || 0, Number(r.pajak) || 0,
        Number(r.total) || 0, String(r.status || ''), String(r.kasir || ''), String(r.shift || ''),
        String(r.sumber || ''), String(r.voidReason || '')
      ]);
      return {
        headers: ['Tanggal', 'Jam', 'Order ID', 'Metode', 'Items', 'Subtotal (Rp)', 'Diskon (Rp)', 'Pajak (Rp)', 'Total (Rp)', 'Status', 'Kasir', 'Shift', 'Sumber', 'Alasan Void'],
        currencyCols: [5, 6, 7, 8],
        rows
      };
    },

    /**
     * Handler Utama Ekspor Data dari Form UI
     */
    async handleExportData(form) {
      // ✅ FIX: dropdown UI memakai exportForm.reportType (bukan .report) — sebelumnya
      // pilihan jenis laporan selalu jatuh ke default 'pl'.
      const type = form?.reportType || form?.report || this.exportForm?.reportType || this.exportForm?.report || 'all';
      const format = form?.format || this.exportForm?.format || 'pdf';
      const bulan = form?.period || this.exportForm?.period || this.bulanAktif;

      this.showToast(`Memproses ekspor laporan ${type.toUpperCase()} (${format.toUpperCase()})...`, 'info');
      try {
        if (format === 'pdf') {
          if (type === 'txDetail') await this.exportTxDetailPDF(bulan);
          else await this.exportPDF(type, bulan);
        } else if (format === 'xlsx') {
          if (type === 'txDetail') await this.exportTxDetailXLSX(bulan);
          else await this.exportXLSX(type, bulan);
        } else {
          if (type === 'txDetail') await this.exportTxDetailCSV(bulan);
          else await this.exportCSV(type, bulan);
        }
      } catch (err) {
        console.error('[ACCT-APP] handleExportData error:', err);
        this.showToast('Gagal memproses ekspor: ' + (err.message || err), 'error');
      }
    },

    /**
     * Catat Riwayat Ekspor
     */
    addExportHistory(report, period, format) {
      const entry = {
        date: new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }),
        report,
        period,
        format,
        status: 'Selesai'
      };
      this.exportHistory.unshift(entry);
      if (this.exportHistory.length > 7) this.exportHistory.pop();
      localStorage.setItem('dapur_export_history', JSON.stringify(this.exportHistory));
    },

    loadExportHistory() {
      const stored = localStorage.getItem('dapur_export_history');
      if (stored) {
        try { this.exportHistory = JSON.parse(stored); } catch (e) {}
      }
      if (!this.exportHistory) {
        this.exportHistory = [];
      }
    },

    // ------------------------------------------------------------------------
    // 9. HOOK AUTO-JURNAL REALTIME TRANSAKSI POS
    // ------------------------------------------------------------------------

    /**
     * Auto Generate Jurnal Entry dari Transaksi POS
     */
    async autoGenerateJurnalDariTransaksi(tx) {
      if (!tx || (!tx.id && !tx.orderId)) return;

      const grandTotal = Number(tx.total || tx.grandTotal) || 0;
      if (grandTotal <= 0) return;

      const pm = String(tx.pm || tx.paymentMethod || 'cash').toLowerCase();
      const txId = tx.orderId || tx.id;
      const dateStr = formatDate(tx.t || tx.timestamp || Date.now());
      const bulanKey = dateStr.substring(0, 7);

      // Cek apakah jurnal untuk transaksi ini sudah ada (Idempotensi)
      const existing = this.jurnalList.find(j => j.ref === txId);
      if (existing) return;

      // Tentukan Akun Debit berdasarkan Metode Pembayaran
      let debitCode = '1001'; // Kas di Tangan
      let debitName = 'Kas di Tangan (Cash on Hand)';

      if (pm.includes('qris') || pm.includes('bank') || pm.includes('transfer') || pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo') || pm.includes('dana')) {
        debitCode = '1002'; // Kas di Bank
        debitName = 'Kas di Bank (BCA Operasional)';
      }

      const creditCode = '4001'; // Pendapatan Penjualan POS
      const creditName = 'Pendapatan Penjualan POS';

      const entryId = 'J' + Date.now();
      const noEntry = 'JE-POS-' + entryId.slice(-4);

      const posJournalEntry = {
        id: entryId,
        date: dateStr,
        timestamp: Number(tx.t || tx.timestamp) || Date.now(),
        noEntry: noEntry,
        desc: `Penerimaan Penjualan POS - Order #${txId} (${pm.toUpperCase()})`,
        debitCode,
        debitName,
        debitAmount: grandTotal,
        creditCode,
        creditName,
        creditAmount: grandTotal,
        lines: [
          { acc: debitCode, debit: grandTotal, credit: 0 },
          { acc: creditCode, debit: 0, credit: grandTotal }
        ],
        status: 'approved',
        ref: txId,
        proof: ''
      };

      this.jurnalList.unshift(posJournalEntry);
      localStorage.setItem(`dapur_journal_${bulanKey}`, JSON.stringify(this.jurnalList));

      // Kirim ke server
      try {
        fetch(`/accounting/journal/${encodeURIComponent(bulanKey)}/${encodeURIComponent(entryId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(posJournalEntry)
        }).catch(e => {});
      } catch (e) {}

      this.recalculateAllAccountBalances();
      await this.loadSummary(this.bulanAktif);
    },

    // ------------------------------------------------------------------------
    // 10. UI HELPERS & NAVIGATION
    // ------------------------------------------------------------------------

    /** ✅ FIX Bug 1: Generate option HTML untuk dropdown COA
     *  Bypass Alpine quirk <template x-for> di dalam <select>
     */
    getCoaOptionsHtml() {
      if (!Array.isArray(this.coaList)) return '';
      const escape = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return this.coaList
        .map(acc => `<option value="${escape(acc.code)}">${escape(acc.code)} - ${escape(acc.name)} (${escape(acc.type)})</option>`)
        .join('');
    },

    initDebitKreditSelects() {
      const self = this;
      let attempts = 0;
      const trySetup = () => {
        attempts++;
        const list = Array.isArray(self.coaList) ? self.coaList : [];
        if (list.length === 0 && attempts < 25) {
          setTimeout(trySetup, 200);
          return;
        }
        const setup = (role, field) => {
          const sel = document.querySelector(`select[data-role="${role}"]`);
          if (!sel) return;
          const alreadyPopulated = sel.dataset.populated === String(list.length);
          if (!alreadyPopulated) {
            sel.innerHTML = list.map(a =>
              `<option value="${a.code}">${a.code} - ${a.name} (${a.type})</option>`
            ).join('');
            sel.dataset.populated = String(list.length);
          }
          setTimeout(() => {
            let target = String(self.manualJournalForm[field] || '');
            const hasOption = Array.from(sel.options).some(o => o.value === target);
            if (!hasOption && target.length === 4) {
              const map = { '1001':'101','1002':'102','1003':'103','1004':'105','1005':'111','2001':'201','2002':'202','3001':'301','3002':'303','3003':'302','4001':'401','4002':'402','5001':'501','6001':'601','6002':'602','6003':'603','6004':'604','6005':'605','6006':'606' };
              if (map[target]) target = map[target];
            }
            sel.value = target;
            console.log(`[NATIVE-${role}] Synced:`, target);
          }, 50);
          if (!sel._nativeBound) {
            sel._nativeBound = true;
            sel.addEventListener('change', (e) => {
              self.manualJournalForm[field] = e.target.value;
              console.log(`[NATIVE-${role}]`, e.target.value);
            });
          }
        };
        setup('debit-select', 'debitAccount');
        setup('kredit-select', 'creditAccount');
        console.log('[NATIVE-SETUP] Populated', list.length, 'options @ attempt', attempts);
      };
      setTimeout(trySetup, 100);
    },

    setTab(tab) {
      this.activeTab = tab;
      this.mobileMenuOpen = false;
      if (tab === 'dashboard') {
        this.$nextTick(() => {
          this.renderCashFlowChart();
        });
      } else if (tab === 'ledger') {
        this.loadLedger(this.ledgerAkun, this.bulanAktif);
      } else if (tab === 'laporan') {
        this.loadLabaRugi(this.bulanAktif);
        this.loadArusKas(this.bulanAktif);
        this.loadNeraca(this.bulanAktif);
      } else if (tab === 'trial-live' || tab === 'trial_live') {
        this.loadTrialPreview();
      }
    },

    // ========================================================================
    // TRIAL / LIVE MANAGEMENT
    // ========================================================================

        async loadTrialPreview() {
      try {
        const res = await fetch('/accounting/trial?action=preview');
        const json = await res.json();
        if (json.success) {
          this.dataPreview = json.preview || { journals: 0, ledgers: 0, orders: 0, transactions: 0 };
          this.isProductionMode = json.mode === 'production';
          this.productionStartDate = json.productionStartedAt 
            ? new Date(json.productionStartedAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
            : '';
          this.isNeracaBalanced = json.validation?.neracaBalance || false;
          this.goLiveValidation = {
            neracaBalance: !!json.validation?.neracaBalance,
            noDraftJournals: !!json.validation?.noDraftJournals,
            noPendingOrders: !!json.validation?.noPendingOrders
          };
          
          // Cek periode ditutup (404 = belum ditutup, itu normal)
          const bulan = this.bulanAktif || new Date().toISOString().slice(0, 7);
          try {
            const cpRes = await fetch(`/accounting/closed_periods/${bulan}.json`);
            if (cpRes.ok) {
              const cpData = await cpRes.json();
              if (cpData && cpData.closed) {
                this.closedPeriods[bulan] = true;
              } else {
                delete this.closedPeriods[bulan];
              }
            } else {
              // 404 = belum ditutup, itu normal. Tidak perlu log error.
              delete this.closedPeriods[bulan];
            }
          } catch (e) {
            // Silent: anggap belum ditutup
            delete this.closedPeriods[bulan];
          }
        }
      } catch (e) {
        console.warn('[TRIAL] Preview error:', e);
      }
    },

    openClosePeriodModal() {
      this.closePeriodConfirmText = '';
      this.closePeriodPassword = '';
      this.showClosePeriodModal = true;
    },

    async executeClosePeriod() {
      if (this.closePeriodConfirmText !== 'TUTUP BUKU') return;
      if (!this.closePeriodPassword) return;

      try {
        const res = await fetch('/accounting/trial?action=close-period', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bulan: this.bulanAktif,
            adminName: 'Admin',
            password: this.closePeriodPassword
          })
        });
        const json = await res.json();
        if (json.success) {
          alert('✅ ' + json.message);
          this.showClosePeriodModal = false;
          await this.loadTrialPreview();
        } else {
          alert('❌ ' + json.error);
        }
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    },

    openResetModal() {
      this.resetConfirmText = '';
      this.resetPassword1 = '';
      this.resetPassword2 = '';
      this.showResetModal = true;
    },

    async executeReset() {
      if (this.resetConfirmText !== 'RESET') return;
      if (this.resetPassword1 !== this.resetPassword2 || !this.resetPassword1) return;

      try {
        const res = await fetch('/accounting/trial?action=reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.resetPassword1 })
        });
        const json = await res.json();
        if (json.success) {
          alert('✅ Reset berhasil!\n\nData diarsipkan ke:\n' + json.archivedTo);
          this.showResetModal = false;
          await this.loadTrialPreview();
          await this.loadSummary(this.bulanAktif);
          await this.loadJournal(this.bulanAktif);
        } else {
          alert('❌ ' + json.error);
        }
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    },

    openGoLiveModal() {
      this.goLiveConfirmText = '';
      this.goLivePassword1 = '';
      this.goLivePassword2 = '';
      this.showGoLiveModal = true;
      // Refresh validation
      this.loadTrialPreview();
    },

    async executeGoLive() {
      if (this.goLiveConfirmText !== 'GO-LIVE') return;
      if (this.goLivePassword1 !== this.goLivePassword2 || !this.goLivePassword1) return;
      if (!this.goLiveValidation.neracaBalance) {
        alert('❌ Neraca tidak balance. Perbaiki dulu sebelum Go-Live.');
        return;
      }

      if (!confirm('⚠️ Yakin Go-Live? Setelah ini tidak bisa kembali ke mode trial.')) return;

      try {
        const res = await fetch('/accounting/trial?action=go-live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: this.goLivePassword1 })
        });
        const json = await res.json();
        if (json.success) {
          alert('🚀 ' + json.message + '\n\nArchive: ' + json.archivedTo);
          this.showGoLiveModal = false;
          await this.loadTrialPreview();
          await this.loadSummary(this.bulanAktif);
          await this.loadJournal(this.bulanAktif);
        } else {
          alert('❌ ' + json.error);
        }
      } catch (e) {
        alert('Gagal: ' + e.message);
      }
    },

    formatRupiah(num) {
      return formatRupiah(num);
    },

    getTypeBadgeClass(type) {
      switch(type) {
        case 'Aset': return 'bg-blue-50 text-blue-700 border-blue-200';
        case 'Kewajiban': return 'bg-red-50 text-red-700 border-red-200';
        case 'Ekuitas': return 'bg-green-50 text-green-700 border-green-200';
        case 'Pendapatan': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
        case 'Beban': return 'bg-orange-50 text-orange-700 border-orange-200';
        default: return 'bg-stone-50 text-stone-700 border-stone-200';
      }
    },

    showToast(message, type = 'success') {
      this.toastMsg = message;
      this.toastType = type;
      this.toastVisible = true;
      setTimeout(() => {
        this.toastVisible = false;
      }, 3500);
    },

    logoutAdmin() {
      if (confirm('Apakah Anda yakin ingin keluar dari panel Akuntansi & Admin?')) {
        sessionStorage.removeItem('dapur_admin_session');
        window.location.href = '/';
      }
    }
  };
};

// ============================================================================
// GLOBAL HOOK REGISTRATION
// ============================================================================
/**
 * Global function callable from kasir-app.js or any other modules
 * Fire-and-forget: tidak memblokir alur utama POS
 */
window.recordAccountingEntry = function(tx) {
  try {
    if (window._accountingAppInstance && typeof window._accountingAppInstance.autoGenerateJurnalDariTransaksi === 'function') {
      window._accountingAppInstance.autoGenerateJurnalDariTransaksi(tx);
    } else {
      const queue = JSON.parse(localStorage.getItem('dapur_accounting_pending_queue') || '[]');
      queue.push(tx);
      localStorage.setItem('dapur_accounting_pending_queue', JSON.stringify(queue));
    }
  } catch (err) {
    console.warn('[ACCT-APP] Hook recordAccountingEntry note:', err);
  }
};
