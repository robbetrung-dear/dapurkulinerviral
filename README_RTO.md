# RTO — Realtime Order (Landing Page → POS Kasir)

Pickup only. Customer checkout di landing page, transaksi langsung masuk POS kasir
tanpa rekonsiliasi manual.

## Status per fase

| Fase | Isi | Status |
| :--- | :--- | :--- |
| 1 | Backend & schema (`/online_orders`, reserved stock atomik, `/payment/create`, `/payment/webhook`, extend `/pos/transactions`) | ✅ selesai, 57/57 uji E2E PASS |
| 2 | Frontend customer (`index.html`): modal checkout, halaman QRIS + countdown + listener, auto-download struk PDF | ✅ selesai |
| 3 | Frontend kasir (`kasir.html` + `kasir-app.js`): tab Order Online, list + detail, Done, verifikasi QRIS statis | ✅ selesai |
| 4 | Fase 4 item 1 — void/refund order online (PIN supervisor, reverse stok/jurnal/POS, audit log) | ✅ selesai, 43/43 + 21/21 uji LIVE PASS |
| 4 | Fase 4 item 2 — auto-print struk saat Done (+ toggle printer & tombol cetak manual) | ✅ selesai, uji UI browser PASS |
| 4 | Fase 4 item 3 — WA notif customer (paid / done / cancelled) via `/api/send-wa` | ✅ selesai, 23/23 + 11/11 uji LIVE PASS |
| 5 | Item 1 — modal keranjang/checkout landing conditional (RTO restricted: pickup + QRIS saja, WA wajib 62xxx, info tanya-admin hanya non-RTO, riwayat filter `done`) | ✅ selesai, uji UI browser PASS |
| 5 | Item 2 — sold out behavior landing (badge Sold Out, tombol Tambah abu-abu/nonaktif, klik diblokir + toast) | ✅ selesai, uji UI browser PASS |
| 5 | Item 3 — WA notif otomatis via **Fonnte** (done + cancelled), paid **tanpa** WA, idempotency `/notifications_log/{orderId}_wa_{status}` | ✅ selesai, 30/30 lokal + 13/13 uji LIVE PASS |
| 5 | Item 4 — modal Kirim WA kasir auto-populate nomor customer (order online readonly 62xxx, walk-in tetap manual) | ✅ selesai, uji UI browser PASS |
| 5 | Item 5 — struk fix: footer standar `brandName`, tinggi halaman dinamis, print tidak terpotong (`Kembali` + footer ikut tercetak) | ✅ selesai, uji JS/PDF + CSS `@media print` PASS |
| 5 | Item 6 — filter **Online** di riwayat transaksi kasir (kolom terpisah dari QRIS + badge Online) | ✅ selesai, uji UI browser PASS (5 kasus filter) |

## Lifecycle status

```
pending_payment  → QRIS dibuat, tunggu bayar (5 menit)
pending          → customer klaim sudah bayar, tunggu konfirmasi gateway/kasir
paid             → terkonfirmasi; reserved dilepas + jurnal + insert /pos/transactions
done             → pesanan diserahkan; ksr/shf diisi kasir yang klik Done
expired          → lewat 5 menit / gagal bayar; stok dikembalikan
```

## Endpoint

| Endpoint | Fungsi |
| :--- | :--- |
| `POST /payment/create` | Validasi customer (nama + no WA), hitung total dari harga server, create `/online_orders/{orderId}`, **reserve stok atomik**, generate QRIS (dinamis → fallback statis admin) |
| `POST /payment/webhook` | Callback gateway (iFortePay). Status paid → semua efek kasir auto-trigger |
| `GET /online-orders/list` | Queue kasir + statistik harian + sweep order expired (`?status=paid&date=&q=&limit=`) |
| `GET /online-orders/{orderId}` | Detail order (dipakai halaman QRIS customer) |
| `POST /online-orders/verify` | Verifikasi manual kasir (QRIS statis) → `paid` |
| `POST /online-orders/expire` | Expire 1 order (`{orderId}`) atau sweep semua |
| `PATCH /online-orders/{orderId}` | `action: customer_paid \| done \| expire \| cancel \| void` |

