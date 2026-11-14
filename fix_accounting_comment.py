import re

path = 'public/accounting-app.js'
with open(path, 'r') as f:
    content = f.read()

# Fix comment line 4
old1 = "* Dapur Kuliner Viral - Panel Admin & Ownerj.debitName || ('Akun '"
new1 = "* [Nama Toko] - Panel Admin & Ownerj.debitName || ('Akun '"
count1 = content.count(old1)
content = content.replace(old1, new1)
print(f'Comment line 4: {count1}')

with open(path, 'w') as f:
    f.write(content)

print('Done')
