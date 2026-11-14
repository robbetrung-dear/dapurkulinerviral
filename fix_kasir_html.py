import re

path = 'public/kasir.html'
with open(path, 'r') as f:
    content = f.read()

# 1. Line 324: x-text="customKasirSubtitle || 'Dapur Kuliner Viral'" -> ''
old1 = "x-text=\"customKasirSubtitle || 'Dapur Kuliner Viral'\""
new1 = "x-text=\"customKasirSubtitle || ''\""
count1 = content.count(old1)
content = content.replace(old1, new1)
print(f'1. kasir.html subtitle fallback: {count1}')

# 2. Line 3258: h4 with hardcoded DAPUR KULINER VIRAL -> dynamic x-text
old2 = '''<h4 class="font-extrabold text-stone-900 text-lg uppercase tracking-tight" x-text="(siteInfo && siteInfo.brandName ? siteInfo.brandName : (customKasirSubtitle || 'Dapur Kuliner Viral')).toUpperCase()">DAPUR KULINER VIRAL</h4>'''
new2 = '''<h4 class="font-extrabold text-stone-900 text-lg uppercase tracking-tight" x-text="(siteInfo && siteInfo.brandName ? siteInfo.brandName : (customKasirSubtitle || '')).toUpperCase()"></h4>'''
count2 = content.count(old2)
content = content.replace(old2, new2)
print(f'2. kasir.html h4 brand: {count2}')

# 3. Line 3912: x-text="paymentConfig.qrisMerchantName || 'Dapur Kuliner Viral'" -> ''
old3 = "x-text=\"paymentConfig.qrisMerchantName || 'Dapur Kuliner Viral'\""
new3 = "x-text=\"paymentConfig.qrisMerchantName || ''\""
count3 = content.count(old3)
content = content.replace(old3, new3)
print(f'3. qrisMerchantName fallback: {count3}')

# 4. Line 4342: h5 with hardcoded DAPUR KULINER VIRAL -> dynamic
old4 = '''<h5 class="font-black text-sm uppercase" x-text="(siteInfo && siteInfo.brandName ? siteInfo.brandName : 'Dapur Kuliner Viral').toUpperCase()">DAPUR KULINER VIRAL</h5>'''
new4 = '''<h5 class="font-black text-sm uppercase" x-text="(siteInfo && siteInfo.brandName ? siteInfo.brandName : '').toUpperCase()"></h5>'''
count4 = content.count(old4)
content = content.replace(old4, new4)
print(f'4. kasir.html h5 brand: {count4}')

# 5. Line 4407: x-text with hardcoded 'Dapur Kuliner Viral' -> ''
old5 = "x-text=\"'Terima kasih sudah berbelanja di ' + ((siteInfo && siteInfo.brandName) ? siteInfo.brandName : 'Dapur Kuliner Viral') + ' & selamat menikmati.'\""
new5 = "x-text=\"'Terima kasih sudah berbelanja di ' + ((siteInfo && siteInfo.brandName) ? siteInfo.brandName : '') + ' & selamat menikmati.'\""
count5 = content.count(old5)
content = content.replace(old5, new5)
print(f'5. kasir.html thank you message: {count5}')

with open(path, 'w') as f:
    f.write(content)

print('public/kasir.html: brand hardcodes replaced')