Kode bersama ada di `lib/rto-core.js` (di luar `functions/` supaya tidak jadi route).

## Schema

`/online_orders/{orderId}` — lihat `functions/payment/create.js`.
Field tambahan di luar spesifikasi minimum: `reserved_items[]` (rincian bahan untuk
release/rollback), `reserved_summary`, `pos_date`, `expired_reason`, `done_at`, `done_by`.

`/inventory/{itemId}` — **tanpa mengubah field lama**, hanya menambah:

```json
{ "reserved": 0 }
```

`/pos/transactions/{date}/{txId=orderId}` — format POS existing (`t, items[[id,qty,price]],
sub, tax, disc, tot, pm, ksr, shf, payDetail`) + field baru:

```json
{ "source": "landing-page", "online_order_id": "ORD-..." }
```

`ksr`/`shf` diisi saat kasir klik **Done** (bukan saat create), sesuai CONSTRAINT-4.
Transaksi juga ditulis ke `/accounting/journal/{bulan}` lewat handler resmi
`/accounting/journal/pos` (D Kas/Bank 1002, K Pendapatan 4001, plus HPP).

## Reserved stock (anti race condition)

Firebase RTDB tidak punya transaksi multi-node via REST, jadi dipakai **conditional
write ETag + `if-match`** (HTTP 412 kalau node berubah) dengan retry loop —
per item atomik:

- Reserve: `stock -= qty`, `reserved += qty`
- Paid: `reserved -= qty` (stok sudah dipotong) = permanent deduct
- Expired / gagal: `stock += qty`, `reserved -= qty`

`qty` = kebutuhan bahan dari `/recipes/{menuId}` × qty pesanan (dengan konversi satuan
kg↔gram, liter↔ml), sama dengan pipeline `/inventory/deduct` POS, sehingga angka stok
yang dilihat customer di landing page langsung ikut turun.

Idempotency: `/rto_processed/{orderId}/{reserve|paid|expired}`.

## Environment variables

| Nama | Keterangan |
| :--- | :--- |
| `IFORTEPAY_CREATE_URL` | URL create QRIS dinamis iFortePay (opsional — belum tersedia, otomatis fallback QRIS statis admin) |
| `IFORTEPAY_API_KEY` | API key iFortePay |
| `IFORTEPAY_MERCHANT_ID` | Merchant ID iFortePay |
| `IFORTEPAY_CALLBACK_URL` | URL callback yang didaftarkan ke iFortePay |
| `IFORTEPAY_WEBHOOK_SECRET` | Kalau diisi, `/payment/webhook` wajib cocok signature/`x-callback-token` |
| `IFORTEPAY_REFUND_URL` | URL refund iFortePay (opsional). Kalau tidak diisi, void order `paid`/`pending` memakai **refund manual** (kasir kembalikan tunai/transfer) |
| `WA_FONNTE_TOKEN` | Token Fonnte untuk notifikasi WA otomatis (done/cancelled). Alias `FONNTE_TOKEN`, fallback `site_config.fonnteToken`. **Sudah terpasang di production R&D.** Kalau kosong, WA hanya dicatat (`ready_for_web`) |

QRIS dinamis Midtrans ikut didukung (kalau `siteConfig.paymentConfig.enableMidtrans`
true dan `MIDTRANS_SERVER_KEY` diset) dengan masa berlaku 5 menit — opsional.

## Fase 4 — void/refund, auto-print, WA notif

**Void/refund (`PATCH /online-orders/{id}`, `action: void`)** — hanya kasir yang login, wajib
PIN supervisor (`siteConfig.supervisorPin`, diverifikasi **di server** → 403 kalau salah) dan
alasan min 5 karakter (400). Per status:

