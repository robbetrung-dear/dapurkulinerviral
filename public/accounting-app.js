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
  { code: '6005', name: 'Beban Operasional & Kurir', type: 'Beban', normalBalance: 'Debit', initialBalance: 0, currentBalance: 0 }
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
    activeTab: 'dashboard',
    reportSubTab: 'pl',
    mobileMenuOpen: false,
    
    // Filter & Periode
    bulanAktif: '2026-09',
    tahunAktif: 2026,
    coaFilterType: 'all',
    jurnalFilterAkun: 'all',
    jurnalSearch: '',
    ledgerAkun: '1001',

    // Trial/Live State
    isProductionMode: false,
    productionStartDate: '',
    dataPreview: { journals: 0, ledgers: 0, orders: 0, transactions: 0 },
    isNeracaBalanced: false,
    // State: simpan status per-periode yang sudah ditutup (contoh: {"2026-09": true})
closedPeriods: {},

// Helper: dipanggil dari HTML untuk cek apakah suatu bulan sudah ditutup
    closedPeriods: {},
    isPeriodClosed(bulan) {
    if (!bulan) return false;
    return !!this.closedPeriods[bulan];
},

    // Modal state
    showClosePeriodModal: false,
    showResetModal: false,
    showGoLiveModal: false,

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

    // Riwayat Export
    exportHistory: [],

    // Firebase Runtime Config
    _fbConfig: null,

    // ------------------------------------------------------------------------
    // 1. INITIALIZATION (init)
    // ------------------------------------------------------------------------
    async init() {
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

      // 3. Muat Data Real dari Backend (Summary, COA, Journal)
      await this.loadSummary(this.bulanAktif);
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
    },

    /**
     * Inisialisasi Firebase Config
     */
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
      this.coaList.forEach(acc => {
        const stat = totalsByAcc[acc.code];
        if (stat) {
          acc.totalDebit = stat.debit;
          acc.totalCredit = stat.credit;
          acc.currentBalance = hitungSaldo(stat.initial, stat.debit, stat.credit, stat.type);
        }
      });
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
    '604':'Beban Marketing','605':'Beban Kurir','606':'Beban Penyusutan'
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
      j.debitName = j.debitName || _getAccNameById(debitLine.acc);  // ← FIX
    }
    if (creditLine) {
      j.creditCode = creditLine.acc;
      j.creditAmount = creditLine.credit;
      j.creditName = j.creditName || _getAccNameById(creditLine.acc);  // ← FIX
    }
  }
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
      const noEntry = 'JE-' + String(this.jurnalList.length + 1).padStart(4, '0');
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
        await fetch(`/accounting/journal/${encodeURIComponent(bulanKey)}/${encodeURIComponent(entryId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newEntry)
        });
      } catch (e) {
        console.warn('[ACCT-APP] Post journal entry note:', e);
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
      this.showToast(`Template [${type}] dipilih, silakan masukkan nominal`, 'success');
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

        const relatedJournals = (this.jurnalList || [])
          .filter(j => {
            if (j.debitCode === targetAcc || j.creditCode === targetAcc) return true;
            if (Array.isArray(j.lines)) {
              return j.lines.some(l => String(l.acc || l.code) === targetAcc);
            }
            return false;
          })
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        relatedJournals.forEach(j => {
          let dAmt = 0;
          let cAmt = 0;

          if (j.debitCode === targetAcc) dAmt += Number(j.debitAmount) || 0;
          if (j.creditCode === targetAcc) cAmt += Number(j.creditAmount) || 0;

          if (Array.isArray(j.lines)) {
            j.lines.forEach(l => {
              if (String(l.acc || l.code) === targetAcc) {
                dAmt += Number(l.debit) || 0;
                cAmt += Number(l.credit) || 0;
              }
            });
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

      const kas = getBal('1001') || getBal('101') || (this.summary?.saldoKas !== undefined ? Number(this.summary.saldoKas) : (this.summary?.kas !== undefined ? Number(this.summary.kas) : 0));
      const bank = getBal('1002') || getBal('102') || (this.summary?.saldoBank !== undefined ? Number(this.summary.saldoBank) : (this.summary?.bank !== undefined ? Number(this.summary.bank) : 0));
      const piutang = getBal('1003') || getBal('103') || (this.summary?.piutang !== undefined ? Number(this.summary.piutang) : 0);
      const persediaan = getBal('1004') || getBal('105') || (this.summary?.persediaanAkhir !== undefined ? Number(this.summary.persediaanAkhir) : 0);
      const totalAsetLancar = kas + bank + piutang + persediaan;

      const peralatan = getBal('1005') || getBal('106') || 0;
      const totalAsetTetap = peralatan;
      const totalAset = (this.summary?.totalAset !== undefined && this.summary?.totalAset !== null && !isNaN(Number(this.summary.totalAset)))
        ? Number(this.summary.totalAset)
        : (totalAsetLancar + totalAsetTetap);

      const hutangSupplier = getBal('2001') || getBal('201') || (this.summary?.hutangSupplier !== undefined ? Number(this.summary.hutangSupplier) : (this.summary?.hutang !== undefined ? Number(this.summary.hutang) : 0));
      const hutangBeban = getBal('2002') || 0;
      const totalKewajiban = (this.summary?.totalKewajiban !== undefined && this.summary?.totalKewajiban !== null && !isNaN(Number(this.summary.totalKewajiban)))
        ? Number(this.summary.totalKewajiban)
        : (hutangSupplier + hutangBeban);

      const modalPemilik = getBal('3001') || getBal('301') || 0;
      const labaDitahan = getBal('3002') || getBal('302') || 0;
      const labaBerjalan = (this.laporanData.pl.labaBersih !== undefined && !isNaN(Number(this.laporanData.pl.labaBersih)))
        ? Number(this.laporanData.pl.labaBersih)
        : ((this.summary?.labaBersih !== undefined ? Number(this.summary.labaBersih) : Number(this.summary?.labaBulanIni)) || 0);
      const prive = getBal('3003') || 0;

      const totalEkuitas = (this.summary?.totalEkuitas !== undefined && this.summary?.totalEkuitas !== null && !isNaN(Number(this.summary.totalEkuitas)))
        ? Number(this.summary.totalEkuitas)
        : (modalPemilik + labaDitahan + labaBerjalan - prive);
      const totalKewajibanEkuitas = totalKewajiban + totalEkuitas;

      const selisih = Math.abs(totalAset - totalKewajibanEkuitas);
      const isBalance = selisih < 100;

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
    // 8. EXPORT DATA (PDF & CSV GENERATOR)
    // ------------------------------------------------------------------------

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

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const periodeStr = bulan || this.bulanAktif;
        const generatedDate = new Date().toLocaleString('id-ID');

        // Header Dokumen
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text('DAPUR KULINER VIRAL', 105, 18, { align: 'center' });
        
        doc.setFontSize(11);
        doc.setFont('helvetica', 'normal');
        doc.text('Sistem Akuntansi & Laporan Keuangan', 105, 24, { align: 'center' });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        const titleMap = {
          pl: 'LAPORAN LABA RUGI (PROFIT & LOSS)',
          cashFlow: 'LAPORAN ARUS KAS (CASH FLOW STATEMENT)',
          balanceSheet: 'LAPORAN NERACA KEUANGAN (BALANCE SHEET)',
          all: 'LAPORAN KEUANGAN LENGKAP'
        };
        doc.text(titleMap[type] || 'LAPORAN KEUANGAN', 105, 33, { align: 'center' });

        doc.setFontSize(9);
        doc.setFont('helvetica', 'italic');
        doc.text(`Periode: ${periodeStr} | Dicetak: ${generatedDate}`, 105, 38, { align: 'center' });
        doc.line(15, 42, 195, 42);

        let y = 50;

        if (type === 'pl' || type === 'all') {
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
        }

        // Tanda Tangan
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text('Disiapkan oleh:', 30, y + 10);
        doc.text('Disetujui oleh:', 140, y + 10);
        doc.text('( Bagian Keuangan )', 30, y + 30);
        doc.text('( Owner / Direksi )', 140, y + 30);

        // Download
        const filename = `Laporan_${type.toUpperCase()}_${periodeStr}.pdf`;
        doc.save(filename);

        this.addExportHistory(titleMap[type] || 'Laporan', periodeStr, 'PDF');
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
     * Ekspor Format Excel (.csv kompatibel Excel)
     */
    async exportExcel(type, bulan) {
      await this.exportCSV(type, bulan);
    },

    /**
     * Handler Utama Ekspor Data dari Form UI
     */
    async handleExportData(form) {
      const type = form?.report || this.exportForm?.report || 'pl';
      const format = form?.format || this.exportForm?.format || 'pdf';
      const bulan = form?.period || this.exportForm?.period || this.bulanAktif;

      this.showToast(`Memproses ekspor laporan ${type.toUpperCase()} (${format.toUpperCase()})...`, 'info');
      try {
        if (format === 'pdf') {
          await this.generatePDFReport(type, bulan);
        } else if (format === 'excel') {
          await this.exportExcel(type, bulan);
        } else {
          await this.exportCSV(type, bulan);
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
