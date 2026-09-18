# 🍱 Template Landing Page Kuliner & Catering Box + Deploy Cloudflare Pages
> **Solusi Turnkey Siap Produksi Seharga Rp250.000**  
> Dibuat khusus untuk Dapur Kuliner Rumahan, Bisnis Makanan Viral (Rice Bowl, Katsu, Aneka Mie, Dimsum, Seblak), dan Jasa Catering Harian / Acara (Paket Silver, Gold, Platinum, & B2B Corporate).

---

## 🚀 Arsitektur & Keunggulan Sistem

| Komponen | Teknologi | Keterangan |
| :--- | :--- | :--- |
| **Frontend UI** | HTML5 + TailwindCSS + Alpine.js + Font Awesome | Ultra-ringan, mobile-first, loading < 2 detik tanpa bloat framework besar |
| **Database & Realtime** | Firebase Realtime Database (SDK v9 Modular via CDN) | Biaya Rp0 (gratis untuk ribuan pesanan UMKM harian), update otomatis seketika (`onValue()`) |
| **Autentikasi** | Firebase Anonymous Auth | Identifikasi sesi unik pelanggan tanpa memaksa registrasi rumit |
| **Backend API (Edge)** | Cloudflare Pages Functions (`/functions/*.js`) | Berjalan di edge Cloudflare global, proxy aman API key privat |
| **Logistik & Ongkir** | Biteship API Proxy (`/functions/ongkir.js`) | Perbandingan berdampingan 7 kurir: JNE, J&T, SiCepat, AnterAja, POS, Ninja, GoSend/Grab |
| **Payment Gateway** | Midtrans Snap Proxy (`/functions/payment.js`) | **Tanpa Kartu Kredit**: QRIS, BCA/Mandiri/BNI/BRI VA, GoPay, ShopeePay, DANA |
| **Webhook & Keamanan** | Webhook Notifikasi (`/functions/webhook.js`) | Verifikasi SHA-512 Signature Key, pencegahan fraud & spoofing |
| **Audit & Kepatuhan** | Logging Transaksi (`/logs`) | Penyimpanan histori transaksi otomatis untuk audit berkala |
| **Analitik & Kasir** | Dasbor Analitik (`/analytics.html`) | Grafik interaktif, KPI Omset, AOV, & Ekspor CSV (Harian, Mingguan, Bulanan) |
| **Hosting & Domain** | Cloudflare Pages (`*.pages.dev`) | Gratis selamanya, CDN global tercepat, gratis SSL HTTPS otomatis |

---

## 📁 Struktur Folder Proyek

```text
├── public/
│   ├── index.html          # Landing page utama (Hero, Menu GrabMerchant, Kalkulator 7 Kurir, Midtrans Snap, Tracker, WhatsApp Floating)
│   ├── analytics.html      # Dasbor Analitik Real-Time & POS Kasir (Grafik Omset, Kontrol Status Dapur, Audit Log)
│   └── kasir.html          # Shortcut redirect ke Dasbor Analitik / Kasir
├── functions/
│   ├── ongkir.js           # Cloudflare Pages Function: Proxy Biteship API (7 kurir horizontal)
│   ├── payment.js          # Cloudflare Pages Function: Proxy Midtrans Snap (Tanpa Kartu Kredit)
│   ├── webhook.js          # Cloudflare Pages Function: Verifikasi SHA-512 Signature & Auto-Update Status
│   └── realtime.js         # Cloudflare Pages Function: Durable Object / Realtime WebSocket Handler
├── firebase-config.js      # Konfigurasi client Firebase (Aman untuk publik)
├── firebase-rules.json     # Aturan keamanan Firebase Realtime Database
├── wrangler.toml           # Konfigurasi Cloudflare Pages Functions
├── .env.example            # Daftar environment variables wajib
└── README.md               # Dokumentasi instalasi & panduan lengkap
```

---

## 🔐 Alur Autentikasi Pelanggan (Firebase Anonymous Auth)

Untuk mempermudah konversi penjualan UMKM, pelanggan tidak boleh dipaksa mengisi formulir login password yang panjang saat hendak memesan makanan lapar.

### Cara Kerja:
1. Saat halaman `index.html` dibuka, script memanggil `signInAnonymously(auth)`.
2. Firebase membuatkan identitas unik (`uid`) sementara di browser pelanggan via Local Persistence.
3. Hak akses menulis pesanan ke `/orders/$order_id` diizinkan oleh `firebase-rules.json` karena status `auth != null` terpenuhi.
4. Ketika pelanggan melakukan pembayaran atau berpindah tab, sesi tetap terjaga. Jika pelanggan kembali menggunakan browser yang sama, riwayat pesanannya tetap dapat diidentifikasi secara aman.

---

## 💳 Panduan Integrasi Midtrans Snap & Webhook