| Status order | Aksi | Refund |
| :--- | :--- | :--- |
| `pending_payment` | cancel + lepas reserved stok | tidak ada |
| `pending` | cancel + lepas reserved stok | gateway (kalau ada) / manual kasir |
| `paid` | cancel + reverse stok + reverse jurnal + void transaksi POS | gateway (kalau ada) / manual kasir |
| `done` | **DIBLOKIR** (409) — pesanan sudah diserahkan | – |

- Reverse jurnal = counter-entry `D 4001 Pendapatan / K 1002 Kas-Bank` (kategori `penyesuaian`,
  `ref = VOID-{orderId}`, idempotent kalau di-retry). HPP tidak dibalik (mengikuti perilaku void
  transaksi POS existing).
- Transaksi POS ditandai `voided: true`, `voidReason`, `voidSource: 'rto-void-online'`.
- Field baru di `/online_orders/{orderId}`: `cancelled_at`, `cancelled_by`, `cancel_reason`,
  `void: { voided, voided_by, supervisor_verified, refund_amount, refund_mode, ... }`.
- Audit: 2 entri di `/audit_logs` per void ber-refund (`action: 'void'` dan `'refund'`) dengan
  `orderId, kasirUsername, supervisorVerified, refundAmount, refundMode, timestamp, reason` +
  field lama (`at/user/status/target`) agar viewer audit kasir tetap kompatibel.

**Auto-print struk** — saat kasir klik **Done**, `printOnlineOrderStruk()` mengisi ulang
`#receiptPrintArea` (satu-satunya target `@media print` di `kasir.html`) lewat `previewStruk()`
lalu memanggil `window.print()`. Kalau `printerConfig.autoPrint === false` (toggle di modal
Pengaturan Printer, tersimpan di `localStorage.dapur_printer_config`) auto-print di-skip; tombol
manual **Cetak Struk** di detail order tetap mencetak.

**WA notif customer** — dikirim lewat HTTP self-call ke `/api/send-wa` (template `rto_paid`,
`rto_done`, `rto_cancelled`), isi memakai `siteConfig` (brand, alamat, jam operasional, telepon):

- `paid` → **dihentikan di Fase 5** (paid tidak lagi kirim WA; customer cukup melihat notif di
  landing page). Guard-nya ada di `sendOrderWa()` → `skipped: paid_tidak_kirim_wa`
- `done` → ucapan terima kasih + struk text (item, total, kasir, waktu WIB)
- `cancelled` → pembatalan, alasan, info refund (gateway atau manual tunai/transfer)

Idempotency per status: marker `/online_orders/{orderId}/wa_notifications/{status}` + log
`/notifications_log/{orderId}_wa_{status}` (lihat Fase 5); kegagalan kirim tidak pernah
menggagalkan alur order (tercatat di `steps.wa`).

## Fase 5 — mode conditional, sold out, WA Fonnte, struk, filter Online

**Item 1 — modal keranjang/checkout landing conditional.** Semua pembatasan HANYA aktif saat
`siteConfig.showMenuStockOnMain === true` (getter `isRtoRestricted` di `index.html`):

| Aspek | RTO aktif (`true`) | Non-RTO (`false`) |
| :--- | :--- | :--- |
| Pengiriman | pickup saja — tombol "Dikirim Kurir" disembunyikan, `rtoPickup` dipaksa `true` | bebas (kurir + pickup) |
| Pembayaran | QRIS saja (opsi e-wallet & transfer bank hilang) | bebas sesuai `paymentConfig` |
| Nomor WA | wajib `/^62\d{9,13}$/` (auto-normalisasi `08xx` → `62xx`), error inline di bawah input | bebas (min 9 digit) |
| Info "tanya stok ke admin" | disembunyikan (diganti info pickup + QRIS) | tampil seperti semula |
| Riwayat (`localStorage.dapur_recent_orders`) | hanya status `done` (`getRecentOrders()` filter), tombol re-download struk PDF | semua status |

Submit form memakai `(rtoPickup || isRtoRestricted) ? startRtoCheckout() : proceedToPayment()`
sehingga localStorage basi tidak bisa menjatuhkan customer ke alur delivery lama.

