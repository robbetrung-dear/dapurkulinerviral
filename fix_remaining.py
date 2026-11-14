import re

# Fix accounting.html
path = 'public/accounting.html'
with open(path, 'r') as f:
    content = f.read()

# 1. Title
old1 = "<title>Sistem Akuntansi & Keuangan - Digital Culinary</title>"
new1 = "<title>Sistem Akuntansi & Keuangan - <span x-text=\"siteName || ''\"></span></title>"
count1 = content.count(old1)
content = content.replace(old1, new1)
print(f'accounting.html title: {count1}')

# 2. Line 389: <span ... x-text="siteName">Dapur Kuliner Viral</span>
old2 = '<span class="..." x-text="siteName">Dapur Kuliner Viral</span>'
new2 = '<span class="..." x-text="siteName || \'\'"></span>'
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'accounting.html span: {count2}')

# 3. Line 1195: <h4 ... x-text="siteName.toUpperCase()">DAPUR KULINER VIRAL</h4>
old3 = '<h4 class="..." x-text="siteName.toUpperCase()">DAPUR KULINER VIRAL</h4>'
new3 = '<h4 class="..." x-text="(siteName || \'\').toUpperCase()"></h4>'
count3 = content.count(old3)
content = content.replace(old3, new3)
print(f'accounting.html h4: {count3}')

with open(path, 'w') as f:
    f.write(content)

print('public/accounting.html: brand hardcodes replaced')

# Fix login-gate.html
path2 = 'public/login-gate.html'
with open(path2, 'r') as f:
    content2 = f.read()

# 4. Title
old4 = "<title>Pilih Akses - Kasir Pintar & Panel Admin | Dapur Kuliner Viral</title>"
new4 = "<title>Pilih Akses - Kasir Pintar & Panel Admin | <span x-text=\"siteName || ''\"></span></title>"
count4 = content2.count(old4)
content2 = content2.replace(old4, new4)
print(f'login-gate.html title: {count4}')

# 5. Line 93: <span class="font-bold text-stone-700">Dapur Kuliner Viral</span>
old5 = '<span class="font-bold text-stone-700">Dapur Kuliner Viral</span>'
new5 = '<span class="font-bold text-stone-700" x-text="siteName || \'\'"></span>'
count5 = content2.count(old5)
content2 = content2.replace(old5, new5)
print(f'login-gate.html span: {count5}')

# 6. Line 315: Hubungi Admin Dapur Kuliner
old6 = "Hubungi Admin Dapur Kuliner untuk reset kode shift."
new6 = "Hubungi Admin untuk reset kode shift."
count6 = content2.count(old6)
content2 = content2.replace(old6, new6)
print(f'login-gate.html text: {count6}')

with open(path2, 'w') as f:
    f.write(content2)

print('public/login-gate.html: brand hardcodes replaced')

# Fix lib/rto-core.js
path3 = 'lib/rto-core.js'
with open(path3, 'r') as f:
    content3 = f.read()

# 7. Line 886: const brand = outlet.brandName || "Dapur Kuliner Viral";
old7 = 'const brand = outlet.brandName || "Dapur Kuliner Viral";'
new7 = 'const brand = outlet.brandName || "";'
count7 = content3.count(old7)
content3 = content3.replace(old7, new7)
print(f'rto-core.js brand fallback: {count7}')

with open(path3, 'w') as f:
    f.write(content3)

print('lib/rto-core.js: brand hardcode replaced')