### 1. Pembayaran Tanpa Kartu Kredit
Pada `functions/payment.js`, parameter `enabled_payments` dikonfigurasi secara eksplisit untuk menonaktifkan kartu kredit:
```javascript
enabled_payments: [
  "qris",         // QRIS Instan (GoPay, OVO, DANA, BCA Mobile)
  "gopay",        // GoPay Deeplink
  "shopeepay",    // ShopeePay
  "bca_va",       // BCA Virtual Account
  "bni_va",       // BNI Virtual Account
  "bri_va",       // BRI Virtual Account
  "echannel",     // Mandiri Bill
  "permata_va",   // Permata VA
  "other_va"      // Bank Lainnya (ATM Bersama / Prima)
]
```

### 2. Keamanan Verifikasi SHA-512 di Webhook
Setiap notifikasi webhook yang dikirim oleh server Midtrans ke `https://domain-anda.pages.dev/functions/webhook` divalidasi dengan algoritma hash SHA-512:
```text
Signature Formula: SHA-512(order_id + status_code + gross_amount + ServerKey)
```
Jika hash hasil kalkulasi di Cloudflare Pages Function tidak cocok persis dengan `signature_key` dari Midtrans, sistem otomatis menolak transaksi (HTTP 403) untuk mencegah penipuan manipulasi saldo.

### 3. Log Audit Transaksi
Setiap verifikasi pembayaran berhasil disimpan ke path `/logs/{order_id}_{timestamp}` di Firebase Realtime Database berisi:
- `order_id`
- `transaction_id` (Midtrans)
- `payment_type`
- `gross_amount`
- `received_at`
- `raw_notification`

---

## 📊 Dasbor Analitik & Ekspor CSV Otomatis

Buka halaman `/analytics.html` di browser Anda:
1. **Metrik Real-time**: Total Omset, Total Pesanan Selesai, Rata-rata Keranjang (AOV), dan Pesanan Antrian Dapur.
2. **Grafik Interaktif (Chart.js)**:
   - Line Chart: Tren Omset Penjualan 7 Hari dan 30 Hari.
   - Donut Chart: Porsi kontribusi kategori (Paket Catering 45%, Bento 28%, Mie 15%, Cemilan 12%).
3. **Ekspor CSV 1-Klik**:
   - **Harian**: Laporan pesanan hari ini.
   - **Mingguan**: Laporan rekapitulasi 7 hari terakhir.
   - **Bulanan**: Laporan tutup buku akhir bulan untuk pencatatan laba rugi.
4. **POS Kasir**: Ubah status pesanan menjadi `Diproses`, `Dikirim`, atau `Selesai`. Perubahan status langsung memicu update real-time pada progress bar pelanggan dan membunyikan nada notifikasi.

---

## 🛠️ Langkah-Langkah Deploy (1 - 5)