**Item 2 — sold out.** `isMenuSoldOut(item)` = `getMenuDisplayStock(item) === 0` **atau**
`getInventoryStockForMenu(item).stock === 0`. Badge "Sold Out" tampil (sudah ada), tombol
"+Tambah" abu-abu/`cursor-not-allowed`/opacity 50 di ketiga mode tampilan menu, dan klik tetap
masuk ke `addToCart()` yang langsung berhenti + toast
"Stok {nama} habis, silakan pilih menu lainnya." (tombol tidak di-`disabled` HTML supaya toast-nya
bisa muncul; add to cart tetap diblokir).

**Item 3 — trigger WA (final).**

| Status | WA | Isi |
| :--- | :--- | :--- |
| `paid` | **tidak dikirim** (`sendOrderWa` langsung `skipped: paid_tidak_kirim_wa`) | customer lihat notif di landing: "Pembayaran diterima. Pesanan siap diambil di outlet." |
| `done` | dikirim otomatis saat kasir klik Done | ucapan terima kasih + orderId + items ringkas + total + struk text |
| `cancelled` | dikirim otomatis saat void/refund | info pembatalan + orderId + alasan + info refund |

Provider produksi: **Fonnte** — `POST https://api.fonnte.com/send` (form-urlencoded `target`,
`message`, `countryCode=62`, header `Authorization: <token>`). Token dibaca dari env
`WA_FONNTE_TOKEN` (alias `FONNTE_TOKEN`, fallback `site_config.fonnteToken`); kalau tidak ada,
handler jatuh ke gateway `waGatewayUrl` lama, dan kalau tidak ada juga baru `ready_for_web`.
**Penting:** Fonnte membalas HTTP 200 walau gagal (`{"status":false,"reason":"..."}`), jadi sukses
ditentukan dari body — status `sent` / `failed_gateway` / `failed_http` / `fonnte_error`.

Idempotency dua lapis: marker `/online_orders/{orderId}/wa_notifications/{status}` **dan** log
deterministik `/notifications_log/{orderId}_wa_{status}` (dicek sebelum kirim, ditulis sebagai
`status: 'sending'` sebelum request dan di-update setelahnya; request `logId` yang sama akan
mengembalikan `skipped: true, duplicate: true`).

**Item 4 — kirim WA kasir.** Modal struk POS menerima `customerPhone`/`customer.phone`; kalau ada,
input nomor WA terisi otomatis **readonly** dengan format `62xxx` (label "(dari order online)"),
tombol Kirim WA membuka `wa.me/{phone}?text=...`. Order walk-in tetap manual (field kosong &
editable). Transaksi online yang di-recall dari riwayat transaksi mengambil nomor dari
`/online-orders/{online_order_id}`.

**Item 5 — struk.** Footer semua struk (kasir PDF/print maupun landing PDF):
`Terima kasih sudah berbelanja di {siteConfig.brandName} & selamat menikmati.`
Tinggi halaman jsPDF dihitung dari isi (`estimateStrukHeightPdf` / `estimateStrukHeightPrint` /
formula landing) sehingga item + baris diskon/service/PPN/tunai + footer tidak pernah terpotong.
Akar bug "struk terpotong berhenti di `Kembali: Rp 0`": `#receiptPrintArea` berada di dalam modal
`overflow-y-auto`, jadi `window.print()` memotong isi sesuai tinggi kotak scroll. Blok
`@media print` sekarang membuka semua kliping (`html, body, .overflow-y-auto, #receiptPrintArea *`
→ `overflow: visible; max-height: none; height: auto`) + `@page { margin: 6mm }`, dan preview struk
kasir memuat baris footer yang sebelumnya tidak ada.

**Item 6 — filter Online.** Modal riwayat transaksi kasir punya filter ke-5 **Online** (tombol
indigo, kolom terpisah dari QRIS). Transaksi dianggap online bila `source === 'landing-page'` atau
`online_order_id` terisi; badge **Online** tampil di kartu transaksi. Aturan filter:
`Semua` = kasir + online, `Tunai`/`QRIS`/`Transfer` = transaksi kasir saja (online tidak
digabung), `Online` = order landing page saja. Void tetap disembunyikan di semua filter.

