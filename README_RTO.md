# RTO — Realtime Order (Landing Page → POS Kasir)

Pickup only. Customer checkout di landing page, transaksi langsung masuk POS kasir
tanpa rekonsiliasi manual.

## Status per fase

| Fase | Isi | Status |
| :--- | :--- | :--- |
| 1 | Backend & schema (`/online_orders`, reserved stock atomik, `/payment/create`, `/payment/webhook`, extend `/pos/transactions`) | ✅ selesai, 57/57 uji E2E PASS |
| 2 | Frontend customer (`index.html`): modal checkout, halaman QRIS + countdown + listener, auto-download struk PDF | ⏳ |
| 3 | Frontend kasir (`kasir.html` + `kasir-app.js`): tab Order Online, list + detail, Done, verifikasi QRIS statis | ⏳ |
| 4 | Nice-to-have: filter/search/statistik lanjutan, auto-print, void/refund, WA notif | ⏳ (search/statistik dasar sudah ada di `/online-orders/list`) |

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
| `PATCH /online-orders/{orderId}` | `action: customer_paid \| done \| expire \| cancel` |

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

QRIS dinamis Midtrans ikut didukung (kalau `siteConfig.paymentConfig.enableMidtrans`
true dan `MIDTRANS_SERVER_KEY` diset) dengan masa berlaku 5 menit — opsional.

## Uji E2E

Harness uji (di luar repo, jalankan dengan Node ≥ 18):

```bash
node rto-e2e.mjs        # 57 assertion: create, reserve, race 12 paralel, paid, done, expire, webhook, list, guard
node rto-e2e.mjs --keep # biarkan fixture untuk inspeksi manual
```

Fixture uji (`inv_rto_t_gram`, `inv_rto_t_kg`, `rto_t_menu`) dan seluruh order uji
dihapus otomatis; snapshot `/accounting/*` dikembalikan persis seperti sebelum uji.

## Catatan keamanan (penting)

Rules Realtime Database yang aktif di project sekarang **terbuka untuk publik (read &
write)** — siapa pun bisa menulis. Endpoint RTO mengasumsikan validasi di sisi server,
tapi selama rules masih terbuka, integritas data tidak bisa dijamin. Sebelum production,
publish `firebase-rules.json` (root `.read/.write: false`) + pindahkan baca landing page
ke endpoint `/inventory`, `/menu`, `/site_config` (proxy Functions) agar tidak ada
penulisan langsung dari browser.
