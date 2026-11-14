import re

# ============ FIX public/index.html for dapurkulinerviral ============
path = 'public/index.html'
with open(path, 'r') as f:
    content = f.read()

replacements = [
    # Title tag
    ('<title>Dapur Kuliner Viral & Catering Rumahan | Dari Dapur Kami, Viral di Meja Anda</title>',
     '<title><span x-text="siteConfig.brandName || \'\'"></span> & Catering Rumahan | Dari Dapur Kami, Viral di Meja Anda</title>'),
    # Meta author
    ('<meta name="author" content="Dapur Kuliner Viral" />',
     '<meta name="author" content="" />'),
    # og:title
    ('<meta property="og:title" content="Dapur Kuliner Viral & Catering Rumahan" />',
     '<meta property="og:title" content="" />'),
    # JSON-LD name
    ('"name": "Dapur Kuliner Viral & Catering",',
     '"name": "",'),
    # x-text fallback qrisMerchantName
    ("x-text=\"siteConfig.paymentConfig.qrisMerchantName || 'DAPUR KULINER VIRAL - QRIS RESMI'\"",
     'x-text="siteConfig.paymentConfig.qrisMerchantName || \'\'"'),
    # x-text fallback bankAccountHolder
    ("x-text=\"siteConfig.paymentConfig.bankAccountHolder || 'DAPUR KULINER VIRAL'\"",
     'x-text="siteConfig.paymentConfig.bankAccountHolder || \'\'"'),
    # Hardcoded text line 2404
    ('Silakan pilih pintu masuk portal sesuai peran operasional Anda di <span class="font-bold text-stone-700">Dapur Kuliner Viral</span>.',
     'Silakan pilih pintu masuk portal sesuai peran operasional Anda di <span class="font-bold text-stone-700" x-text="siteConfig.brandName || \'\'"></span>.'),
    # Placeholder qrisMerchantName
    ('placeholder="Contoh: DAPUR KULINER VIRAL"',
     'placeholder="Contoh: Nama Toko"'),
    # x-text fallback qrisMerchantName (line 4117)
    ("x-text=\"siteConfig.paymentConfig.qrisMerchantName || 'DAPUR KULINER VIRAL'\"",
     'x-text="siteConfig.paymentConfig.qrisMerchantName || \'\'"'),
    # Placeholder bankAccountHolder
    ('placeholder="Contoh: DAPUR KULINER VIRAL"',
     'placeholder="Contoh: Nama Pemilik Rekening"'),
    # Hardcoded text line 4329
    ('Langkah demi langkah menyebarkan website Dapur Kuliner Viral ke Cloudflare Pages dengan CDN gratis global, SSL otomatis, dan serverless functions.',
     'Langkah demi langkah menyebarkan website ke Cloudflare Pages dengan CDN gratis global, SSL otomatis, dan serverless functions.'),
    # Placeholder line 4541
    ('placeholder="Dapur Kuliner Viral" ',
     'placeholder="Nama Toko" '),
    # x-text fallback kasirSubtitle line 4558
    ("x-text=\"siteConfig.kasirSubtitle || 'Dapur Kuliner Viral'\"",
     'x-text="siteConfig.kasirSubtitle || \'\'"'),
    # Hardcoded text line 5786
    ('client: "Admin CMS Dapur Kuliner Viral"',
     'client: "Admin CMS"'),
    # kasirSubtitle init line 6143
    ("kasirSubtitle: 'Dapur Kuliner Viral',",
     "kasirSubtitle: '',"),
]

for old, new in replacements:
    count = content.count(old)
    content = content.replace(old, new)
    if count > 0:
        print(f'index.html: "{old[:50]}..." -> {count}')

with open(path, 'w') as f:
    f.write(content)

print('public/index.html: done')

# ============ FIX functions/report-pl.js ============
path = 'functions/report-pl.js'
with open(path, 'r') as f:
    content = f.read()

old = 'name: "DAPUR KULINER VIRAL",'
new = 'name: "",'
count = content.count(old)
content = content.replace(old, new)
print(f'report-pl.js name: {count}')

old2 = 'addText(company.name || "DAPUR KULINER VIRAL", marginX + 16, curY - 18, 14, true, [1, 1, 1]);'
new2 = 'addText(company.name || "", marginX + 16, curY - 18, 14, true, [1, 1, 1]);'
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'report-pl.js addText: {count2}')

with open(path, 'w') as f:
    f.write(content)

print('functions/report-pl.js: done')

# ============ FIX functions/receipt.js ============
path = 'functions/receipt.js'
with open(path, 'r') as f:
    content = f.read()

old = 'name: "DAPUR KULINER VIRAL",'
new = 'name: "",'
count = content.count(old)
content = content.replace(old, new)
print(f'receipt.js name: {count}')

old2 = 'addCenterText(company.name || "DAPUR KULINER VIRAL", 12, true);'
new2 = 'addCenterText(company.name || "", 12, true);'
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'receipt.js addCenterText: {count2}')

with open(path, 'w') as f:
    f.write(content)

print('functions/receipt.js: done')

# ============ FIX public/accounting-app.js comment ============
path = 'public/accounting-app.js'
with open(path, 'r') as f:
    content = f.read()

old = "* Dapur Kuliner Viral - Panel Admin & Ownerj.debitName || ('Akun '"
new = "* [Nama Toko] - Panel Admin & Ownerj.debitName || ('Akun '"
count = content.count(old)
content = content.replace(old, new)
print(f'accounting-app.js comment: {count}')

with open(path, 'w') as f:
    f.write(content)

print('public/accounting-app.js comment: done')

print('\n=== Semua perubahan dapurkulinerviral selesai ===')
