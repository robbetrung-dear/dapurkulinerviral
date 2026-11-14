import re

path = 'public/index.html'
with open(path, 'r') as f:
    content = f.read()

replacements = [
    ("qrisMerchantName: 'DAPUR KULINER VIRAL - QRIS RESMI',", "qrisMerchantName: '',"),
    ("bankAccountHolder: 'DAPUR KULINER VIRAL',", "bankAccountHolder: '',"),
    ("(this.siteConfig.brandName || 'DAPUR KULINER VIRAL').trim().split(/\\s+/)", "(this.siteConfig.brandName || '').trim().split(/\\s+/)"),
    ("// Di-generate otomatis dari Panel Admin Dapur Kuliner Viral", "// Di-generate otomatis dari Panel Admin"),
    ("String(this.siteConfig.brandName || \"Dapur Kuliner Viral\").trim()", "String(this.siteConfig.brandName || \"\").trim()"),
    ("String(this.siteConfig.brandName || \"DAPUR KULINER VIRAL\").toUpperCase()", "String(this.siteConfig.brandName || \"\").toUpperCase()"),
    ("doc.text(this.siteConfig.brandName || \"DAPUR KULINER VIRAL\", 105, 28, { align: \"center\" });", "doc.text(this.siteConfig.brandName || \"\", 105, 28, { align: \"center\" });"),
]

for old, new in replacements:
    count = content.count(old)
    content = content.replace(old, new)
    if count > 0:
        print(f'index.html: "{old[:60]}..." -> {count}')

with open(path, 'w') as f:
    f.write(content)

print('public/index.html: final brand hardcodes replaced')
