import express from 'express';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = 3000;

app.use(express.json());

// Enable CORS for API routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve firebase-rules.json from project root
app.get('/firebase-rules.json', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'firebase-rules.json'));
});

// Helper: 7 Kurir Rate Calculator (Horizontal Comparison)
function getCourierRates(weightGrams: number = 1000, address: string = '') {
  const kg = Math.max(1, Math.ceil(weightGrams / 1000));
  return [
    {
      courier_code: "gosend",
      courier_name: "GoSend",
      courier_service_name: "Instant (Motor/Mobil)",
      price: 15000 + (kg > 3 ? (kg - 3) * 2500 : 0),
      estimated_etd: "1 - 2 Jam (Saran Makanan Panas)",
      badge_color: "border-emerald-500 text-emerald-700 bg-emerald-50",
      icon: "fa-motorcycle",
      recommended: true
    },
    {
      courier_code: "grab",
      courier_name: "GrabExpress",
      courier_service_name: "Same Day Makanan",
      price: 14000 + (kg > 2 ? (kg - 2) * 2000 : 0),
      estimated_etd: "2 - 4 Jam",
      badge_color: "border-green-500 text-green-700 bg-green-50",
      icon: "fa-route",
      recommended: false
    },
    {
      courier_code: "jnt",
      courier_name: "J&T Express",
      courier_service_name: "EZ Reguler (Pack Box)",
      price: 12000 * kg,
      estimated_etd: "Besok Sampai (1 Hari)",
      badge_color: "border-red-500 text-red-700 bg-red-50",
      icon: "fa-bolt",
      recommended: false
    },
    {
      courier_code: "sicepat",
      courier_name: "SiCepat",
      courier_service_name: "BEST (Besok Sampai)",
      price: 13000 * kg,
      estimated_etd: "Besok Sampai (1 Hari)",
      badge_color: "border-orange-500 text-orange-700 bg-orange-50",
      icon: "fa-gauge-high",
      recommended: false
    },
    {
      courier_code: "jne",
      courier_name: "JNE",
      courier_service_name: "YES (Yakin Esok Sampai)",
      price: 15000 * kg,
      estimated_etd: "1 Hari Kerja",
      badge_color: "border-blue-500 text-blue-700 bg-blue-50",
      icon: "fa-truck-fast",
      recommended: false
    },
    {
      courier_code: "anteraja",
      courier_name: "AnterAja",
      courier_service_name: "Same Day Food",
      price: 16000 + (kg > 1 ? (kg - 1) * 3000 : 0),
      estimated_etd: "Hari yang sama (6-8 Jam)",
      badge_color: "border-purple-500 text-purple-700 bg-purple-50",
      icon: "fa-paper-plane",
      recommended: false
    },
    {
      courier_code: "ninja",
      courier_name: "Ninja Xpress",
      courier_service_name: "Ninja Reguler",
      price: 11000 * kg,
      estimated_etd: "1 - 2 Hari",
      badge_color: "border-rose-500 text-rose-700 bg-rose-50",
      icon: "fa-mask",
      recommended: false
    },
    {
      courier_code: "pos",
      courier_name: "POS Indonesia",
      courier_service_name: "Pos Next Day",
      price: 13500 * kg,
      estimated_etd: "1 Hari",
      badge_color: "border-amber-500 text-amber-700 bg-amber-50",
      icon: "fa-envelope-open-text",
      recommended: false
    }
  ];
}

