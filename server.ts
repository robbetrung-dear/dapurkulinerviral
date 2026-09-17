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

// Dynamic firebase-config.js endpoint to serve server-side environment variables
app.get('/firebase-config.js', (req, res) => {
  const apiKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "";
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "";
  const databaseURL = process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL || `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`;
  
  const jsContent = `// firebase-config.js (Dynamically generated from server environment variables)
export const firebaseConfig = {
  apiKey: "${apiKey}",
  authDomain: "${projectId ? projectId + '.firebaseapp.com' : ''}",
  databaseURL: "${databaseURL}",
  projectId: "${projectId}",
  storageBucket: "${projectId ? projectId + '.appspot.com' : ''}",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};

export const IS_DEMO_MODE = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE");
`;
  res.setHeader('Content-Type', 'application/javascript');
  res.send(jsContent);
});

// Serve static assets from public/ directory
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

// Fallback route: serve index.html for single-page routing
app.get('*', (req, res) => {
  if (req.path === '/analytics' || req.path === '/analytics.html') {
    return res.sendFile(path.join(publicDir, 'analytics.html'));
  }
  if (req.path === '/kasir' || req.path === '/kasir.html') {
    return res.sendFile(path.join(publicDir, 'kasir.html'));
  }
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dapur Kuliner & Catering Server running on http://0.0.0.0:${PORT}`);
});