### Langkah 1: Setup Firebase Realtime Database (Gratis)
1. Buka [Firebase Console](https://console.firebase.google.com/) dan klik **Add project**. Beri nama (misal: `dapur-viral-anda`).
2. Masuk ke menu **Build > Realtime Database**, klik **Create Database**.
3. Pilih lokasi server: **Singapore (`asia-southeast1`)** untuk latensi tercepat dari Indonesia.
4. Pilih **Start in locked mode**.
5. Buka tab **Rules**, salin seluruh isi file `firebase-rules.json` di proyek ini, tempelkan ke editor Firebase, lalu klik **Publish**.
6. Masuk ke menu **Build > Authentication**, buka tab **Sign-in method**, lalu aktifkan **Anonymous**.
7. Buka **Project Settings (ikon roda gigi) > General**, scroll ke bawah dan buat Web App (klik ikon `</>`).
8. Salin konfigurasi Firebase ke file `firebase-config.js`:
   ```javascript
   export const firebaseConfig = {
     apiKey: "YOUR_FIREBASE_API_KEY_HERE",
     authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
     databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "YOUR_PROJECT_ID",
     storageBucket: "YOUR_PROJECT_ID.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abcdef1234567890"
   };
   ```

---

### Langkah 2: Setup Midtrans Payment Gateway (Gratis Sandbox & Production)
1. Daftar akun di [Midtrans Dashboard](https://dashboard.midtrans.com/).
2. Masuk ke mode **Sandbox** untuk pengujian.
3. Buka menu **Settings > Access Keys**:
   - Salin **Client Key** (berawalan `SB-Mid-client-` atau `Mid-client-`).
   - Salin **Server Key** (berawalan `SB-Mid-server-` atau `Mid-server-`).
4. Buka file `public/index.html`, cari script tag Midtrans Snap, lalu perbarui `data-client-key`:
   ```html
   <script type="text/javascript" src="https://app.sandbox.midtrans.com/snap/snap.js" data-client-key="YOUR_MIDTRANS_CLIENT_KEY_HERE"></script>
   ```
5. Buka menu **Settings > Configuration**:
   - **Payment Notification URL**: Isi dengan `https://nama-project-anda.pages.dev/functions/webhook`
   - Nonaktifkan **Credit Card** di konfigurasi Snap Preferences jika ingin memastikan seluruh transaksi hanya QRIS, Bank Transfer, & E-Wallet.

---

### Langkah 3: Setup Biteship Ongkir API (Gratis)
1. Buka [Biteship Developer](https://biteship.com/) dan buat akun gratis.
2. Buka menu **Integrasi / API Key**.
3. Salin API Key pengujian atau live Anda (dimulai dengan `biteship_test.` atau `biteship_live.`).
4. Fitur proxy di `functions/ongkir.js` otomatis meneruskan permintaan ke Biteship API untuk membandingkan 7 kurir (JNE, J&T, SiCepat, AnterAja, POS, Ninja Xpress, GoSend/GrabExpress) secara horizontal.

---

### Langkah 4: Git Init, Commit & Push ke GitHub
Buka terminal komputer Anda di folder proyek:
```bash
# 1. Inisialisasi git repository
git init

# 2. Tambahkan semua file
git add .

# 3. Buat commit pertama
git commit -m "feat: template dapur kuliner & catering siap deploy cloudflare pages"

# 4. Hubungkan ke repository GitHub Anda (buat repository baru di github.com)
git branch -M main
git remote add origin https://github.com/USERNAME-ANDA/dapur-viral-landing.git

# 5. Push ke GitHub
git push -u origin main
```

---

### Langkah 5: Connect ke Cloudflare Pages & Set Environment Variables
1. Login ke [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Masuk ke menu **Workers & Pages > Create application > Pages > Connect to Git**.
3. Pilih repository GitHub yang baru Anda push (`dapur-viral-landing`).
4. Konfigurasi build setting:
   - **Framework preset**: `None`
   - **Build command**: Kosongkan (atau `echo "Static Site"`)
   - **Build output directory**: `public`
5. Klik **Save and Deploy**. Cloudflare Pages akan mempublikasikan website Anda dalam waktu kurang dari 30 detik!
6. Buka **Project Settings > Environment Variables** di Cloudflare Dashboard, lalu tambahkan variabel sensitif berikut:

| Nama Variabel | Nilai (Value) | Keterangan |
| :--- | :--- | :--- |
| `MIDTRANS_SERVER_KEY` | `SB-Mid-server-xxxxxxxxxxxx` | Server Key rahasia dari Midtrans |
| `MIDTRANS_CLIENT_KEY` | `SB-Mid-client-xxxxxxxxxxxx` | Client Key publik Midtrans |
| `MIDTRANS_IS_PRODUCTION` | `false` (atau `true` untuk Live) | Mode Sandbox / Live |
| `BITESHIP_API_KEY` | `biteship_test.xxxxxxxxxxxx` | API Key dari dashboard Biteship |
| `FIREBASE_DATABASE_URL` | `https://project-rtdb.asia-southeast1.firebasedatabase.app` | URL Database Firebase RTDB |
| `FIREBASE_DATABASE_SECRET` | `YOUR_DATABASE_SECRET` | Secret REST API Firebase (Opsional) |
| `APP_URL` | `https://nama-project-anda.pages.dev` | URL domain Cloudflare Pages Anda |

7. Lakukan redeploy sekali di menu **Deployments > Retry Deployment** agar variabel lingkungan aktif.

---

## 📱 Ringkasan Menu GrabMerchant Terlampir
Aplikasi telah memuat daftar produk dan harga resmi sesuai screenshot:
- **Ala Carte**: Telur Orak Arik (Rp7.000), Chicken Egg Roll (Rp28.000), Telor Dadar (Rp7.000), Telor Ceplok (Rp7.000), Chicken Popcorn (Rp28.000), Chicken Katsu (Rp25.000).
- **Aneka Mie**: Mie Bowl Nyemek Bangla (Rp23.000), Mie Bowl Goreng Katsu Manis Gurih (Rp28.000), Mie Bowl Goreng Katsu Geprek (Rp28.000), Mie Goreng Bowl Telur (Rp23.000).
- **Cemilan & Side Dish**: Udang Keju Lumer (Rp28.000), Chicken Wings Spicy Isi 5 (Rp45.000) & Isi 10 (Rp78.000), Chicken Wings Manis Gurih Isi 5 (Rp45.000) & Isi 10 (Rp78.000), French Fries (Rp20.000), Sosis Solo (Rp25.000), Churros (Rp28.000).
- **Makanan & Bento**: Nasi Chicken Egg Roll Wings (Rp39.000), Nasi Chicken Egg Roll (Rp38.000), Rice Bowl Chicken Katsu (Rp28.000), Rice Bowl Chicken Popcorn (Rp28.000 - Rp38.000 Salted Egg).
- **Viral Dishes**: Seblak Prasmanan Komplit (Rp22.000), Dimsum Mentai Mozarella (Rp20.000), Dessert Box Tiramisu Choco Melt (Rp25.000).
- **Paket Catering**: Paket Silver Box (Rp25.000/pax), Paket Gold Box (Rp35.000/pax), Paket Platinum Box (Rp50.000/pax).

- <!-- Trigger redeploy: 2026-09-19 01:30 -->

Selamat berjualan & raih omset maksimal dengan website profesional cepat tanpa biaya hosting bulanan! 🎉