## Uji E2E

Harness uji (di luar repo, jalankan dengan Node ≥ 18):

```bash
node rto-e2e.mjs        # 57 assertion: create, reserve, race 12 paralel, paid, done, expire, webhook, list, guard
node rto-e2e.mjs --keep # biarkan fixture untuk inspeksi manual
```

Fase 4 diuji dengan harness terpisah terhadap handler asli + DB R&D (semua snapshot
`/accounting`, `/pos/transactions`, `/audit_logs`, `/notifications_log` dikembalikan persis):

| Harness | Cakupan | Hasil |
| :--- | :--- | :--- |
| `e2e-rto-void.mjs` | void/refund paid·pending·pending_payment·done, PIN salah, alasan kurang, idempotensi retry, list/stats, regresi | 43/43 PASS |
| `e2e-void-live.mjs` | hal yang sama lewat origin terdeploy (self-call jurnal + WA) | 21/21 PASS |
| `e2e-wa.mjs` | isi pesan 3 status, marker `wa_notifications`, anti dobel, order tanpa nomor WA | 23/23 PASS |
| `e2e-wa-live.mjs` | WA paid/done/cancelled lewat origin terdeploy + probe `/api/send-wa` | 11/11 PASS |
| `e2e-wa-fase5.mjs` | isi pesan WA done/cancelled, paid tanpa WA (tanpa log), log deterministik `notifications_log/{orderId}_wa_{status}`, 3 lapis skip (marker / log / duplicate di `/api/send-wa`), jalur Fonnte (token invalid → `failed_gateway`), cleanup | 30/30 PASS |
| `e2e-f5-wa-live.mjs` | LIVE: Done dari origin terdeploy → log `_wa_done` (provider fonnte) + marker order, tidak ada log `_wa_paid`, Done ulang di-skip log, node uji dihapus | 13/13 PASS |
| browser E2E fase 5 | mode conditional (restricted vs non-RTO) di modal keranjang + checkout, validasi WA inline, riwayat filter `done`, sold out (badge + tombol + toast), struk kasir (PDF berisi footer + tinggi 139mm, `@media print` tanpa kliping), struk landing (170mm + footer), auto-populate WA kasir + `wa.me/62...`, filter Online | PASS |
| browser E2E | Done → auto-print (1× `window.print()`), skip saat `autoPrint=false`, tombol Cetak Struk tetap jalan, alur PIN → konfirmasi VOID → badge `DIBATALKAN` + strikethrough | PASS |

Fixture uji (`inv_rto_t_gram`, `inv_rto_t_kg`, `rto_t_menu`) dan seluruh order uji
dihapus otomatis; snapshot `/accounting/*` dikembalikan persis seperti sebelum uji.

## Catatan operasional

- Notifikasi WA otomatis jalan penuh hanya kalau perangkat Fonnte **connected**. Saat diuji
  16 Okt 2026 device-nya `disconnected`, jadi Fonnte membalas
  `{"status":false,"reason":"request invalid on disconnected device"}` → log tercatat
  `failed_gateway` (bukan `sent`). Sambungkan ulang device di dashboard Fonnte sebelum mengandalkan
  notif WA.
- `npm run lint` (`tsc --noEmit`) masih gagal pada error type lama di `server.ts` (field inventory
  seperti `sku`/`supplierId`) — bukan berasal dari perubahan HTML/JS Fase 5.

## Catatan keamanan (penting)

Rules Realtime Database yang aktif di project sekarang **terbuka untuk publik (read &
write)** — siapa pun bisa menulis. Endpoint RTO mengasumsikan validasi di sisi server,
tapi selama rules masih terbuka, integritas data tidak bisa dijamin. Sebelum production,
publish `firebase-rules.json` (root `.read/.write: false`) + pindahkan baca landing page
ke endpoint `/inventory`, `/menu`, `/site_config` (proxy Functions) agar tidak ada
penulisan langsung dari browser.
