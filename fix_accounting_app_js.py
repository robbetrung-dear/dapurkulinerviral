import re

path = 'public/accounting-app.js'
with open(path, 'r') as f:
    content = f.read()

# 1. Line 158: splashAkunSubtitle: 'Digital Culinary' -> ''
old1 = "splashAkunSubtitle: 'Digital Culinary',"
new1 = "splashAkunSubtitle: '',"
count1 = content.count(old1)
content = content.replace(old1, new1)
print(f'1. splashAkunSubtitle init: {count1}')

# 2. Line 162: siteName: 'Dapur Kuliner Viral' -> ''
old2 = "siteName: 'Dapur Kuliner Viral',  // fallback, akan di-load dari site_config/brandName"
new2 = "siteName: '',  // fallback, akan di-load dari site_config/brandName"
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'2. siteName init: {count2}')

# 3. Line 164: brandName: 'Dapur Kuliner Viral' -> ''
old3 = "brandName: 'Dapur Kuliner Viral',"
new3 = "brandName: '',"
count3 = content.count(old3)
content = content.replace(old3, new3)
print(f'3. brandName init: {count3}')

# 4. Line 584: this.splashAkunSubtitle = this.siteName || 'Digital Culinary' -> ''
old4 = "this.splashAkunSubtitle = this.siteName || 'Digital Culinary';"
new4 = "this.splashAkunSubtitle = this.siteName || '';"
count4 = content.count(old4)
content = content.replace(old4, new4)
print(f'4. splashAkunSubtitle fallback (line 584): {count4}')

# 5. Line 608: this.splashAkunSubtitle = this.siteName || 'Digital Culinary' -> ''
old5 = "this.splashAkunSubtitle = this.siteName || 'Digital Culinary';"
count5 = content.count(old5)
content = content.replace(old5, new4)
print(f'5. splashAkunSubtitle fallback (line 608): {count5}')

# 6. Line 663: this.splashAkunSubtitle = this.siteName || 'Digital Culinary' -> ''
count6 = content.count(old5)
content = content.replace(old5, new4)
print(f'6. splashAkunSubtitle fallback (line 663): {count6}')

# 7. Line 2405: if (!this.siteName || this.siteName === 'Dapur Kuliner Viral') -> ''
old7 = "if (!this.siteName || this.siteName === 'Dapur Kuliner Viral') {"
new7 = "if (!this.siteName) {"
count7 = content.count(old7)
content = content.replace(old7, new7)
print(f'7. siteName check (line 2405): {count7}')

# 8. Line 2409: String(this.siteName || 'DAPUR KULINER VIRAL') -> this.siteName || ''
old8 = "String(this.siteName || 'DAPUR KULINER VIRAL')"
new8 = "String(this.siteName || '')"
count8 = content.count(old8)
content = content.replace(old8, new8)
print(f'8. siteName fallback (line 2409): {count8}')

# 9. Line 2572: sanitizeText(String(this.siteName || 'DAPUR KULINER VIRAL')) -> ''
old9 = "sanitizeText(String(this.siteName || 'DAPUR KULINER VIRAL'))"
new9 = "sanitizeText(String(this.siteName || ''))"
count9 = content.count(old9)
content = content.replace(old9, new9)
print(f'9. siteName fallback (line 2572): {count9}')

# 10. Line 2917: sanitizeText(String(this.siteName || 'DAPUR KULINER VIRAL')) -> ''
count10 = content.count(old9)
content = content.replace(old9, new9)
print(f'10. siteName fallback (line 2917): {count10}')

# 11. Line 2991: String(this.siteName || 'DAPUR KULINER VIRAL') -> ''
count11 = content.count(old8)
content = content.replace(old8, new8)
print(f'11. siteName fallback (line 2991): {count11}')

# 12. Line 3068: if (!this.siteName || this.siteName === 'Dapur Kuliner Viral') -> ''
count12 = content.count(old7)
content = content.replace(old7, new7)
print(f'12. siteName check (line 3068): {count12}')

with open(path, 'w') as f:
    f.write(content)

print('public/accounting-app.js: brand hardcodes replaced')
