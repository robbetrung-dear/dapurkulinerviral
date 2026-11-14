import re

path = 'public/kasir-app.js'
with open(path, 'r') as f:
    content = f.read()

# Change 5: '🤖 Auto-report POS Digital Culinary' -> '🤖 Auto-report POS'
old5 = "'🤖 Auto-report POS Digital Culinary'"
new5 = "'🤖 Auto-report POS'"
count5 = content.count(old5)
content = content.replace(old5, new5)
print(f'Change 5 (auto-report): {count5}')

# Change 6: '_POS Digital Culinary_' -> '_POS_'
old6 = "'_POS Digital Culinary_';"
new6 = "'_POS_';"
count6 = content.count(old6)
content = content.replace(old6, new6)
print(f'Change 6 (POS footer): {count6}')

# Change 7: Comment line 5 - update brand name in comment
old7 = "* Sistem Kasir Pintar POS - Dapur Kuliner Viral & Catering Rumahan"
new7 = "* Sistem Kasir Pintar POS - [Nama Toko] & Catering Rumahan"
count7 = content.count(old7)
content = content.replace(old7, new7)
print(f'Change 7 (comment): {count7}')

with open(path, 'w') as f:
    f.write(content)

print('public/kasir-app.js: remaining brand hardcodes replaced')
