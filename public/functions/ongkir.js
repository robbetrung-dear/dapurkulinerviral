/**
 * functions/ongkir.js - Cloudflare Pages Function
 * Proxy API untuk Biteship / RajaOngkir API.
 * Menghitung ongkos kirim multi-kurir berdampingan:
 * JNE, J&T, SiCepat, AnterAja, POS, Ninja Xpress, GoSend / GrabExpress.
 * 
 * Mengamankan BITESHIP_API_KEY dari browser.
 */

export async function onRequest(context) {
  const { request, env } = context;

  // Header CORS untuk akses frontend
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Gunakan POST." }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const payload = await request.json();
    const {
      origin_area_id = "IDNP6IDNC417IDND2208", // Default Dapur Jakarta/Tangerang
      destination_area_id,
      destination_address,
      couriers = "jne,jnt,sicepat,anteraja,pos,ninja,gosend,grab",
      items = [],
      total_weight_grams = 1000 // default 1 kg atau dihitung dari pax catering
    } = payload;

    const apiKey = env.BITESHIP_API_KEY || "YOUR_BITESHIP_API_KEY_HERE";

    // Jika API Key masih placeholder atau dev mode, berikan data kalkulasi simulasi realistis
    if (!apiKey || apiKey.includes("YOUR_BITESHIP")) {
      const simulatedRates = generateFallbackCourierRates(total_weight_grams, destination_address);
      return new Response(JSON.stringify({
        success: true,
        is_mock: true,
        note: "Menggunakan kalkulasi simulasi tarif kurir (Biteship API Key belum diset di Cloudflare Environment)",
        total_weight_grams,
        rates: simulatedRates
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Call Real Biteship API
    const response = await fetch("https://api.biteship.com/v1/rates/couriers", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        origin_area_id: origin_area_id,
        destination_area_id: destination_area_id,
        couriers: couriers,
        items: items.length > 0 ? items : [{
          name: "Paket Makanan & Catering Dapur",
          description: "Makanan segar siap santap",
          value: 100000,
          weight: total_weight_grams,
          quantity: 1
        }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      // Jika API error, fallback ke kalkulasi estimasi agar user UX tidak rusak
      const simulatedRates = generateFallbackCourierRates(total_weight_grams, destination_address);
      return new Response(JSON.stringify({
        success: true,
        is_mock: true,
        warning: data.message || "Biteship API returned error, showing fallback rates",
        total_weight_grams,
        rates: simulatedRates
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Format & normalisasikan data kurir untuk tabel perbandingan 7 kurir horizontal
    const formattedRates = formatBiteshipRates(data.pricing || []);

    return new Response(JSON.stringify({
      success: true,
      is_mock: false,
      total_weight_grams,
      rates: formattedRates
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({
      success: false,
      error: err.message,
      rates: generateFallbackCourierRates(1000, "Jabodetabek")
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
}

/**
 * Normalisasi data Biteship pricing menjadi 7 kurir standar
 */
function formatBiteshipRates(pricingList) {
  const targetCouriers = ["jne", "jnt", "sicepat", "anteraja", "pos", "ninja", "gosend", "grab"];
  const courierMap = {
    jne: { name: "JNE Express", logo: "fa-truck-fast", color: "border-red-500 text-red-600 bg-red-50" },
    jnt: { name: "J&T Express", logo: "fa-bolt", color: "border-red-600 text-red-700 bg-red-50" },
    sicepat: { name: "SiCepat", logo: "fa-gauge-high", color: "border-orange-500 text-orange-600 bg-orange-50" },
    anteraja: { name: "AnterAja", logo: "fa-paper-plane", color: "border-purple-500 text-purple-600 bg-purple-50" },
    pos: { name: "POS Indonesia", logo: "fa-envelope-open-text", color: "border-amber-600 text-amber-700 bg-amber-50" },
    ninja: { name: "Ninja Xpress", logo: "fa-mask", color: "border-rose-600 text-rose-700 bg-rose-50" },
    gosend: { name: "GoSend Instant", logo: "fa-motorcycle", color: "border-emerald-600 text-emerald-700 bg-emerald-50" },
    grab: { name: "GrabExpress", logo: "fa-route", color: "border-green-600 text-green-700 bg-green-50" }
  };

  return pricingList.map(item => {
    const courierCode = (item.courier_name || "").toLowerCase().replace(/[^a-z]/g, "");
    const baseInfo = courierMap[courierCode] || { name: item.courier_name, logo: "fa-truck", color: "border-gray-400 text-gray-700 bg-gray-50" };
    return {
      courier_code: item.courier_code || courierCode,
      courier_name: item.courier_name || baseInfo.name,
      courier_service_name: item.courier_service_name || "Reguler / Instant",
      service_type: item.service_type || "standard",
      price: item.price,
      estimated_etd: item.shipment_duration_range || item.etd || "1-2 Hari",
      badge_color: baseInfo.color,
      icon: baseInfo.logo
    };
  });
}

/**
 * Fallback kalkulator tarif 7 kurir horizontal saat offline / testing
 */
function generateFallbackCourierRates(weightGrams, address = "") {
  const kg = Math.max(1, Math.ceil(weightGrams / 1000));
  const isInstant = address.toLowerCase().includes("instant") || address.toLowerCase().includes("dekat") || weightGrams <= 5000;

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
