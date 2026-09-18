# 📖 Panduan Operasional & Setup Sistem Kasir Pintar F&B

Selamat datang di dokumentasi resmi **Sistem Kasir Pintar (POS) & Akuntansi Otomatis Dapur Kuliner**. Dokumen ini dirancang dengan bahasa yang mudah dipahami untuk membantu tim operasional, kasir, dan pemilik usaha (*owner*) dalam menjalankan aplikasi sehari-hari serta melakukan konfigurasi teknis.

---

## 1. 🌟 Overview Sistem Kasir Pintar

Sistem ini adalah aplikasi Point of Sale (POS) modern berbasis cloud & edge computing yang mengintegrasikan:
- **Kasir Cepat (POS)**: Pemilihan menu via grid visual, hitung pajak & diskon otomatis, split bill, cetak struk thermal 80mm PDF / Web Print.
- **Pembayaran Multi-Metode**: Tunai, QRIS Dinamis Midtrans, Transfer Bank, dan e-Wallet.
- **Sinkronisasi Otomatis**: Pesanan online langsung terhubung ke kasir untuk di-approve (*reconcile*).
- **Akuntansi & Laba Rugi Otomatis**: Setiap transaksi penjualan langsung membentuk entri Jurnal Umum (*double-entry*) dan buku besar (*ledger*).
- **Arsip Cloud Otomatis**: Menjaga database Firebase tetap hemat & gratis selamanya (< 500 MB).

---

## 2. 📋 Prasyarat Layanan Cloud

