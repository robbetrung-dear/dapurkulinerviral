import re

path = 'public/kasir.html'
with open(path, 'r') as f:
    content = f.read()

# 1. Line 6: <title>Kasir Pintar - Dapur Kuliner Viral</title> -> dynamic
old1 = "<title>Kasir Pintar - Dapur Kuliner Viral</title>"
new1 = "<title>Kasir Pintar - <span x-text=\"siteInfo.brandName || ''\"></span></title>"
count1 = content.count(old1)
content = content.replace(old1, new1)
print(f'1. title tag: {count1}')

# 2. Line 7541: x-text="customKasirTitle || 'DAPUR KULINER VIRAL'" -> ''
old2 = "x-text=\"customKasirTitle || 'DAPUR KULINER VIRAL'\""
new2 = "x-text=\"customKasirTitle || ''\""
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'2. customKasirTitle fallback: {count2}')

with open(path, 'w') as f:
    f.write(content)

print('public/kasir.html: remaining brand hardcodes replaced')
