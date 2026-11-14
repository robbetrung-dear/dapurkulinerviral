import re

path = 'public/kasir-app.js'
with open(path, 'r') as f:
    content = f.read()

# Replace ALL occurrences of hardcoded brand fallbacks

# 1. customKasirSubtitle: 'Dapur Kuliner Viral' -> '' (all occurrences)
count = content.count("customKasirSubtitle: 'Dapur Kuliner Viral',")
content = content.replace("customKasirSubtitle: 'Dapur Kuliner Viral',", "customKasirSubtitle: '',")
print(f'customKasirSubtitle replaced: {count}')

# 2. splashKasirSubtitle: 'Digital Culinary' -> ''
count = content.count("splashKasirSubtitle: 'Digital Culinary',")
content = content.replace("splashKasirSubtitle: 'Digital Culinary',", "splashKasirSubtitle: '',")
print(f'splashKasirSubtitle replaced: {count}')

# 3. brandName: 'Dapur Kuliner Viral & Catering Rumahan' -> ''
count = content.count("brandName: 'Dapur Kuliner Viral & Catering Rumahan',")
content = content.replace("brandName: 'Dapur Kuliner Viral & Catering Rumahan',", "brandName: '',")
print(f'brandName (init) replaced: {count}')

# 4. this.splashKasirSubtitle = this.customKasirSubtitle || 'Digital Culinary' -> ''
count = content.count("this.splashKasirSubtitle = this.customKasirSubtitle || 'Digital Culinary';")
content = content.replace("this.splashKasirSubtitle = this.customKasirSubtitle || 'Digital Culinary';", "this.splashKasirSubtitle = this.customKasirSubtitle || '';")
print(f'splashKasirSubtitle fallback replaced: {count}')

# 5. this.customKasirTitle || 'Dapur Kuliner Viral' -> '' (all)
count = content.count("this.customKasirTitle || 'Dapur Kuliner Viral'")
content = content.replace("this.customKasirTitle || 'Dapur Kuliner Viral'", "this.customKasirTitle || ''")
print(f'customKasirTitle fallback replaced: {count}')

# 6. const brand = ... : 'Dapur Kuliner Viral' -> ''
count = content.count(": 'Dapur Kuliner Viral';")
content = content.replace(": 'Dapur Kuliner Viral';", ": '';")
print(f'brand fallback (const brand) replaced: {count}')

# 7. this.siteInfo.brandName || 'Dapur Kuliner Viral' -> ''
count = content.count("this.siteInfo.brandName || 'Dapur Kuliner Viral'")
content = content.replace("this.siteInfo.brandName || 'Dapur Kuliner Viral'", "this.siteInfo.brandName || ''")
print(f'siteInfo.brandName fallback replaced: {count}')

# 8. this.customKasirTitle || 'DAPUR KULINER VIRAL' -> '' (all)
count = content.count("this.customKasirTitle || 'DAPUR KULINER VIRAL'")
content = content.replace("this.customKasirTitle || 'DAPUR KULINER VIRAL'", "this.customKasirTitle || ''")
print(f'customKasirTitle (uppercase) fallback replaced: {count}')

# 9. doc.text(this.customKasirTitle || 'DAPUR KULINER VIRAL', ...) -> ''
count = content.count("doc.text(this.customKasirTitle || 'DAPUR KULINER VIRAL',")
content = content.replace("doc.text(this.customKasirTitle || 'DAPUR KULINER VIRAL',", "doc.text(this.customKasirTitle || '',")
print(f'doc.text (uppercase) fallback replaced: {count}')

with open(path, 'w') as f:
    f.write(content)

print('public/kasir-app.js: all brand hardcodes replaced with dynamic')