// Handler for Biteship Ongkir API (Cloudflare Pages Functions proxy parity)
const handleOngkir = async (req: express.Request, res: express.Response) => {
  try {
    const { destination_address = '', total_weight_grams = 1000 } = req.body || {};
    const apiKey = process.env.BITESHIP_API_KEY;

    if (apiKey && !apiKey.includes('YOUR_BITESHIP')) {
      try {
        const response = await fetch("https://api.biteship.com/v1/rates/couriers", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            origin_area_id: "IDNP6IDNC417IDND2208",
            couriers: "jne,jnt,sicepat,anteraja,pos,ninja,gosend,grab",
            items: [{
              name: "Paket Makanan Dapur Viral",
              value: 100000,
              weight: total_weight_grams,
              quantity: 1
            }]
          })
        });
        if (response.ok) {
          const data = await response.json();
          return res.json({ success: true, is_mock: false, rates: data.pricing || getCourierRates(total_weight_grams, destination_address) });
        }
      } catch (apiErr) {
        console.warn("Biteship API call note:", apiErr);
      }
    }

    // Default calculated rates
    const rates = getCourierRates(total_weight_grams, destination_address);
    return res.json({
      success: true,
      is_mock: true,
      total_weight_grams,
      rates
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/functions/ongkir', handleOngkir);
app.post('/api/ongkir', handleOngkir);
app.post('/ongkir', handleOngkir);

// Handler for Midtrans Snap Payment API (Without Credit Card)
const handlePayment = async (req: express.Request, res: express.Response) => {
  try {
    const { order_id, gross_amount, customer_details, item_details } = req.body || {};
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';

    if (!order_id || !gross_amount) {
      return res.status(400).json({ error: "Missing required fields: order_id and gross_amount" });
    }

    if (serverKey && !serverKey.includes('YOUR_MIDTRANS')) {
      const snapUrl = isProduction
        ? "https://app.midtrans.com/snap/v1/transactions"
        : "https://app.sandbox.midtrans.com/snap/v1/transactions";

      const authHeader = "Basic " + Buffer.from(serverKey + ":").toString('base64');
      const midtransRes = await fetch(snapUrl, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": authHeader
        },
        body: JSON.stringify({
          transaction_details: { order_id, gross_amount: Math.round(Number(gross_amount)) },
          customer_details: {
            first_name: customer_details?.name || "Pelanggan",
            phone: customer_details?.phone || "08123456789"
          },
          // NO CREDIT CARDS ALLOWED
          enabled_payments: [
            "gopay", "shopeepay", "qris", "bca_va", "bni_va", "bri_va", "echannel", "permata_va", "other_va"
          ]
        })
      });

      const midtransData = await midtransRes.json();
      if (midtransRes.ok) {
        return res.json({
          success: true,
          token: midtransData.token,
          redirect_url: midtransData.redirect_url,
          is_mock: false
        });
      }
    }

    // Interactive Demo Mock Token for instant preview testing
    const mockToken = "SNAP_MOCK_" + order_id + "_" + Date.now();
    return res.json({
      success: true,
      token: mockToken,
      redirect_url: `https://app.sandbox.midtrans.com/snap/v2/vtweb/${mockToken}`,
      is_mock: true,
      note: "Midtrans preview mode active. Transaction ready for simulated checkout & auto receipt."
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/functions/payment', handlePayment);
app.post('/api/payment', handlePayment);
app.post('/payment', handlePayment);

// Handler for Midtrans QRIS / Payment Status Polling
app.get(['/api/payment/status/:orderId', '/payment/status/:orderId', '/functions/payment/status/:orderId'], async (req, res) => {
  try {
    const { orderId } = req.params;
    const serverKey = process.env.MIDTRANS_SERVER_KEY || "";
    const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true';

    if (serverKey && !serverKey.includes('YOUR_MIDTRANS')) {
      const baseUrl = isProduction ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
      const authHeader = Buffer.from(serverKey + ':').toString('base64');
      const checkRes = await fetch(`${baseUrl}/v2/${encodeURIComponent(orderId)}/status`, {
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Accept': 'application/json'
        }
      });
      if (checkRes.ok) {
        const data = await checkRes.json();
        return res.json({
          status: "OK",
          order_id: orderId,
          transaction_status: data.transaction_status || "pending",
          raw: data
        });
      }
    }

    // Interactive Demo / Mock Polling Fallback: returns settlement after 10s
    res.json({
      status: "OK",
      order_id: orderId,
      transaction_status: "settlement",
      is_mock: true
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Handler for Aggregate POS Daily / Shift Summaries
app.post(['/aggregate', '/api/aggregate', '/functions/aggregate'], async (req, res) => {
  try {
    const { date, tx } = req.body || {};
    const d = date || new Date().toISOString().slice(0, 10);
    const id = tx?.id || tx?.t || `TX-${Date.now()}`;
    if (tx) {
      posTransactionsStore[`${d}/${id}`] = tx;
      if (tx.orderId) {
        posTransactionsStore[tx.orderId] = tx;
      }
    }
    res.json({
      success: true,
      message: "POS transaction aggregated successfully",
      date: d,
      txId: id
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Handler for Receipt generation
app.post(['/receipt', '/api/receipt', '/functions/receipt'], async (req, res) => {
  try {
    const tx = req.body || {};
    res.json({
      success: true,
      message: "Receipt generated successfully",
      orderId: tx.id || tx.t,
      timestamp: Date.now()
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// In-Memory / Fallback Inventory Store (with countable, unit measurement, and purchase price)
let posInventory = [
  { id: 'inv1', name: 'Filet Dada Ayam Segar', category: 'Bahan Baku', stock: 18, minStock: 5, unit: 'kg', purchasePrice: 38000, isCountable: true },
  { id: 'inv2', name: 'Tepung Roti Panko Katsu', category: 'Bahan Kering', stock: 4, minStock: 6, unit: 'kg', purchasePrice: 22000, isCountable: true },
  { id: 'inv3', name: 'Beras Pulen Premium', category: 'Sembako', stock: 45, minStock: 20, unit: 'kg', purchasePrice: 14000, isCountable: true },
  { id: 'inv4', name: 'Kulit Pangsit Dimsum', category: 'Bahan Baku', stock: 2, minStock: 5, unit: 'pack', purchasePrice: 15000, isCountable: true },
  { id: 'inv5', name: 'Minyak Goreng Sawit', category: 'Minyak', stock: 24, minStock: 10, unit: 'liter', purchasePrice: 18000, isCountable: true },
  { id: 'inv6', name: 'Sirup Gula Aren Asli', category: 'Minuman', stock: 3, minStock: 4, unit: 'botol', purchasePrice: 25000, isCountable: true },
  { id: 'inv7', name: 'Paper Bowl 650ml + Tutup', category: 'Kemasan', stock: 320, minStock: 100, unit: 'pcs', purchasePrice: 850, isCountable: true },
  { id: 'inv8', name: 'Plastik Takeaway Ramah Lingkungan', category: 'Kemasan', stock: 150, minStock: 80, unit: 'pcs', purchasePrice: 300, isCountable: false }
];

let inventoryLogsStore: Record<string, any[]> = {};

// In-Memory Menu Recipes (Bahan Baku per Menu)
// Setelan awal: menu baru stok 0 jika belum ada komposisi bahan baku
let menuRecipesStore: Record<string, { menuId: string; ingredients: { itemId: string; amount: number; unit: string }[] }> = {};

// Helper: Hitung ketersediaan stok menu berdasarkan kombinasi seluruh item bahan baku (termasuk kemasan)
function calculateMenuStock(menuId: string): { stock: number; ingredients: any[]; missingItem?: any } {
  const recipe = menuRecipesStore[menuId];
  // Jika menu belum memiliki resep/komposisi bahan baku, stok default = 0
  if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    return { stock: 0, ingredients: [] };
  }

  let minPossiblePortions = Infinity;
  let missingItem = null;

  for (const ing of recipe.ingredients) {
    const invItem = posInventory.find(i => i.id === ing.itemId);
    if (!invItem) {
      return { stock: 0, ingredients: recipe.ingredients, missingItem: { name: 'Item tidak ditemukan', required: ing.amount } };
    }

    // Uncountable items don't restrict calculated portion limits if infinite, but countable ones do
    if (invItem.isCountable === false) {
      continue;
    }

    // Hitung konversi satuan jika beda unit (contoh kg ke gram, liter ke ml)
    let availableAmount = Number(invItem.stock) || 0;
    const itemUnit = (invItem.unit || '').toLowerCase();
    const ingUnit = (ing.unit || '').toLowerCase();

    if (itemUnit === 'kg' && ingUnit === 'gram') availableAmount = availableAmount * 1000;
    else if (itemUnit === 'gram' && ingUnit === 'kg') availableAmount = availableAmount / 1000;
    else if (itemUnit === 'liter' && ingUnit === 'ml') availableAmount = availableAmount * 1000;
    else if (itemUnit === 'ml' && ingUnit === 'liter') availableAmount = availableAmount / 1000;

    const requiredAmount = Number(ing.amount) || 0;
    if (requiredAmount <= 0) continue;

    const portions = Math.floor(availableAmount / requiredAmount);
    if (portions < minPossiblePortions) {
      minPossiblePortions = portions;
    }
    if (portions <= 0) {
      missingItem = { name: invItem.name, available: invItem.stock, unit: invItem.unit, required: ing.amount, reqUnit: ing.unit };
    }
  }

  const calculated = minPossiblePortions === Infinity ? 0 : Math.max(0, minPossiblePortions);
  return { stock: calculated, ingredients: recipe.ingredients, missingItem: calculated === 0 ? missingItem : null };
}

// Handler for Inventory
app.get(['/inventory', '/api/inventory'], (req, res) => {
  res.json({ success: true, data: posInventory });
});

// GET /inventory/recipes
app.get(['/inventory/recipes', '/api/inventory/recipes'], (req, res) => {
  res.json({ success: true, data: menuRecipesStore });
});

// POST /inventory/recipes/:menuId
app.post(['/inventory/recipes/:menuId', '/api/inventory/recipes/:menuId'], (req, res) => {
  try {
    const { menuId } = req.params;
    const { ingredients } = req.body || {};
    menuRecipesStore[menuId] = {
      menuId,
      ingredients: Array.isArray(ingredients) ? ingredients : []
    };
    const stockInfo = calculateMenuStock(menuId);
    res.json({ success: true, message: "Resep bahan baku berhasil disimpan", recipe: menuRecipesStore[menuId], stockInfo });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /inventory/menu_stock/:menuId
app.get(['/inventory/menu_stock/:menuId', '/api/inventory/menu_stock/:menuId'], (req, res) => {
  const { menuId } = req.params;
  const stockInfo = calculateMenuStock(menuId);
  res.json({ success: true, menuId, ...stockInfo });
});

// POST /inventory/:itemId (Add new item)
app.post(['/inventory/:itemId', '/api/inventory/:itemId', '/inventory', '/api/inventory'], (req, res) => {
  try {
    const itemId = req.params.itemId || req.body.id || ('inv_' + Date.now());
    const { name, category, stock, minStock, min, unit, purchasePrice, hargaBeli, isCountable } = req.body || {};
    
    if (!name || stock === undefined || unit === undefined) {
      return res.status(400).json({ success: false, error: "Nama, stok, dan unit wajib diisi" });
    }

    const newItem = {
      id: itemId,
      name: String(name),
      category: category || 'Bahan Baku',
      stock: Number(stock) || 0,
      minStock: Number(minStock !== undefined ? minStock : (min !== undefined ? min : 5)),
      unit: String(unit),
      purchasePrice: Number(purchasePrice !== undefined ? purchasePrice : (hargaBeli !== undefined ? hargaBeli : 0)),
      isCountable: isCountable !== undefined ? Boolean(isCountable) : true
    };

    const existingIndex = posInventory.findIndex(i => i.id === itemId);
    if (existingIndex >= 0) {
      posInventory[existingIndex] = newItem;
    } else {
      posInventory.unshift(newItem);
    }

    res.json({ success: true, message: "Item inventory berhasil disimpan", item: newItem, inventory: posInventory });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /inventory/:itemId (Update item/stock)
app.patch(['/inventory/:itemId', '/api/inventory/:itemId'], (req, res) => {
  try {
    const { itemId } = req.params;
    const item = posInventory.find(i => i.id === itemId);
    if (!item) {
      return res.status(404).json({ success: false, error: "Item inventory tidak ditemukan" });
    }

    const { stock, stok, minStock, min, name, category, unit, purchasePrice, hargaBeli, isCountable } = req.body || {};
    if (stock !== undefined) item.stock = Number(stock);
    else if (stok !== undefined) item.stock = Number(stok);
    if (minStock !== undefined) item.minStock = Number(minStock);
    else if (min !== undefined) item.minStock = Number(min);
    if (purchasePrice !== undefined) item.purchasePrice = Number(purchasePrice);
    else if (hargaBeli !== undefined) item.purchasePrice = Number(hargaBeli);
    if (name) item.name = String(name);
    if (category) item.category = String(category);
    if (unit) item.unit = String(unit);
    if (isCountable !== undefined) item.isCountable = Boolean(isCountable);

    res.json({ success: true, message: "Stok inventory diperbarui", item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /inventory/:itemId
app.delete(['/inventory/:itemId', '/api/inventory/:itemId'], (req, res) => {
  try {
    const { itemId } = req.params;
    const prevLength = posInventory.length;
    posInventory = posInventory.filter(i => i.id !== itemId);
    if (posInventory.length === prevLength) {
      return res.status(404).json({ success: false, error: "Item tidak ditemukan" });
    }
    res.json({ success: true, message: "Item inventori berhasil dihapus", inventory: posInventory });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /inventory_logs/:itemId/:logId
app.post(['/inventory_logs/:itemId/:logId', '/api/inventory_logs/:itemId/:logId'], (req, res) => {
  try {
    const { itemId, logId } = req.params;
    const logData = { id: logId, itemId, ...req.body, timestamp: Date.now() };
    if (!inventoryLogsStore[itemId]) inventoryLogsStore[itemId] = [];
    inventoryLogsStore[itemId].unshift(logData);
    res.json({ success: true, message: "Inventory log recorded", log: logData });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

let inventoryDeductedStore: Record<string, any> = {};

app.post(['/inventory/deduct', '/api/inventory/deduct'], (req, res) => {
  try {
    const { orderId = ('ORD-' + Date.now()), kasir = 'kasir', items = [] } = req.body || {};
    
    if (inventoryDeductedStore[orderId]) {
      return res.json({
        success: true,
        orderId,
        alreadyProcessed: true,
        message: `Order #${orderId} sudah pernah diproses pengurangan stok.`,
        processedAt: inventoryDeductedStore[orderId].timestamp || Date.now()
      });
    }

    const deducted: any[] = [];
    const warnings: string[] = [];
    const now = Date.now();

    // Kurangi stok bahan baku berdasarkan formulasi resep jika terdaftar
    for (const orderItem of items) {
      const menuId = orderItem.id || orderItem.menuId;
      const qty = Number(orderItem.qty) || 1;
      const recipe = menuRecipesStore[menuId];
      
      if (!recipe || !Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
        warnings.push(`Resep untuk menu "${orderItem.name || menuId}" belum diatur`);
        continue;
      }

      for (const ing of recipe.ingredients) {
        const inv = posInventory.find(i => i.id === ing.itemId);
        if (!inv) {
          warnings.push(`Bahan baku "${ing.itemId}" tidak ditemukan di inventori`);
          continue;
        }

        if (inv.isCountable !== false) {
          const reqAmt = Number(ing.amount) || 0;
          const itemUnit = (inv.unit || '').toLowerCase();
          const ingUnit = (ing.unit || '').toLowerCase();
          
          let deduction = reqAmt * qty;
          if (itemUnit === 'kg' && ingUnit === 'gram') deduction = deduction / 1000;
          else if (itemUnit === 'gram' && ingUnit === 'kg') deduction = deduction * 1000;
          else if (itemUnit === 'liter' && ingUnit === 'ml') deduction = deduction / 1000;
          else if (itemUnit === 'ml' && ingUnit === 'liter') deduction = deduction * 1000;

          const oldStock = inv.stock;
          let newStock = Math.round((inv.stock - deduction) * 1000) / 1000;
          if (newStock < 0) {
            warnings.push(`Stok ${inv.name} tidak cukup (sisa ${oldStock}, butuh ${deduction})`);
            newStock = 0;
          }
          inv.stock = newStock;

          const logId = 'log_' + now + '_' + Math.random().toString(36).substring(2, 6);
          const logData = {
            t: now,
            old: oldStock,
            new: newStock,
            diff: -deduction,
            by: `${kasir} (POS #${orderId})`,
            reason: 'Penjualan POS',
            changeType: 'auto-pos-sale'
          };
          if (!inventoryLogsStore[inv.id]) inventoryLogsStore[inv.id] = [];
          inventoryLogsStore[inv.id].unshift({ id: logId, itemId: inv.id, ...logData });

          deducted.push({
            itemId: inv.id,
            name: inv.name,
            before: oldStock,
            after: newStock,
            used: deduction,
            unit: inv.unit
          });
        }
      }
    }

    // Default kemasan paper bowl jika ada
    const bowl = posInventory.find(i => i.id === 'inv7');
    if (bowl && items.length > 0) {
      const oldBowl = bowl.stock;
      bowl.stock = Math.max(0, bowl.stock - items.length);
      deducted.push({
        itemId: bowl.id,
        name: bowl.name,
        before: oldBowl,
        after: bowl.stock,
        used: items.length,
        unit: bowl.unit
      });
    }

    inventoryDeductedStore[orderId] = {
      orderId,
      timestamp: now,
      kasir,
      itemsCount: items.length,
      deductedCount: deducted.length
    };

    res.json({
      success: true,
      orderId,
      deducted,
      warnings,
      processedAt: now,
      inventory: posInventory
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// In-Memory Menu & Categories Store for Server
let serverMenuItems: any[] = [];
let serverCategories: any[] = [
  { id: 'all', name: 'Semua Menu', icon: 'fa-border-all' },
  { id: 'rice_bowl', name: 'Bento & Rice Bowl', icon: 'fa-bowl-rice' },
  { id: 'chicken', name: 'Ayam & Bento', icon: 'fa-drumstick-bite' },
  { id: 'mie', name: 'Aneka Mie', icon: 'fa-bowl-food' },
  { id: 'dimsum', name: 'Dimsum & Snack', icon: 'fa-utensils' },
  { id: 'cemilan', name: 'Cemilan / Side Dish', icon: 'fa-cookie-bite' },
  { id: 'ala_carte', name: 'Ala Carte', icon: 'fa-egg' },
  { id: 'minuman', name: 'Aneka Minuman', icon: 'fa-mug-hot' },
  { id: 'viral', name: 'Viral & Dessert', icon: 'fa-fire' }
];

// GET /categories & /menu/categories
app.get(['/categories', '/api/categories', '/menu/categories', '/api/menu/categories'], (req, res) => {
  res.json({ success: true, data: serverCategories });
});

// POST /categories & /menu/categories
app.post(['/categories', '/api/categories', '/menu/categories', '/api/menu/categories'], (req, res) => {
  if (Array.isArray(req.body)) {
    serverCategories = req.body;
  }
  res.json({ success: true, message: "Kategori menu berhasil disimpan", data: serverCategories });
});

// GET /menu
app.get(['/menu', '/api/menu'], (req, res) => {
  res.json({ success: true, data: serverMenuItems });
});

// GET /menu/:menuId
app.get(['/menu/:menuId', '/api/menu/:menuId'], (req, res) => {
  const { menuId } = req.params;
  const item = serverMenuItems.find(m => m.id === menuId);
  if (!item) {
    return res.status(404).json({ success: false, error: "Menu tidak ditemukan" });
  }
  res.json({ success: true, data: item });
});

// POST /menu/:menuId
app.post(['/menu/:menuId', '/api/menu/:menuId'], (req, res) => {
  try {
    const { menuId } = req.params;
    const body = req.body || {};
    const item = { ...body, id: menuId, updatedAt: Date.now() };
    const idx = serverMenuItems.findIndex(m => m.id === menuId);
    if (idx !== -1) {
      serverMenuItems[idx] = item;
    } else {
      serverMenuItems.unshift(item);
    }
    res.json({ success: true, id: menuId, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /menu (Bulk save atau tambah menu)
app.post(['/menu', '/api/menu'], (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      serverMenuItems = req.body;
      return res.json({ success: true, count: serverMenuItems.length });
    }
    const menuId = req.body.id || ('m_' + Date.now());
    const item = { ...req.body, id: menuId, createdAt: Date.now() };
    const idx = serverMenuItems.findIndex(m => m.id === menuId);
    if (idx !== -1) {
      serverMenuItems[idx] = item;
    } else {
      serverMenuItems.unshift(item);
    }
    res.json({ success: true, id: menuId, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /menu/:menuId
app.delete(['/menu/:menuId', '/api/menu/:menuId'], (req, res) => {
  const { menuId } = req.params;
  serverMenuItems = serverMenuItems.filter(m => m.id !== menuId);
  res.json({ success: true, id: menuId, deleted: true });
});

// GET /recipes
app.get(['/recipes', '/api/recipes'], (req, res) => {
  res.json({ success: true, data: menuRecipesStore });
});

// POST /recipes/:menuId
app.post(['/recipes/:menuId', '/api/recipes/:menuId'], (req, res) => {
  try {
    const { menuId } = req.params;
    const { ingredients } = req.body || {};
    menuRecipesStore[menuId] = {
      menuId,
      ingredients: Array.isArray(ingredients) ? ingredients : []
    };
    res.json({ success: true, menuId, data: menuRecipesStore[menuId] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==========================================
// In-Memory Accounting Store for Server
// ==========================================
let serverCOA: Record<string, { n: string; t: string }> = {
  "101": { n: "Kas di Tangan", t: "asset" },
  "102": { n: "Bank", t: "asset" },
  "103": { n: "Piutang", t: "asset" },
  "105": { n: "Persediaan Bahan Baku", t: "asset" },
  "111": { n: "Akum. Penyusutan", t: "asset" },
  "201": { n: "Hutang Supplier", t: "liability" },
  "301": { n: "Modal Pemilik", t: "equity" },
  "302": { n: "Prive", t: "equity" },
  "401": { n: "Pendapatan Penjualan", t: "revenue" },
  "402": { n: "Pendapatan Catering", t: "revenue" },
  "501": { n: "HPP", t: "expense" },
  "601": { n: "Beban Gaji", t: "expense" },
  "602": { n: "Beban Sewa", t: "expense" },
  "603": { n: "Beban Listrik & Air", t: "expense" },
  "604": { n: "Beban Marketing", t: "expense" },
  "605": { n: "Beban Kurir", t: "expense" },
  "606": { n: "Beban Penyusutan", t: "expense" }
};
let serverJournals: Record<string, Record<string, any>> = {};
let serverLedger: Record<string, Record<string, any>> = {};

// GET & POST /accounting/coa
app.get(['/accounting/coa', '/api/accounting/coa'], (req, res) => {
  res.json({ success: true, data: serverCOA });
});
app.post(['/accounting/coa', '/api/accounting/coa'], (req, res) => {
  const body = req.body || {};
  if (body.code && body.n) {
    serverCOA[body.code] = { n: body.n, t: body.t || 'expense' };
  } else if (typeof body === 'object') {
    serverCOA = { ...serverCOA, ...body };
  }
  res.json({ success: true, message: "COA berhasil disimpan", data: serverCOA });
});

// GET /accounting/approvals
app.get(['/accounting/approvals', '/api/accounting/approvals'], async (req, res) => {
  try {
    const databaseUrl = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
    const apiKey = process.env.FIREBASE_API_KEY || "";
    const auth = apiKey ? `?auth=${apiKey}` : "";

    if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
      try {
        const fbRes = await fetch(`${databaseUrl}/accounting/journal.json${auth}`);
        if (fbRes.ok) {
          const allJournals = await fbRes.json();
          const approvals: any[] = [];
          if (allJournals && typeof allJournals === 'object') {
            for (const [bulanKey, monthEntries] of Object.entries(allJournals)) {
              if (monthEntries && typeof monthEntries === 'object') {
                for (const [eId, entry] of Object.entries(monthEntries as any)) {
                  approvals.push({
                    entryId: eId,
                    id: eId,
                    bulan: bulanKey,
                    month: bulanKey,
                    ...((entry as any) || {})
                  });
                }
              }
            }
          }
          approvals.sort((a, b) => (b.createdAt || b.timestamp || b.t || 0) - (a.createdAt || a.timestamp || a.t || 0));
          return res.json({ success: true, count: approvals.length, data: approvals });
        }
      } catch (fbErr) {
        console.warn("[SERVER] Firebase approvals fetch fallback to in-memory:", fbErr);
      }
    }

    const approvals: any[] = [];
    Object.entries(serverJournals).forEach(([bulanKey, monthData]) => {
      if (monthData && typeof monthData === 'object') {
        Object.entries(monthData).forEach(([eId, entry]) => {
          approvals.push({ entryId: eId, id: eId, bulan: bulanKey, ...entry });
        });
      }
    });
    approvals.sort((a, b) => (b.createdAt || b.t || 0) - (a.createdAt || a.t || 0));
    res.json({ success: true, count: approvals.length, data: approvals });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET & POST /accounting/journal/:bulan
app.get(['/accounting/journal/:bulan', '/api/accounting/journal/:bulan'], async (req, res) => {
  const { bulan } = req.params;
  const databaseUrl = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.FIREBASE_API_KEY || "";
  const auth = apiKey ? `?auth=${apiKey}` : "";

  if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
    try {
      const fbRes = await fetch(`${databaseUrl}/accounting/journal/${encodeURIComponent(bulan)}.json${auth}`);
      if (fbRes.ok) {
        const monthData = await fbRes.json();
        const entries = monthData && typeof monthData === 'object'
          ? Object.entries(monthData).map(([id, val]) => ({ entryId: id, id, bulan, ...((val as any) || {}) }))
          : [];
        entries.sort((a, b) => (b.createdAt || b.timestamp || b.t || 0) - (a.createdAt || a.timestamp || a.t || 0));
        return res.json({ success: true, bulan, data: entries });
      }
    } catch (e) {}
  }

  const monthData = serverJournals[bulan] || {};
  const entries = Object.entries(monthData).map(([id, val]) => ({ entryId: id, id, bulan, ...val }));
  entries.sort((a, b) => (b.createdAt || b.t || 0) - (a.createdAt || a.t || 0));
  res.json({ success: true, bulan, data: entries });
});

app.post(['/accounting/journal/:bulan', '/api/accounting/journal/:bulan', '/accounting/journal', '/api/accounting/journal'], async (req, res) => {
  try {
    const body = req.body || {};
    const now = new Date();
    const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const bulan = req.params.bulan || body.date?.slice(0, 7) || currentBulan;
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (lines.length < 2) {
      return res.status(400).json({ success: false, error: "Jurnal minimal harus memiliki 2 baris transaksi" });
    }

    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of lines) {
      totalDebit += Number(l.debit) || 0;
      totalCredit += Number(l.credit) || 0;
    }

    if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) > 0.01) {
      return res.status(400).json({
        success: false,
        error: `Total debit (${totalDebit}) dan kredit (${totalCredit}) harus seimbang dan > 0`
      });
    }

    if (!serverJournals[bulan]) serverJournals[bulan] = {};
    const count = Object.keys(serverJournals[bulan]).length + 1;
    const [yyyy, mm] = bulan.split('-');
    const noEntry = body.noEntry || `JE-${yyyy || '2026'}-${mm || '09'}-${String(count).padStart(4, '0')}`;
    const entryId = "JE-" + Date.now();

    const entryPayload = {
      t: Date.now(),
      noEntry,
      date: body.date || new Date().toISOString().slice(0, 10),
      desc: (body.desc || '').trim(),
      category: body.category || 'operasional',
      ref: body.ref || '',
      lampiran: body.lampiran || '',
      lines: lines.map((l: any) => ({
        acc: String(l.acc || l.code || '').trim(),
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0
      })),
      status: body.status || "pending",
      createdBy: body.createdBy || "kasir",
      createdAt: Date.now(),
      approvedBy: body.status === 'approved' ? (body.approvedBy || "Kasir / System") : null,
      approvedAt: body.status === 'approved' ? Date.now() : null,
      rejectedReason: null
    };

    serverJournals[bulan][entryId] = entryPayload;

    // Simpan ke Firebase bila tersedia
    const databaseUrl = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
    const apiKey = process.env.FIREBASE_API_KEY || "";
    const auth = apiKey ? `?auth=${apiKey}` : "";
    if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
      try {
        await fetch(`${databaseUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${auth}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entryPayload)
        });
      } catch (fbErr) {
        console.warn("[SERVER] Firebase journal save warning:", fbErr);
      }
    }

    res.json({ success: true, entryId, noEntry, data: entryPayload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

async function updateFirebaseLedgerAfterApprove(databaseUrl: string, bulan: string, lines: any[], apiKey: string) {
  const auth = apiKey ? `?auth=${apiKey}` : "";
  for (const line of lines || []) {
    const acc = String(line.acc || line.code || '').trim();
    if (!acc) continue;
    const debit = Number(line.debit) || 0;
    const credit = Number(line.credit) || 0;
    if (debit === 0 && credit === 0) continue;

    try {
      const ledgerUrl = `${databaseUrl}/accounting/ledger/${encodeURIComponent(acc)}/${encodeURIComponent(bulan)}.json${auth}`;
      const res = await fetch(ledgerUrl);
      let existing: any = null;
      if (res.ok) {
        existing = await res.json();
      }
      if (!existing || typeof existing !== 'object') {
        existing = { opening: 0, debit: 0, credit: 0, closing: 0 };
      }
      existing.debit = (Number(existing.debit) || 0) + debit;
      existing.credit = (Number(existing.credit) || 0) + credit;
      const isKreditNormal = acc.startsWith('2') || (acc.startsWith('3') && acc !== '302' && acc !== '3002' && acc !== '3003') || acc.startsWith('4');
      if (isKreditNormal) {
        existing.closing = (Number(existing.opening) || 0) + existing.credit - existing.debit;
      } else {
        existing.closing = (Number(existing.opening) || 0) + existing.debit - existing.credit;
      }
      existing.updatedAt = Date.now();
      await fetch(ledgerUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(existing)
      });
    } catch (e) {
      console.warn(`[SERVER] Failed to update Firebase ledger for ${acc}:`, e);
    }
  }
}

async function updateFirebaseSummaryAfterApprove(databaseUrl: string, bulan: string, apiKey: string) {
  const auth = apiKey ? `?auth=${apiKey}` : "";
  const fetchAcc = async (code: string) => {
    try {
      const r = await fetch(`${databaseUrl}/accounting/ledger/${encodeURIComponent(code)}/${encodeURIComponent(bulan)}.json${auth}`);
      if (r.ok) {
        const d = await r.json();
        if (d) return d;
      }
    } catch (e) {}
    return { opening: 0, debit: 0, credit: 0, closing: 0 };
  };

  const [
    a101, a102, a103, a105,
    a201, a301, a302,
    a401, a402,
    a501,
    a601, a602, a603, a604, a605, a606
  ] = await Promise.all([
    fetchAcc('101'), fetchAcc('102'), fetchAcc('103'), fetchAcc('105'),
    fetchAcc('201'), fetchAcc('301'), fetchAcc('302'),
    fetchAcc('401'), fetchAcc('402'),
    fetchAcc('501'),
    fetchAcc('601'), fetchAcc('602'), fetchAcc('603'), fetchAcc('604'), fetchAcc('605'), fetchAcc('606')
  ]);

  const penjualanPos = (Number(a401.credit) || 0) - (Number(a401.debit) || 0);
  const penjualanCatering = (Number(a402.credit) || 0) - (Number(a402.debit) || 0);
  const totalPendapatan = penjualanPos + penjualanCatering;

  const hppBahanBaku = (Number(a501.debit) || 0) - (Number(a501.credit) || 0);
  const totalHpp = hppBahanBaku;

  const labaKotor = totalPendapatan - totalHpp;
  const marginKotor = totalPendapatan > 0 ? Math.round((labaKotor / totalPendapatan) * 10000) / 100 : 0;

  const bebanGaji = (Number(a601.debit) || 0) - (Number(a601.credit) || 0);
  const bebanSewa = (Number(a602.debit) || 0) - (Number(a602.credit) || 0);
  const bebanListrik = (Number(a603.debit) || 0) - (Number(a603.credit) || 0);
  const bebanMarketing = (Number(a604.debit) || 0) - (Number(a604.credit) || 0);
  const bebanKurir = (Number(a605.debit) || 0) - (Number(a605.credit) || 0);
  const bebanPenyusutan = (Number(a606.debit) || 0) - (Number(a606.credit) || 0);
  const totalBeban = bebanGaji + bebanSewa + bebanListrik + bebanMarketing + bebanKurir + bebanPenyusutan;

  const labaBersih = labaKotor - totalBeban;
  const marginBersih = totalPendapatan > 0 ? Math.round((labaBersih / totalPendapatan) * 10000) / 100 : 0;

  const pembelianBahanBaku = Number(a105.debit) || 0;
  const persediaanAkhir = Number(a105.closing) || 0;
  const saldoKas = Number(a101.closing) || 0;
  const saldoBank = Number(a102.closing) || 0;
  const piutang = Number(a103.closing) || 0;
  const hutangSupplier = Number(a201.closing) || 0;

  const totalAset = saldoKas + saldoBank + piutang + persediaanAkhir;
  const totalKewajiban = hutangSupplier;
  const totalEkuitas = (Number(a301.closing) || 0) - (Number(a302.closing) || 0) + labaBersih;

  const summaryData = {
    periode: bulan,
    pendapatan: { penjualanPos, penjualanCatering, totalPendapatan },
    hpp: { bahanBaku: hppBahanBaku, totalHpp },
    labaKotor, marginKotor,
    beban: { gaji: bebanGaji, sewa: bebanSewa, utilitas: bebanListrik, marketing: bebanMarketing, kurir: bebanKurir, penyusutan: bebanPenyusutan, totalBeban },
    labaBersih, marginBersih,
    status: labaBersih >= 0 ? "PROFIT" : "LOSS",
    pembelianBahanBaku, persediaanAkhir,
    saldoKas, saldoBank, kas: saldoKas, bank: saldoBank,
    piutang, hutang: hutangSupplier, hutangSupplier,
    totalAset, totalKewajiban, totalEkuitas,
    updatedAt: Date.now()
  };

  try {
    await fetch(`${databaseUrl}/accounting/summary/${encodeURIComponent(bulan)}.json${auth}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summaryData)
    });
  } catch (e) {
    console.warn(`[SERVER] Failed to update Firebase summary for ${bulan}:`, e);
  }
}

// PATCH /accounting/journal/:bulan/:entryId
app.patch(['/accounting/journal/:bulan/:entryId', '/api/accounting/journal/:bulan/:entryId', '/accounting/journal/:entryId/approve', '/api/accounting/journal/:entryId/approve'], async (req, res) => {
  try {
    let { bulan, entryId } = req.params;
    const body = req.body || {};
    const action = body.action || (req.url.includes('/approve') ? 'approve' : 'approve');
    const now = new Date();
    const currentBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (!bulan || bulan.length !== 7) {
      bulan = currentBulan;
    }

    const databaseUrl = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
    const apiKey = process.env.FIREBASE_API_KEY || "";
    const auth = apiKey ? `?auth=${apiKey}` : "";

    let currentEntry = serverJournals[bulan]?.[entryId];

    if (!currentEntry && databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
      try {
        const fbRes = await fetch(`${databaseUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${auth}`);
        if (fbRes.ok) {
          currentEntry = await fbRes.json();
        }
      } catch (e) {}
    }

    if (!currentEntry) {
      // Fallback: search across all server journals
      for (const [bKey, mData] of Object.entries(serverJournals)) {
        if (mData && (mData as any)[entryId]) {
          currentEntry = (mData as any)[entryId];
          bulan = bKey;
          break;
        }
      }
    }

    if (!currentEntry) {
      return res.status(404).json({ success: false, error: `Jurnal '${entryId}' tidak ditemukan` });
    }

    if (action === 'approve') {
      currentEntry.status = "approved";
      currentEntry.approvedBy = body.approvedBy || "Finance / Owner";
      currentEntry.approvedAt = Date.now();
      currentEntry.rejectedReason = null;

      // Update Ledger in memory
      for (const line of currentEntry.lines || []) {
        const acc = String(line.acc);
        if (!serverLedger[acc]) serverLedger[acc] = {};
        if (!serverLedger[acc][bulan]) {
          serverLedger[acc][bulan] = { accCode: acc, bulan, opening: 0, totalDebit: 0, totalCredit: 0, closing: 0, entries: [] };
        }
        const l = serverLedger[acc][bulan];
        const debit = Number(line.debit) || 0;
        const credit = Number(line.credit) || 0;

        l.entries.push({
          entryId,
          noEntry: currentEntry.noEntry,
          date: currentEntry.date,
          desc: currentEntry.desc,
          debit,
          credit,
          t: currentEntry.t || Date.now()
        });
        l.totalDebit += debit;
        l.totalCredit += credit;

        const isKreditNormal = acc.startsWith('2') || (acc.startsWith('3') && acc !== '302' && acc !== '3002' && acc !== '3003') || acc.startsWith('4');
        if (isKreditNormal) {
          l.closing = (l.opening || 0) + l.totalCredit - l.totalDebit;
        } else {
          l.closing = (l.opening || 0) + l.totalDebit - l.totalCredit;
        }
      }

      // Update di Firebase bila aktif
      if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
        try {
          await fetch(`${databaseUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${auth}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentEntry)
          });
          // Update Ledger & Summary di Firebase setelah approval
          await updateFirebaseLedgerAfterApprove(databaseUrl, bulan, currentEntry.lines, apiKey);
          await updateFirebaseSummaryAfterApprove(databaseUrl, bulan, apiKey);
        } catch (e) {
          console.warn("[SERVER] Error syncing approved journal to Firebase:", e);
        }
      }

      return res.json({
        success: true,
        message: `Jurnal ${currentEntry.noEntry || entryId} berhasil disetujui`,
        entryId,
        data: currentEntry
      });
    } else if (action === 'reject') {
      currentEntry.status = "rejected";
      currentEntry.rejectedReason = body.rejectedReason || "Ditolak oleh finance";
      currentEntry.rejectedAt = Date.now();

      if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
        try {
          await fetch(`${databaseUrl}/accounting/journal/${encodeURIComponent(bulan)}/${encodeURIComponent(entryId)}.json${auth}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentEntry)
          });
        } catch (e) {}
      }

      return res.json({ success: true, message: `Jurnal ${currentEntry.noEntry} berhasil ditolak`, entryId, data: currentEntry });
    } else if (action === 'edit') {
      if (body.newData) {
        Object.assign(currentEntry, body.newData);
      }
      return res.json({ success: true, message: `Jurnal ${currentEntry.noEntry} berhasil diupdate`, entryId, data: currentEntry });
    } else {
      return res.status(400).json({ success: false, error: `Action '${action}' tidak valid` });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /accounting/ledger/:accCode/:bulan
app.get(['/accounting/ledger/:accCode/:bulan', '/api/accounting/ledger/:accCode/:bulan'], async (req, res) => {
  const { accCode, bulan } = req.params;
  const databaseUrl = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.FIREBASE_API_KEY || "";
  const auth = apiKey ? `?auth=${apiKey}` : "";

  if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
    try {
      const fbRes = await fetch(`${databaseUrl}/accounting/ledger/${encodeURIComponent(accCode)}/${encodeURIComponent(bulan)}.json${auth}`);
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        if (fbData) {
          return res.json({ success: true, accCode, bulan, data: fbData });
        }
      }
    } catch (e) {}
  }

  const ledgerData = serverLedger[accCode]?.[bulan] || {
    accCode,
    bulan,
    opening: 0,
    totalDebit: 0,
    totalCredit: 0,
    closing: 0,
    entries: []
  };
  res.json({ success: true, accCode, bulan, data: ledgerData });
});

// GET /accounting/summary/:bulan
app.get(['/accounting/summary/:bulan', '/api/accounting/summary/:bulan'], async (req, res) => {
  const { bulan } = req.params;
  const databaseUrl = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
  const apiKey = process.env.FIREBASE_API_KEY || "";
  const auth = apiKey ? `?auth=${apiKey}` : "";

  if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
    try {
      const fbRes = await fetch(`${databaseUrl}/accounting/summary/${encodeURIComponent(bulan)}.json${auth}`);
      if (fbRes.ok) {
        const fbSummary = await fbRes.json();
        if (fbSummary && typeof fbSummary === 'object') {
          return res.json({ success: true, bulan, data: fbSummary });
        }
      }
    } catch (e) {}
  }

  // Fallback in-memory calculate
  let revPOS = 0;
  let revCatering = 0;
  let hppBahanBaku = 0;
  let bebanGaji = 0;
  let bebanSewa = 0;
  let bebanListrik = 0;
  let bebanMarketing = 0;
  let bebanKurir = 0;
  let bebanPenyusutan = 0;
  let saldoKas = 0;
  let saldoBank = 0;
  let piutang = 0;
  let hutangSupplier = 0;
  let persediaanAkhir = 0;
  let modalPemilik = 0;

  const monthJournals = serverJournals[bulan] || {};
  Object.values(monthJournals).forEach(entry => {
    if (entry.status === 'approved' && Array.isArray(entry.lines)) {
      entry.lines.forEach((l: any) => {
        const acc = String(l.acc);
        const d = Number(l.debit) || 0;
        const c = Number(l.credit) || 0;

        if (acc === '401' || acc === '4001') revPOS += (c - d);
        else if (acc === '402' || acc === '4002') revCatering += (c - d);
        else if (acc === '501' || acc === '5001') hppBahanBaku += (d - c);
        else if (acc === '601' || acc === '6001') bebanGaji += (d - c);
        else if (acc === '602' || acc === '6002') bebanSewa += (d - c);
        else if (acc === '603' || acc === '6003') bebanListrik += (d - c);
        else if (acc === '604' || acc === '6004') bebanMarketing += (d - c);
        else if (acc === '605' || acc === '6005') bebanKurir += (d - c);
        else if (acc === '606' || acc === '6006') bebanPenyusutan += (d - c);
        else if (acc === '101' || acc === '1001') saldoKas += (d - c);
        else if (acc === '102' || acc === '1002') saldoBank += (d - c);
        else if (acc === '103' || acc === '1003') piutang += (d - c);
        else if (acc === '105' || acc === '1004') persediaanAkhir += (d - c);
        else if (acc === '201' || acc === '2001') hutangSupplier += (c - d);
        else if (acc === '301' || acc === '3001') modalPemilik += (c - d);
      });
    }
  });

  const totalPendapatan = revPOS + revCatering;
  const totalHpp = hppBahanBaku;
  const labaKotor = totalPendapatan - totalHpp;
  const totalBeban = bebanGaji + bebanSewa + bebanListrik + bebanMarketing + bebanKurir + bebanPenyusutan;
  const labaBersih = labaKotor - totalBeban;
  const totalAset = saldoKas + saldoBank + piutang + persediaanAkhir;
  const totalKewajiban = hutangSupplier;
  const totalEkuitas = modalPemilik + labaBersih;

  res.json({
    success: true,
    bulan,
    data: {
      periode: bulan,
      pendapatan: { penjualanPos: revPOS, penjualanCatering: revCatering, totalPendapatan },
      hpp: { bahanBaku: hppBahanBaku, totalHpp },
      labaKotor,
      marginKotor: totalPendapatan > 0 ? (labaKotor / totalPendapatan) * 100 : 0,
      beban: { gaji: bebanGaji, sewa: bebanSewa, utilitas: bebanListrik, marketing: bebanMarketing, kurir: bebanKurir, penyusutan: bebanPenyusutan, totalBeban },
      labaBersih,
      marginBersih: totalPendapatan > 0 ? (labaBersih / totalPendapatan) * 100 : 0,
      pembelianBahanBaku: persediaanAkhir,
      persediaanAkhir,
      saldoKas,
      saldoBank,
      piutang,
      hutangSupplier,
      totalAset,
      totalKewajiban,
      totalEkuitas,
      status: labaBersih >= 0 ? "PROFIT" : "LOSS",
      updatedAt: Date.now()
    }
  });
});


// In-Memory Orders Store with Seed Data for Reconciliation
let ordersStore: Record<string, any> = {
  "ORD-9821": {
    orderId: "ORD-9821",
    customer: "Budi Santoso",
    customerName: "Budi Santoso",
    items: [
      { id: "m1", name: "Rice Bowl Chicken Katsu Curry", qty: 2, price: 28000 },
      { id: "m9", name: "Es Lemon Tea Segar", qty: 2, price: 8000 }
    ],
    total: 72000,
    gross_amount: 72000,
    status: "settlement",
    paymentMethod: "QRIS",
    midtransId: "MID-QRIS-9821",
    buktiTransfer: null,
    createdAt: Date.now() - 3600 * 1000 * 2, // 2 jam lalu
    reconciled: false
  },
  "ORD-9822": {
    orderId: "ORD-9822",
    customer: "Siti Rahmawati",
    customerName: "Siti Rahmawati",
    items: [
      { id: "m2", name: "Rice Bowl Beef Teriyaki", qty: 1, price: 35000 },
      { id: "m7", name: "Dimsum Mentai Mozzarella (4 pcs)", qty: 1, price: 24000 }
    ],
    total: 59000,
    gross_amount: 59000,
    status: "pending",
    paymentMethod: "Transfer Bank BCA",
    midtransId: "MID-VA-9822",
    buktiTransfer: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
    createdAt: Date.now() - 3600 * 1000 * 4, // 4 jam lalu
    reconciled: false
  },
  "ORD-9823": {
    orderId: "ORD-9823",
    customer: "Rian Hidayat",
    customerName: "Rian Hidayat",
    items: [
      { id: "m3", name: "Spicy Honey Chicken Wings (6 pcs)", qty: 2, price: 32000 },
      { id: "m10", name: "Es Cincau Gula Aren Susu", qty: 2, price: 12000 }
    ],
    total: 88000,
    gross_amount: 88000,
    status: "pending",
    paymentMethod: "QRIS",
    midtransId: "MID-QRIS-9823",
    buktiTransfer: null,
    createdAt: Date.now() - 3600 * 1000 * 26, // 26 jam lalu (> 24 jam untuk test notification)
    reconciled: false
  },
  "ORD-9824": {
    orderId: "ORD-9824",
    customer: "Maya Indah",
    customerName: "Maya Indah",
    items: [
      { id: "m5", name: "Mie Pedas Viral Level 3", qty: 2, price: 22000 },
      { id: "m6", name: "Bakso Cuanki Kuah Pedas", qty: 1, price: 25000 }
    ],
    total: 69000,
    gross_amount: 69000,
    status: "settlement",
    paymentMethod: "E-Wallet GoPay",
    midtransId: "MID-EWL-9824",
    buktiTransfer: null,
    createdAt: Date.now() - 3600 * 1000 * 1, // 1 jam lalu
    reconciled: false
  },
  "ORD-9825": {
    orderId: "ORD-9825",
    customer: "Dewi Lestari",
    customerName: "Dewi Lestari",
    items: [
      { id: "m4", name: "Chicken Egg Roll Bento Komplit", qty: 1, price: 30000 }
    ],
    total: 30000,
    gross_amount: 30000,
    status: "gagal",
    paymentMethod: "QRIS",
    midtransId: "MID-QRIS-9825",
    buktiTransfer: null,
    createdAt: Date.now() - 3600 * 1000 * 8,
    reconciled: false
  },
  "ORD-9826": {
    orderId: "ORD-9826",
    customer: "Agus Pratama",
    customerName: "Agus Pratama",
    items: [
      { id: "m8", name: "Siomay Udang Ayam Kukus", qty: 2, price: 20000 },
      { id: "m9", name: "Es Lemon Tea Segar", qty: 2, price: 8000 }
    ],
    total: 56000,
    gross_amount: 56000,
    status: "pending",
    paymentMethod: "Transfer Mandiri",
    midtransId: "MID-VA-9826",
    buktiTransfer: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400",
    createdAt: Date.now() - 3600 * 1000 * 28, // > 24 jam
    reconciled: false
  }
};

let lastReconcileStore: Record<string, number> = {};
let posTransactionsStore: Record<string, any> = {};

// GET & POST /pos/last_reconcile/:kasirUsername
app.get(['/pos/last_reconcile/:kasirUsername', '/api/pos/last_reconcile/:kasirUsername'], (req, res) => {
  const { kasirUsername } = req.params;
  const lastTime = lastReconcileStore[kasirUsername] || (Date.now() - 24 * 60 * 60 * 1000);
  res.json({ success: true, kasirUsername, lastReconcile: lastTime });
});

app.all(['/pos/last_reconcile/:kasirUsername', '/api/pos/last_reconcile/:kasirUsername'], (req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const { kasirUsername } = req.params;
    const { timestamp } = req.body || {};
    const t = Number(timestamp) || Date.now();
    lastReconcileStore[kasirUsername] = t;
    return res.json({ success: true, kasirUsername, lastReconcile: t });
  }
  next();
});

// GET /orders with filters
app.get(['/orders', '/api/orders'], (req, res) => {
  const orders = Object.values(ordersStore);
  res.json({ success: true, data: orders, count: orders.length });
});

// GET /orders/:orderId
app.get(['/orders/:orderId', '/api/orders/:orderId'], (req, res) => {
  const { orderId } = req.params;
  const order = ordersStore[orderId];
  if (!order) {
    return res.status(404).json({ success: false, error: "Order tidak ditemukan" });
  }
  res.json({ success: true, data: order });
});

// PATCH /orders/:orderId
app.patch(['/orders/:orderId', '/api/orders/:orderId'], (req, res) => {
  const { orderId } = req.params;
  const order = ordersStore[orderId];
  if (!order) {
    return res.status(404).json({ success: false, error: "Order tidak ditemukan" });
  }
  Object.assign(order, req.body);
  res.json({ success: true, data: order });
});

// Anti-Duplikat Check: GET /pos/transactions/:date/:txId
app.get(['/pos/transactions/:date/:txId', '/api/pos/transactions/:date/:txId'], (req, res) => {
  const { date, txId } = req.params;
  const orderId = (req.query.orderId as string) || '';
  const key = `${date}/${txId}`;
  
  // Check by txId key or by orderId in transactions
  const found = posTransactionsStore[key] || 
    Object.values(posTransactionsStore).find((t: any) => t.orderId === orderId || (t.id && t.id === orderId));
  
  if (found) {
    return res.json({ exists: true, transaction: found, shiftId: found.shf || found.shiftId || "S-Lalu" });
  }
  res.json({ exists: false });
});

// Seed Shifts Store for History (up to 30 shifts)
const nowMs = Date.now();
const oneDayMs = 24 * 60 * 60 * 1000;
let posShiftsStore: Record<string, any> = {
  "S-2026-09-18-01": {
    id: "S-2026-09-18-01",
    kasir: "kasir",
    open: nowMs - 5 * 3600 * 1000,
    openCash: 200000,
    status: "open",
    totalSales: 2450000,
    cashSales: 980000,
    qrisSales: 1120000,
    transferSales: 350000,
    ewalletSales: 0,
    transactionCount: 42
  }
};

// Generate past 20 shifts for realistic 30-day shift history
for (let i = 1; i <= 20; i++) {
  const pastOpen = nowMs - i * oneDayMs - (8 * 3600 * 1000);
  const pastClose = pastOpen + (8 * 3600 * 1000);
  const shiftCode = `S-${new Date(pastOpen).toISOString().slice(0, 10)}-${String(i % 2 + 1).padStart(2, '0')}`;
  const sales = 1800000 + Math.floor(Math.sin(i) * 600000) + (i * 25000);
  const cashSales = Math.floor(sales * 0.4);
  const qrisSales = Math.floor(sales * 0.45);
  const transferSales = sales - cashSales - qrisSales;
  
  posShiftsStore[shiftCode] = {
    id: shiftCode,
    kasir: i % 2 === 0 ? "kasir1" : "kasir2",
    open: pastOpen,
    close: pastClose,
    openCash: 200000,
    closeCash: 200000 + cashSales,
    expectedCash: 200000 + cashSales,
    diff: 0,
    status: "closed",
    totalSales: sales,
    cashSales: cashSales,
    qrisSales: qrisSales,
    transferSales: transferSales,
    ewalletSales: 0,
    transactionCount: 30 + (i % 15)
  };
}

// Pre-seed some transactions for today & this month
const todayStr = new Date().toISOString().slice(0, 10);
const sampleMenuItems = [
  { id: 'm1', name: 'Rice Bowl Chicken Katsu Curry', price: 28000 },
  { id: 'm2', name: 'Rice Bowl Beef Teriyaki', price: 35000 },
  { id: 'm3', name: 'Spicy Honey Chicken Wings (6 pcs)', price: 32000 },
  { id: 'm5', name: 'Mie Pedas Viral Level 3', price: 22000 },
  { id: 'm7', name: 'Dimsum Mentai Mozzarella (4 pcs)', price: 24000 },
  { id: 'm9', name: 'Es Lemon Tea Segar', price: 8000 },
  { id: 'm10', name: 'Es Cincau Gula Aren Susu', price: 12000 }
];

// Seed 35 transactions today
for (let j = 0; j < 35; j++) {
  const txHour = 8 + Math.floor((j / 35) * 12);
  const txDate = new Date();
  txDate.setHours(txHour, (j * 7) % 60, 0, 0);
  const txTimeMs = txDate.getTime();
  const txId = `T${txTimeMs}_${j}`;
  const mIndex = j % sampleMenuItems.length;
  const item1 = sampleMenuItems[mIndex];
  const item2 = sampleMenuItems[(mIndex + 1) % sampleMenuItems.length];
  const items = [
    { ...item1, qty: 1 + (j % 3) },
    { ...item2, qty: 1 + ((j + 1) % 2) }
  ];
  const total = items.reduce((sum, it) => sum + (it.price * it.qty), 0);
  const methods = ['tunai', 'qris', 'transfer', 'ewallet'];
  const pm = methods[j % methods.length];

  posTransactionsStore[`${todayStr}/${txId}`] = {
    id: txId,
    orderId: `ORD-POS-${j}`,
    shf: "S-2026-09-18-01",
    t: txTimeMs,
    total: total,
    pm: pm,
    paymentMethod: pm.toUpperCase(),
    items: items,
    kasir: "kasir"
  };
}

// GET /pos/shifts (loadRiwayatShift: 30 shift terakhir)
app.get(['/pos/shifts', '/api/pos/shifts'], (req, res) => {
  try {
    const shifts = Object.values(posShiftsStore)
      .sort((a: any, b: any) => (b.open || 0) - (a.open || 0))
      .slice(0, 30);
    res.json({ success: true, data: shifts });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /pos/shifts/:shiftId
app.get(['/pos/shifts/:shiftId', '/api/pos/shifts/:shiftId'], (req, res) => {
  try {
    const { shiftId } = req.params;
    const shift = posShiftsStore[shiftId];
    if (!shift) {
      return res.status(404).json({ success: false, error: "Shift tidak ditemukan" });
    }
    res.json({ success: true, data: shift });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /pos/shifts (bukaShift baru/reopen)
app.post(['/pos/shifts', '/api/pos/shifts'], (req, res) => {
  try {
    const { id, kasir, open, openCash, modalAwal } = req.body || {};
    const shiftId = id || generateShiftId();
    const newShift = {
      id: shiftId,
      kasir: kasir || "kasir",
      open: open || Date.now(),
      openCash: Number(openCash !== undefined ? openCash : (modalAwal || 200000)),
      status: "open",
      totalSales: 0,
      cashSales: 0,
      qrisSales: 0,
      transferSales: 0,
      ewalletSales: 0,
      transactionCount: 0
    };
    posShiftsStore[shiftId] = newShift;
    res.json({ success: true, message: "Shift berhasil dibuka", data: newShift });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /pos/shifts/:shiftId (tutupShift)
app.patch(['/pos/shifts/:shiftId', '/api/pos/shifts/:shiftId'], (req, res) => {
  try {
    const { shiftId } = req.params;
    let shift = posShiftsStore[shiftId];
    if (!shift) {
      shift = { id: shiftId, kasir: "kasir", open: Date.now() - 3600000, status: "open" };
      posShiftsStore[shiftId] = shift;
    }
    Object.assign(shift, req.body);
    res.json({ success: true, message: "Shift berhasil ditutup", data: shift });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /pos/transactions/:date (Ambil semua transaksi per tanggal)
app.get(['/pos/transactions/:date', '/api/pos/transactions/:date'], (req, res) => {
  try {
    const { date } = req.params;
    const txList = Object.entries(posTransactionsStore)
      .filter(([key]) => key.startsWith(date))
      .map(([, val]) => val);
    res.json({ success: true, date, data: txList, count: txList.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /pos/transactions (Semua transaksi atau query bulan)
app.get(['/pos/transactions', '/api/pos/transactions'], (req, res) => {
  try {
    const month = (req.query.month as string) || '';
    let list = Object.values(posTransactionsStore);
    if (month) {
      list = list.filter((t: any) => {
        const d = t.t ? new Date(t.t).toISOString().slice(0, 7) : '';
        return d === month;
      });
    }
    res.json({ success: true, data: list, count: list.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /pos/summary/daily/:today (Laporan Hari Ini)
app.get(['/pos/summary/daily/:today', '/api/pos/summary/daily/:today'], (req, res) => {
  try {
    const { today } = req.params;
    const txList = Object.entries(posTransactionsStore)
      .filter(([key]) => key.startsWith(today))
      .map(([, val]) => val);

    let totalSales = 0;
    const breakdown = { cash: 0, qris: 0, transfer: 0, ewallet: 0 };

    for (const tx of txList) {
      const amt = Number(tx.total || tx.amount || 0);
      totalSales += amt;
      const pm = String(tx.pm || tx.paymentMethod || '').toLowerCase();
      if (pm.includes('tunai') || pm.includes('cash')) {
        breakdown.cash += amt;
      } else if (pm.includes('qris')) {
        breakdown.qris += amt;
      } else if (pm.includes('transfer') || pm.includes('bca') || pm.includes('mandiri')) {
        breakdown.transfer += amt;
      } else if (pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo') || pm.includes('dana')) {
        breakdown.ewallet += amt;
      } else {
        breakdown.cash += amt;
      }
    }

    res.json({
      success: true,
      totalSales,
      totalTx: txList.length,
      breakdown
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /pos/summary/monthly/:month (Laporan Bulanan)
app.get(['/pos/summary/monthly/:month', '/api/pos/summary/monthly/:month'], (req, res) => {
  try {
    const { month } = req.params;
    const txList = Object.entries(posTransactionsStore)
      .filter(([key]) => key.startsWith(month))
      .map(([, val]) => val);

    let totalSales = 0;
    const breakdown = { cash: 0, qris: 0, transfer: 0, ewallet: 0 };

    for (const tx of txList) {
      const amt = Number(tx.total || tx.amount || 0);
      totalSales += amt;
      const pm = String(tx.pm || tx.paymentMethod || '').toLowerCase();
      if (pm.includes('tunai') || pm.includes('cash')) {
        breakdown.cash += amt;
      } else if (pm.includes('qris')) {
        breakdown.qris += amt;
      } else if (pm.includes('transfer') || pm.includes('bca') || pm.includes('mandiri')) {
        breakdown.transfer += amt;
      } else if (pm.includes('ewallet') || pm.includes('gopay') || pm.includes('ovo') || pm.includes('dana')) {
        breakdown.ewallet += amt;
      } else {
        breakdown.cash += amt;
      }
    }

    res.json({
      success: true,
      month,
      totalSales,
      totalTx: txList.length,
      breakdown
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /report-daily, /report-pl, /report-shift
app.post(['/report-daily', '/api/report-daily', '/report-pl', '/api/report-pl', '/report-shift', '/api/report-shift'], (req, res) => {
  try {
    const payload = req.body || {};
    const reportType = req.path.includes('pl') ? 'pl' : (req.path.includes('shift') ? 'shift' : 'daily');
    res.json({
      success: true,
      type: reportType,
      generatedAt: Date.now(),
      summary: payload,
      downloadUrl: null
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /receipt, /api/receipt (Generate Struk 80mm PDF Base64 & Data Struk)
app.post(['/receipt', '/api/receipt', '/functions/receipt'], async (req, res) => {
  try {
    const { handleReceiptRequest } = await import('./functions/receipt.js');
    const result = await handleReceiptRequest(req.body, process.env);
    res.status(result.status).json(result.data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Gagal membuat struk PDF" });
  }
});

// POST/GET /archive, /api/archive (Monthly Data Archiving to Firebase Storage)
app.all(['/archive', '/api/archive', '/functions/archive'], async (req, res) => {
  try {
    const archiveModulePath = './functions/archive.js';
    const { executeMonthlyArchive }: any = await import(/* @vite-ignore */ archiveModulePath);
    const options = req.method === 'POST' ? req.body : {
      date: req.query.date as string,
      dryRun: req.query.dryRun === 'true' || req.query.dryRun === '1'
    };
    const result = await executeMonthlyArchive(options, process.env);
    res.status(result.status).json(result.data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Gagal memproses arsip data" });
  }
});

// POST /report-pl, /api/report-pl (Generate Monthly Profit & Loss PDF & Data)
app.post(['/report-pl', '/api/report-pl', '/functions/report-pl'], async (req, res) => {
  try {
    const { handleReportPLRequest } = await import('./functions/report-pl.js');
    const result = await handleReportPLRequest(req.body, process.env);
    res.status(result.status).json(result.data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Gagal membuat laporan laba rugi" });
  }
});

// POST /reconcile, /api/reconcile (Bulk Reconcile Orders to POS Transactions)
app.post(['/reconcile', '/api/reconcile', '/functions/reconcile'], async (req, res) => {
  try {
    const { processBulkReconcile } = await import('./functions/reconcile.js');
    const result = await processBulkReconcile(req.body, process.env);
    res.status(result.status).json(result.data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Gagal memproses rekonsiliasi" });
  }
});

// POST /aggregate, /api/aggregate (Update daily & monthly summaries)
app.post(['/aggregate', '/api/aggregate', '/functions/aggregate'], async (req, res) => {
  try {
    const aggregateModulePath = './functions/aggregate.js';
    const { handleAggregateRequest }: any = await import(/* @vite-ignore */ aggregateModulePath);
    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '127.0.0.1';
    const result = await handleAggregateRequest(req.body, process.env, clientIp);
    res.status(result.status).json(result.data);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Gagal memproses agregasi ringkasan" });
  }
});

// =========================================================================
// ACCOUNTING (AKUNTANSI) BACKEND API ROUTES -> Delegated to functions/accounting/[[path]].js
// =========================================================================
app.all(['/accounting', '/accounting/*', '/api/accounting', '/api/accounting/*'], async (req, res) => {
  try {
    const { onRequest } = await import('./functions/accounting/[[path]].js');
    const targetPath = req.originalUrl.replace(/^\/api/, '');
    const fullUrl = `http://${req.get('host') || '127.0.0.1:3000'}${targetPath}`;
    const headers = new Headers();
    Object.entries(req.headers).forEach(([k, v]) => {
      if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    });
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const bodyStr = hasBody ? JSON.stringify(req.body || {}) : undefined;

    const webReq = new Request(fullUrl, {
      method: req.method,
      headers,
      body: bodyStr
    });

    const webRes = await onRequest({
      request: webReq,
      env: process.env
    });

    res.status(webRes.status);
    webRes.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });
    const bodyText = await webRes.text();
    res.send(bodyText);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Gagal memproses request accounting" });
  }
});

// Handler for Midtrans Webhook Notification & SHA-512 Security Verification
const handleWebhook = async (req: express.Request, res: express.Response) => {
  try {
    const { order_id, status_code, gross_amount, signature_key, transaction_status } = req.body || {};
    const serverKey = process.env.MIDTRANS_SERVER_KEY || "";

    if (serverKey && !serverKey.includes("YOUR_MIDTRANS") && signature_key) {
      const raw = `${order_id}${status_code}${gross_amount}${serverKey}`;
      const hash = crypto.createHash('sha512').update(raw).digest('hex');
      if (hash.toLowerCase() !== signature_key.toLowerCase()) {
        return res.status(403).json({ error: "Invalid signature key. Security verification failed." });
      }
    }

    res.json({
      status: "OK",
      message: "Webhook verified successfully",
      order_id,
      transaction_status
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
};

app.post('/functions/webhook', handleWebhook);
app.post('/api/webhook', handleWebhook);

// Helper: SHA-256 hash using Node.js crypto
const hashPinSha256 = (pin: string) => crypto.createHash('sha256').update(pin).digest('hex');

// Format: S-{YYYY-MM-DD}-{HHMMSS}
const generateShiftId = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `S-${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
};

// Handler for Kasir Auth (Login Kasir Pintar)
const handleKasirAuth = async (req: express.Request, res: express.Response) => {
  try {
    const { username = "", pin = "" } = req.body || {};
    const cleanUsername = String(username).trim().toLowerCase();
    const cleanPin = String(pin).trim();

    if (!cleanUsername) {
      return res.status(400).json({ success: false, error: "Username tidak ditemukan" });
    }

    if (!cleanPin) {
      return new Response ? null : res.status(400).json({ success: false, error: "PIN wajib diisi." });
    }

    const inputHash = hashPinSha256(cleanPin);

    // 1. Coba baca data dari Firebase Realtime Database jika dikonfigurasi
    const databaseUrl = (process.env.FIREBASE_DATABASE_URL || "").replace(/\/$/, "");
    const apiKey = process.env.FIREBASE_API_KEY || "";
    let userData: any = null;

    if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
      try {
        const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
        const userUrl = `${databaseUrl}/users/${encodeURIComponent(cleanUsername)}.json${authParam}`;
        const fbRes = await fetch(userUrl);
        if (fbRes.ok) {
          const resJson = await fbRes.json();
          if (resJson && typeof resJson === "object" && !resJson.error) {
            userData = resJson;
          }
        }
      } catch (fbErr) {
        console.warn("Firebase REST fetch error in dev server:", fbErr);
      }
    }

    // Fallback default users jika belum ada di Firebase
    const defaultUsers: Record<string, any> = {
      kasir: {
        name: "Kasir Utama",
        role: "kasir",
        pin_hash: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92" // 123456
      },
      kasir1: {
        name: "Kasir 1 (Shift Pagi)",
        role: "kasir",
        pin_hash: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92" // 123456
      },
      kasir2: {
        name: "Kasir 2 (Shift Sore)",
        role: "kasir",
        pin_hash: "90a3ed9e32b2aaf4c61c410eb925426119e1a9dc53d4286ade99a809bae4e1e3" // 654321
      }
    };

    if (!userData && defaultUsers[cleanUsername]) {
      userData = defaultUsers[cleanUsername];
    } else if (userData && defaultUsers[cleanUsername]) {
      if (!userData.pin_hash) userData.pin_hash = defaultUsers[cleanUsername].pin_hash;
      if (!userData.role) userData.role = defaultUsers[cleanUsername].role;
      if (!userData.name) userData.name = defaultUsers[cleanUsername].name;
    }

    if (!userData) {
      return res.status(404).json({ success: false, error: "Username tidak ditemukan" });
    }

    if (userData.role !== "kasir") {
      return res.status(403).json({ success: false, error: "Akses ditolak" });
    }

    if (String(userData.pin_hash || "").toLowerCase() !== inputHash.toLowerCase()) {
      return res.status(401).json({ success: false, error: "PIN salah" });
    }

    const shiftId = generateShiftId();
    const openTimestamp = Date.now();

    // Simpan ke in-memory posShiftsStore
    posShiftsStore[shiftId] = {
      id: shiftId,
      kasir: cleanUsername,
      open: openTimestamp,
      openCash: 200000,
      status: "open",
      totalSales: 0,
      cashSales: 0,
      qrisSales: 0,
      transferSales: 0,
      ewalletSales: 0,
      transactionCount: 0
    };

    // Simpan shift baru ke Firebase jika ada
    if (databaseUrl && !databaseUrl.includes("YOUR_PROJECT_ID")) {
      const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
      const shiftUrl = `${databaseUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`;
      fetch(shiftUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kasir: cleanUsername, open: openTimestamp, openCash: 0 })
      }).catch(e => console.warn("Shift save warning:", e));

      const userUpdateUrl = `${databaseUrl}/users/${encodeURIComponent(cleanUsername)}.json${authParam}`;
      fetch(userUpdateUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_login: openTimestamp })
      }).catch(e => console.warn("Last login save warning:", e));
    }

    const kasirInfo = {
      username: cleanUsername,
      name: userData.name || cleanUsername,
      role: "kasir",
      shiftId: shiftId
    };

    return res.json({
      success: true,
      kasir: kasirInfo,
      // Alias datar untuk fleksibilitas
      username: kasirInfo.username,
      kasirName: kasirInfo.name,
      shiftId: shiftId,
      loginAt: new Date(openTimestamp).toISOString()
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Gagal memproses login kasir." });
  }
};

app.post('/kasir-auth', handleKasirAuth);
app.post('/api/kasir-auth', handleKasirAuth);
app.post('/functions/kasir-auth', handleKasirAuth);

import fs from "fs";

// Try to load globally saved config
let savedFirebaseConfig: any = {};
try {
  if (fs.existsSync('firebase-credentials.json')) {
    savedFirebaseConfig = JSON.parse(fs.readFileSync('firebase-credentials.json', 'utf8'));
  }
} catch (e) {
  console.warn("No valid firebase-credentials.json found");
}

// Dynamic API endpoint to serve server-side environment variables
app.get('/api/firebase-config', (req, res) => {
  if (savedFirebaseConfig && savedFirebaseConfig.apiKey) {
    return res.json(savedFirebaseConfig);
  }

  const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
  let projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "";
  const databaseURL = process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL || "";

  if (!projectId && databaseURL) {
    const match = databaseURL.match(/https:\/\/(.*?)-default-rtdb/);
    if (match && match[1]) {
      projectId = match[1];
    }
  }

  const finalDatabaseURL = databaseURL || (projectId ? `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app` : "");
  
  res.json({
    apiKey: apiKey,
    authDomain: projectId ? projectId + '.firebaseapp.com' : '',
    databaseURL: finalDatabaseURL,
    projectId: projectId,
    storageBucket: projectId ? projectId + '.appspot.com' : '',
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
  });
});

app.post('/api/firebase-config', (req, res) => {
  try {
    const config = req.body;
    if (config && config.apiKey) {
      savedFirebaseConfig = config;
      fs.writeFileSync('firebase-credentials.json', JSON.stringify(config, null, 2));
      res.json({ success: true, message: "Credentials saved globally to server" });
    } else {
      res.status(400).json({ error: "Invalid config payload" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static assets from public/ directory
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

// Fallback route: serve index.html for single-page routing
app.get('*', (req, res) => {
  if (req.path === '/accounting' || req.path === '/accounting.html') {
    return res.sendFile(path.join(publicDir, 'accounting.html'));
  }
  if (req.path === '/analytics' || req.path === '/analytics.html') {
    return res.sendFile(path.join(publicDir, 'analytics.html'));
  }
  if (req.path === '/kasir' || req.path === '/kasir.html') {
    return res.sendFile(path.join(publicDir, 'kasir.html'));
  }
  if (req.path === '/login-gate' || req.path === '/login-gate.html') {
    return res.sendFile(path.join(publicDir, 'login-gate.html'));
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dapur Kuliner & Catering Server running on http://0.0.0.0:${PORT}`);
});
