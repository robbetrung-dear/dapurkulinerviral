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

- `paid` → orderId, status, total, rincian item, instruksi pickup, alamat + jam operasional outlet
- `done` → ucapan terima kasih + struk text (item, total, kasir, waktu WIB)
- `cancelled` → pembatalan, alasan, info refund (gateway atau manual tunai/transfer)

Idempotency per status: marker `/online_orders/{orderId}/wa_notifications/{status}`; kegagalan
kirim tidak pernah menggagalkan alur order (tercatat di `steps.wa`).

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
| browser E2E | Done → auto-print (1× `window.print()`), skip saat `autoPrint=false`, tombol Cetak Struk tetap jalan, alur PIN → konfirmasi VOID → badge `DIBATALKAN` + strikethrough | PASS |

Fixture uji (`inv_rto_t_gram`, `inv_rto_t_kg`, `rto_t_menu`) dan seluruh order uji
dihapus otomatis; snapshot `/accounting/*` dikembalikan persis seperti sebelum uji.

## Catatan keamanan (penting)

Rules Realtime Database yang aktif di project sekarang **terbuka untuk publik (read &
write)** — siapa pun bisa menulis. Endpoint RTO mengasumsikan validasi di sisi server,
tapi selama rules masih terbuka, integritas data tidak bisa dijamin. Sebelum production,
publish `firebase-rules.json` (root `.read/.write: false`) + pindahkan baca landing page
ke endpoint `/inventory`, `/menu`, `/site_config` (proxy Functions) agar tidak ada
penulisan langsung dari browser.