Sebelum mulai, pastikan Anda memiliki akses ke 3 akun layanan berikut:
1. **Google Firebase Console** ([firebase.google.com](https://firebase.google.com))
   - Menggunakan produk **Firebase Realtime Database** dan **Firebase Storage**.
2. **Cloudflare Dashboard** ([dash.cloudflare.com](https://dash.cloudflare.com))
   - Digunakan untuk hosting frontend dan backend serverless Cloudflare Pages Functions.
3. **Midtrans Payment Gateway** ([midtrans.com](https://midtrans.com))
   - Digunakan untuk pembayaran QRIS dinamis dan notifikasi webhook pembayaran.

---

## 3. ⚙️ Setup Awal & Konfigurasi

### A. Membuat User Kasir di Firebase Realtime Database
Buka **Firebase Console > Realtime Database**, lalu tambahkan node user pada path `/users`:

```json
{
  "users": {
    "kasir1_uid": {
      "username": "kasir1",
      "name": "Budi Santoso",
      "role": "kasir",
      "pinHash": "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918",
      "status": "active"
    },
    "owner_uid": {
      "username": "owner",
      "name": "Ibu Pemilik",
      "role": "owner",
      "pinHash": "04f8996da763b7a969b1028ee3007569eaf3a635486ddab211d512c85b9df8fb",
      "status": "active"
    }
  }
}
```

> 💡 **Cara Menghasilkan PIN Hash (SHA-256):**
> Anda dapat membuat hash PIN 6-digit menggunakan tools online SHA-256 generator atau via konsol browser kasir:
> ```js
> async function hashPin(pin) {
>   const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pin));
>   return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
> }
> console.log(await hashPin("123456")); // Output hash SHA-256
> ```

### B. Konfigurasi Environment Variables di Cloudflare Pages
Di Dashboard Cloudflare Pages, buka **Settings > Environment Variables**, lalu tambahkan:

| Variable | Contoh Nilai | Keterangan |
| :--- | :--- | :--- |
| `FIREBASE_DATABASE_URL` | `https://dapur-kuliner-rtdb.asia-southeast1.firebasedatabase.app` | URL Realtime Database |
| `FIREBASE_API_KEY` | `AIzaSyDxxxxxxxxx...` | Web API Key Firebase |
| `FIREBASE_STORAGE_BUCKET`| `dapur-kuliner.appspot.com` | Bucket Cloud Storage |
| `MIDTRANS_SERVER_KEY` | `Mid-server-xxxx...` | Server Key Midtrans |
| `MIDTRANS_CLIENT_KEY` | `Mid-client-xxxx...` | Client Key Midtrans |
| `MIDTRANS_IS_PRODUCTION` | `false` (atau `true` jika live) | Status Mode Midtrans |

---

## 4. 🚀 Panduan Deploy

1. **Commit ke Git Repository**:
   ```bash
   git add .
   git commit -m "Deploy update fitur kasir & akuntansi"
   git push origin main
   ```
2. **Cloudflare Pages Auto-Deploy**:
   - Cloudflare akan otomatis mendeteksi commit baru, mem-build frontend Vite, dan mengaktifkan Cloudflare Pages Functions di folder `/functions`.
3. **Verifikasi Endpoint Backend**:
   - Cek auth: `POST https://domain-anda.pages.dev/kasir-auth`
   - Cek struk: `POST https://domain-anda.pages.dev/receipt`
   - Cek agregasi: `POST https://domain-anda.pages.dev/aggregate`

---

## 5. 🧑‍💼 Operasional Harian Kasir

### 1. Buka Shift & Login Kasir
1. Buka halaman `/kasir.html` di browser tablet / komputer kasir.
2. Pilih nama kasir atau masukkan username kasir.
3. Masukkan **6 Digit PIN Kasir**.
4. Masukkan **Modal Awal Kas (Cash in Drawer)**, misal: `Rp 200.000`.
5. Klik **"Buka Shift"**.

### 2. Rekonsiliasi Pesanan Masuk (Online / QRIS)
1. Buka tab **"Rekonsiliasi Order"**.
2. Pesanan online yang baru dibayar pelanggan akan muncul di daftar.
3. Centang order yang ingin disetujui, lalu klik **"Approve & Masukkan ke POS"**.
4. Sistem otomatis:
   - Membuat nomor transaksi resmi (`TRX-...`).
   - Memotong stok bahan di sistem inventori.
   - Mencatat pendapatan ke jurnal akuntansi.

### 3. Memproses Transaksi Langsung di Outlet (Dine-in / Takeaway)
1. Pilih kategori dan klik menu pesanan pada layar.
2. Atur jumlah (*qty*) atau diskon bila ada.
3. Pilih metode pembayaran:
   - **Tunai**: Masukkan nominal uang yang diterima pelanggan. Sistem otomatis menghitung kembalian.
   - **QRIS Dinamis**: Tampilkan kode QR di layar tablet agar discan oleh pelanggan.
4. Klik **"Selesaikan Pembayaran"**.
5. Klik **"Cetak Struk"** untuk print struk 80mm atau **"Kirim WhatsApp"** untuk struk digital.

### 4. Tutup Shift Kasir (Closing Kasir)
1. Di akhir jam kerja, klik tombol **"Tutup Shift"**.
2. Hitung fisik uang tunai di laci kasir dan masukkan nominalnya di kolom **Kas Fisik Akhir**.
3. Sistem akan membandingkan **Kas Sistem vs Kas Fisik**:
   - Jika *Selisih = 0*: Kas klop / seimbang.
   - Jika terdapat selisih lebih / kurang, kasir dapat mengisi kolom catatan penjelasan.
4. Klik **"Cetak Ringkasan Shift"** untuk arsip dan klik **"Konfirmasi Selesai Shift"**.

---

## 6. 📊 Modul Akuntansi & Laporan Keuangan

Sistem telah dilengkapi modul akuntansi standar PSAK F&B:

### Cara Melihat Laporan Laba Rugi (P&L)
1. Login menggunakan akun bertipe **Admin** atau **Owner**.
2. Masuk ke menu **Akuntansi > Laporan Laba Rugi**.
3. Pilih periode bulan yang ingin dilihat (contoh: `2026-09`).
4. Layar akan menampilkan:
   - **Pendapatan Bersih**: Penjualan Kasir POS + Catering.
   - **Harga Pokok Penjualan (HPP)**: Biaya bahan baku dapur.
   - **Laba Kotor**: Pendapatan dikurangi HPP.
   - **Beban Operasional**: Gaji, sewa tempat, listrik/air, marketing, kurir.
   - **Laba Bersih**: Keuntungan final setelah seluruh beban operasional.
5. Klik tombol **"Unduh Laporan PDF A4"** untuk mendapatkan dokumen resmi yang siap ditandatangani.

### Input Biaya Operasional Manual
1. Masuk ke menu **Akuntansi > Jurnal Pengeluaran**.
2. Klik **"Tambah Biaya"**.
3. Pilih kategori beban:
   - `601`: Gaji Karyawan / Dapur
   - `602`: Sewa Tempat
   - `603`: Listrik, Air & Gas LPG
   - `604`: Marketing & Iklan
   - `605`: Biaya Kurir / Transportasi
4. Masukkan nominal dan upload foto bukti nota/struk pengeluaran.
5. Klik **"Simpan Transaksi"**.

---

## 7. 🛠️ Troubleshooting Umum

| Masalah | Penyebab Umum | Solusi Cepat |
| :--- | :--- | :--- |
| **"Login Gagal / PIN Salah"** | PIN salah atau user belum didaftarkan di Firebase | Cek node `/users` di Firebase Console, pastikan role minimal `kasir` dan status `active`. |
| **"QRIS Tidak Muncul / Loading Terus"** | Kunci API Midtrans belum diset di Cloudflare | Buka Cloudflare Settings > Environment Variables, pastikan `MIDTRANS_SERVER_KEY` sudah benar. |
| **"Struk Tidak Mau Tercetak"** | Printer bluetooth thermal mati atau belum pairing | Nyalakan printer, buka Bluetooth perangkat, lakukan pairing ulang printer thermal 80mm. |
| **"Sinkronisasi Lambat / Permission Denied"** | Firebase Security Rules memblokir akses | Pasang aturan keamanan dari file `firebase-rules.json` di tab **Rules** Firebase Console. |

---

## 8. 🛡️ Maintenance & Pemeliharaan Database

### A. Export Backup Data Manual (JSON)
1. Buka **Firebase Console > Realtime Database**.
2. Klik tanda titik tiga (⋮) di pojok kanan atas layar database.
3. Pilih **"Export JSON"** untuk mengunduh seluruh data toko ke komputer Anda sebagai cadangan offline.

### B. Pengarsipan Otomatis Data Historis (> 1 Tahun)
Aplikasi telah memiliki fungsi `/functions/archive.js` yang berjalan otomatis setiap tanggal 1 jam 03:00 pagi:
- Memindahkan data transaksi mentah tahun lalu ke Firebase Storage dalam format `.json.gz`.
- Membersihkan node `/pos/transactions` lama sehingga database Firebase tetap ramping di bawah **500 MB** (tetap gratis selamanya).
- Ringkasan omzet harian & bulanan tetap tersimpan di `/pos/summary` sehingga grafik laporan tidak hilang.

---

## 9. ❓ Tanya Jawab (FAQ)

**T: Apakah aplikasi tetap bisa digunakan jika internet mati mendadak?**  
J: Ya. Frontend kasir dilengkapi *local storage offline engine*. Anda tetap dapat memilih menu dan menghitung kembalian tunai. Saat internet kembali aktif, data dapat disinkronkan ke cloud.

**T: Siapa saja yang bisa melihat menu Akuntansi & Laba Rugi?**  
J: Sesuai aturan keamanan di `firebase-rules.json`, hanya user dengan peran **Admin** dan **Owner** yang dapat membuka menu Akuntansi dan Laporan Laba Rugi. Kasir umum hanya memiliki akses ke POS dan pemotongan stok.

**T: Bagaimana cara mengubah nama resto di struk kasir?**  
J: Masuk ke menu **Pengaturan Outlet** (khusus Admin/Owner) atau edit node `/settings/company` di Firebase Realtime Database. Nama, alamat, nomor telepon, dan pesan footer struk akan otomatis berubah di seluruh cetakan struk berikutnya.
