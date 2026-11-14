import re

path = 'public/kasir-app.js'
with open(path, 'r') as f:
    content = f.read()

# 1. Line 539: qrisMerchantName: 'Dapur Kuliner Viral' -> ''
old1 = "qrisMerchantName: 'Dapur Kuliner Viral',"
new1 = "qrisMerchantName: '',"
assert content.count(old1) == 1, f'change 1 not unique: {content.count(old1)}'
content = content.replace(old1, new1)

# 2. Lines 3154, 3269: doc.text('DAPUR KULINER VIRAL', ...) -> doc.text('', ...)
old2 = "doc.text('DAPUR KULINER VIRAL',"
new2 = "doc.text('',"
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'doc.text DAPUR KULINER VIRAL replaced: {count2}')

# 3. Line 3393: *DAPUR KULINER VIRAL - STRUK TRANSAKSI* -> dynamic
old3 = "const text = `*DAPUR KULINER VIRAL - STRUK TRANSAKSI*\\n\\n` +"
new3 = "const brand = (this.siteInfo && this.siteInfo.brandName) ? this.siteInfo.brandName : '';\nconst text = `*${brand} - STRUK TRANSAKSI*\\n\\n` +"
assert content.count(old3) == 1, f'change 3 not unique: {content.count(old3)}'
content = content.replace(old3, new3)

# 4. Line 3403: Terima kasih telah berbelanja di Dapur Kuliner Viral! -> dynamic
old4 = "`Terima kasih telah berbelanja di Dapur Kuliner Viral!`;"
new4 = "`Terima kasih telah berbelanja di ${(this.siteInfo && this.siteInfo.brandName) ? this.siteInfo.brandName : ''}!`;"
assert content.count(old4) == 1, f'change 4 not unique: {content.count(old4)}'
content = content.replace(old4, new4)

# 5. Lines 10660, 10734: Digital Culinary auto-report -> dynamic (these are WhatsApp auto-reports)
old5 = "'🤖 Auto-report POS Digital Culinary'"
new5 = "'🤖 Auto-report POS'"
assert content.count(old5) == 1, f'change 5 not unique: {content.count(old5)}'
content = content.replace(old5, new5)

old6 = "'_POS Digital Culinary_';"
new6 = "'_POS_';"
assert content.count(old6) == 1, f'change 6 not unique: {content.count(old6)}'
content = content.replace(old6, new6)

# 6. Line 5 comment - update comment
old6b = "* Sistem Kasir Pintar POS - Dapur Kuliner Viral & Catering Rumahan"
new6b = "* Sistem Kasir Pintar POS - [Nama Toko] & Catering Rumahan"
count6b = content.count(old6b)
content = content.replace(old6b, new6b)
print(f'Comment line 5 replaced: {count6b}')

with open(path, 'w') as f:
    f.write(content)

print('public/kasir-app.js: remaining brand hardcodes replaced')
