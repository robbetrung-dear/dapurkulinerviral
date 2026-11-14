import re

path = 'public/kasir-app.js'
with open(path, 'r') as f:
    content = f.read()

# Change 6: `_POS Digital Culinary_` -> `_POS_` (backtick quoted)
old6 = "`_POS Digital Culinary_`;"
new6 = "`_POS_`;"
count6 = content.count(old6)
content = content.replace(old6, new6)
print(f'Change 6 (POS footer): {count6}')

with open(path, 'w') as f:
    f.write(content)

print('Done')
