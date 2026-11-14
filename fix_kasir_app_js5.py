import re

path = 'public/kasir-app.js'
with open(path, 'r') as f:
    content = f.read()

# 1. qrisMerchantName: 'Dapur Kuliner Viral' -> ''
old1 = "qrisMerchantName: 'Dapur Kuliner Viral',"
new1 = "qrisMerchantName: '',"
count1 = content.count(old1)
content = content.replace(old1, new1)
print(f'1. qrisMerchantName: {count1}')

# 2. doc.text('DAPUR KULINER VIRAL', ...) -> doc.text('', ...) (x2)
old2 = "doc.text('DAPUR KULINER VIRAL',"
new2 = "doc.text('',"
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'2. doc.text DAPUR KULINER VIRAL: {count2}')

# 3. const text = `*DAPUR KULINER VIRAL - STRUK TRANSAKSI*` -> dynamic
old3 = "const text = `*DAPUR KULINER VIRAL - STRUK TRANSAKSI*\\n\\n` +"
new3 = "const brand = (this.siteInfo && this.siteInfo.brandName) ? this.siteInfo.brandName : '';\nconst text = `*${brand} - STRUK TRANSAKSI*\\n\\n` +"
count3 = content.count(old3)
content = content.replace(old3, new3)
print(f'3. STRUK TRANSAKSI header: {count3}')

# 4. `Terima kasih telah berbelanja di Dapur Kuliner Viral!` -> dynamic
old4 = "`Terima kasih telah berbelanja di Dapur Kuliner Viral!`;"
new4 = "`Terima kasih telah berbelanja di ${(this.siteInfo && this.siteInfo.brandName) ? this.siteInfo.brandName : ''}!`;"
count4 = content.count(old4)
content = content.replace(old4, new4)
print(f'4. Terima kasih message: {count4}')

with open(path, 'w') as f:
    f.write(content)

print('public/kasir-app.js: final brand hardcodes replaced')
