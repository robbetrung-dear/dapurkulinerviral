import re

path = 'public/index.html'
with open(path, 'r') as f:
    content = f.read()

# 1. Fix fallback in cached config (line ~143): 'DIGITAL CULINARY' -> empty string
old1 = "brandName: String(cfg.brandName || 'DIGITAL CULINARY').trim(),"
new1 = "brandName: String(cfg.brandName || '').trim(),"
assert content.count(old1) == 1, f'index.html change 1 not unique: {content.count(old1)}'
content = content.replace(old1, new1)

# 2. Fix fallback in default return (line ~152): 'DIGITAL CULINARY' -> empty string
old2 = "return { brandName: 'DIGITAL CULINARY', logoBgColor: '#ea580c', logoImage: '' };"
new2 = "return { brandName: '', logoBgColor: '#ea580c', logoImage: '' };"
assert content.count(old2) == 1, f'index.html change 2 not unique: {content.count(old2)}'
content = content.replace(old2, new2)

# 3. Fix splashBrandName (line ~6046): 'DIGITAL CULINARY' -> empty string
old3 = "splashBrandName: 'DIGITAL CULINARY',"
new3 = "splashBrandName: '',"
assert content.count(old3) == 1, f'index.html change 3 not unique: {content.count(old3)}'
content = content.replace(old3, new3)

# 4. Fix siteConfig.brandName (line ~6068): 'DAPUR KULINER VIRAL' -> empty string
old4 = "brandName: 'DAPUR KULINER VIRAL',"
new4 = "brandName: '',"
assert content.count(old4) == 1, f'index.html change 4 not unique: {content.count(old4)}'
content = content.replace(old4, new4)

# 5. Fix static HTML title text "DIGITAL CULINARY" (line ~265) -> dynamic
old5 = '''    <h1 id="splashTitleStatic"
        style="font-family:'Plus Jakarta Sans',sans-serif; font-weight:900; color:#fff; font-size:1.75rem; letter-spacing:-0.025em; text-transform:uppercase; text-align:center; padding:0 24px; margin:0;">
      DIGITAL CULINARY
    </h1>'''
new5 = '''    <h1 id="splashTitleStatic"
        style="font-family:'Plus Jakarta Sans',sans-serif; font-weight:900; color:#fff; font-size:1.75rem; letter-spacing:-0.025em; text-transform:uppercase; text-align:center; padding:0 24px; margin:0;"
        x-text="splashBrandName.toUpperCase() || 'NAMA TOKO'">
    </h1>'''
assert content.count(old5) == 1, f'index.html change 5 not unique: {content.count(old5)}'
content = content.replace(old5, new5)

with open(path, 'w') as f:
    f.write(content)

print('public/index.html: all brand hardcodes replaced with dynamic')
