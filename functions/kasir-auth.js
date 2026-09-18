/**
 * ============================================================================
 * Cloudflare Pages Function: /functions/kasir-auth.js
 * ============================================================================
 * Endpoint autentikasi aman Kasir Pintar (Login Ganda Kasir).
 *
 * ENDPOINT: POST /kasir-auth (atau /api/kasir-auth)
 * BODY REQUEST: { "username": string, "pin": string }
 * RESPONSE SUKSES: { "success": true, "kasir": { "username", "name", "role", "shiftId" } }
 * RESPONSE GAGAL:  { "success": false, "error": string }
 *
 * ----------------------------------------------------------------------------
 * CONTOH TEST MENGGUNAKAN CURL:
 * ----------------------------------------------------------------------------
 * 1. Login Kasir Berhasil:
 *    curl -X POST https://<domain-anda>/kasir-auth \
 *      -H "Content-Type: application/json" \
 *      -d '{"username":"kasir","pin":"123456"}'
 *
 * 2. Login Kasir Gagal (PIN Salah):
 *    curl -X POST https://<domain-anda>/kasir-auth \
 *      -H "Content-Type: application/json" \
 *      -d '{"username":"kasir","pin":"999999"}'
 *
 * ----------------------------------------------------------------------------
 * SCRIPT GENERATE HASH PIN PERTAMA KALI (JALANKAN DI BROWSER CONSOLE / NODE.JS):
 * ----------------------------------------------------------------------------
 * // Copy-paste snippet berikut di Developer Tools Console (F12) browser Anda:
 * async function buatUserKasir(username, nama, pinPlain) {
 *   const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pinPlain));
 *   const pin_hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
 *   const dataFirebase = {
 *     [username]: {
 *       name: nama,
 *       role: "kasir",
 *       pin_hash: pin_hash,
 *       created_at: Date.now()
 *     }
 *   };
 *   console.log("JSON untuk diimport/set ke Firebase path /users :", JSON.stringify(dataFirebase, null, 2));
 *   console.log("Hash PIN (" + pinPlain + "):", pin_hash);
 * }
 * // Contoh eksekusi:
 * // buatUserKasir("kasir", "Kasir Utama", "123456");
 * // Hasil pin_hash untuk 123456: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
 * ============================================================================
 */

// ============================================================================
// RATE LIMITING STRATEGY (Max 5 Percobaan Gagal per IP per 15 Menit)
// ============================================================================
// Penjelasan Pilihan:
// 1. In-Memory Map (Per-Isolate): Berjalan secara instan tanpa setup tambahan,
//    ideal untuk deployment serverless edge Cloudflare Workers / Pages gratis.
// 2. Cloudflare KV (`env.RATE_LIMIT_KV`): Jika variabel KV namespace diikat di
//    dashboard Cloudflare, function otomatis menggunakan KV untuk persistensi
//    lintas seluruh edge data center global.
// ============================================================================
const inMemoryRateLimit = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 menit
const MAX_FAILED_ATTEMPTS = 5;

// Helper: Ambil IP klien dari request Cloudflare
function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1"
  );
}

// Helper: Cek & Catat Rate Limit
async function checkRateLimit(ip, env) {
  const now = Date.now();

  // Jika Cloudflare KV tersedia
  if (env && env.RATE_LIMIT_KV) {
    try {
      const kvKey = `rate_${ip}`;
      const recordStr = await env.RATE_LIMIT_KV.get(kvKey);
      if (recordStr) {
        const record = JSON.parse(recordStr);
        if (now - record.firstAttempt < RATE_LIMIT_WINDOW_MS) {
          if (record.count >= MAX_FAILED_ATTEMPTS) {
            const sisaMenit = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.firstAttempt)) / 60000);
            return { blocked: true, sisaMenit };
          }
        }
      }
    } catch (e) {
      console.warn("KV rate limit error:", e);
    }
  }

  // Fallback: In-Memory Map
  const record = inMemoryRateLimit.get(ip);
  if (record) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS) {
      inMemoryRateLimit.delete(ip);
    } else if (record.count >= MAX_FAILED_ATTEMPTS) {
      const sisaMenit = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.firstAttempt)) / 60000);
      return { blocked: true, sisaMenit };
    }
  }

  return { blocked: false };
}

// Helper: Tambah Counter Percobaan Gagal
async function recordFailedAttempt(ip, env) {
  const now = Date.now();

  if (env && env.RATE_LIMIT_KV) {
    try {
      const kvKey = `rate_${ip}`;
      const recordStr = await env.RATE_LIMIT_KV.get(kvKey);
      let count = 1;
      let firstAttempt = now;
      if (recordStr) {
        const r = JSON.parse(recordStr);
        if (now - r.firstAttempt < RATE_LIMIT_WINDOW_MS) {
          count = r.count + 1;
          firstAttempt = r.firstAttempt;
        }
      }
      await env.RATE_LIMIT_KV.put(
        kvKey,
        JSON.stringify({ count, firstAttempt }),
        { expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000) }
      );
    } catch (e) {
      console.warn("KV put rate limit error:", e);
    }
  }

  const memRecord = inMemoryRateLimit.get(ip);
  if (!memRecord || now - memRecord.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    inMemoryRateLimit.set(ip, { count: 1, firstAttempt: now });
  } else {
    memRecord.count += 1;
  }
}

// Helper: Reset Rate Limit setelah Login Sukses
async function clearRateLimit(ip, env) {
  if (env && env.RATE_LIMIT_KV) {
    try {
      await env.RATE_LIMIT_KV.delete(`rate_${ip}`);
    } catch (e) {}
  }
  inMemoryRateLimit.delete(ip);
}

// Helper: Hash SHA-256 menggunakan Web Crypto API standar
async function hashSha256(plainText) {
  const encoder = new TextEncoder();
  const data = encoder.encode(String(plainText));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper: Format Shift ID: "S-{YYYY-MM-DD}-{HHMMSS}"
function generateShiftId() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `S-${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
}

// ============================================================================
// MAIN HANDLER: Cloudflare Pages Function
// ============================================================================
export async function onRequest(context) {
  const { request, env } = context;

  // Header CORS
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // 1. Handle HTTP OPTIONS untuk preflight CORS
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Hanya izinkan POST
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Metode tidak diizinkan. Gunakan POST." }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }

  const clientIp = getClientIp(request);

  try {
    // 2. Cek Proteksi Rate Limiting
    const limitCheck = await checkRateLimit(clientIp, env);
    if (limitCheck.blocked) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Terlalu banyak percobaan login gagal. Akses dibatasi sementara selama ${limitCheck.sisaMenit} menit.`
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // 3. Parsing dan Validasi Input
    let body;
    try {
      body = await request.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, error: "Format request body harus berupa JSON." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { username = "", pin = "" } = body || {};
    const cleanUsername = String(username).trim().toLowerCase();
    const cleanPin = String(pin).trim();

    if (!cleanUsername) {
      return new Response(
        JSON.stringify({ success: false, error: "Username wajib diisi." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!cleanPin) {
      return new Response(
        JSON.stringify({ success: false, error: "PIN wajib diisi." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Hitung SHA-256 hash dari PIN input
    const inputPinHash = await hashSha256(cleanPin);

    // 4. Ambil Konfigurasi Firebase dari Environment Variables
    const databaseUrl = (
      env?.FIREBASE_DATABASE_URL ||
      env?.VITE_FIREBASE_DATABASE_URL ||
      ""
    ).replace(/\/$/, "");

    const apiKey = env?.FIREBASE_API_KEY || env?.VITE_FIREBASE_API_KEY || "";

    let userData = null;
    let isFirebaseConfigured = Boolean(
      databaseUrl &&
      !databaseUrl.includes("YOUR_PROJECT_ID") &&
      databaseUrl !== "local-storage"
    );

    // 5. Baca Data Kasir dari Firebase Realtime Database REST API
    if (isFirebaseConfigured) {
      const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";
      const userUrl = `${databaseUrl}/users/${encodeURIComponent(cleanUsername)}.json${authParam}`;

      try {
        const fbRes = await fetch(userUrl, {
          method: "GET",
          headers: { "Accept": "application/json" }
        });

        if (fbRes.ok) {
          const resJson = await fbRes.json();
          if (resJson && typeof resJson === "object" && !resJson.error) {
            userData = resJson;
          }
        } else {
          console.warn(`Firebase REST API query returned status: ${fbRes.status}`);
        }
      } catch (fbErr) {
        console.error("Firebase REST API connection error:", fbErr);
      }
    }

    // Fallback Akun Kasir Default (Bila Firebase belum diisi atau akun default digunakan)
    const DEFAULT_KASIR_MAP = {
      "kasir": {
        name: "Kasir Utama",
        role: "kasir",
        // SHA-256 dari "123456"
        pin_hash: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
      },
      "kasir1": {
        name: "Kasir 1 (Shift Pagi)",
        role: "kasir",
        pin_hash: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
      },
      "kasir2": {
        name: "Kasir 2 (Shift Sore)",
        role: "kasir",
        // SHA-256 dari "654321"
        pin_hash: "90a3ed9e32b2aaf4c61c410eb925426119e1a9dc53d4286ade99a809bae4e1e3"
      }
    };

    if (!userData && DEFAULT_KASIR_MAP[cleanUsername]) {
      userData = DEFAULT_KASIR_MAP[cleanUsername];
    } else if (userData && DEFAULT_KASIR_MAP[cleanUsername]) {
      // Jika di Firebase belum lengkap role atau pin_hash-nya
      if (!userData.pin_hash) userData.pin_hash = DEFAULT_KASIR_MAP[cleanUsername].pin_hash;
      if (!userData.role) userData.role = DEFAULT_KASIR_MAP[cleanUsername].role;
      if (!userData.name) userData.name = DEFAULT_KASIR_MAP[cleanUsername].name;
    }

    // 6. Validasi Keberadaan User
    if (!userData) {
      await recordFailedAttempt(clientIp, env);
      return new Response(
        JSON.stringify({ success: false, error: "Username tidak ditemukan" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Cek Role User
    if (userData.role !== "kasir") {
      await recordFailedAttempt(clientIp, env);
      return new Response(
        JSON.stringify({ success: false, error: "Akses ditolak" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Cek Kesesuaian SHA-256 Hash PIN (Tanpa Membocorkan Hash ke Klien)
    const storedHash = String(userData.pin_hash || "").toLowerCase();
    if (storedHash !== inputPinHash.toLowerCase()) {
      await recordFailedAttempt(clientIp, env);
      return new Response(
        JSON.stringify({ success: false, error: "PIN salah" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PIN Benar -> Bersihkan counter rate limit
    await clearRateLimit(clientIp, env);

    // 9. Generate Shift ID Baru Format: "S-{YYYY-MM-DD}-{HHMMSS}"
    const shiftId = generateShiftId();
    const openTimestamp = Date.now();

    const shiftData = {
      kasir: cleanUsername,
      open: openTimestamp,
      openCash: 0
    };

    // 10. Simpan Shift Baru & Update last_login ke Firebase jika terhubung
    if (isFirebaseConfigured) {
      const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

      // Path: /pos/shifts/{shiftId}
      const shiftUrl = `${databaseUrl}/pos/shifts/${encodeURIComponent(shiftId)}.json${authParam}`;
      fetch(shiftUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shiftData)
      }).catch(e => console.warn("Background shift write error:", e));

      // Path: /users/{username}/last_login = Date.now()
      const userUpdateUrl = `${databaseUrl}/users/${encodeURIComponent(cleanUsername)}.json${authParam}`;
      fetch(userUpdateUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ last_login: openTimestamp })
      }).catch(e => console.warn("Background last_login update error:", e));
    }

    // 11. Return Response Sukses
    const kasirInfo = {
      username: cleanUsername,
      name: userData.name || cleanUsername,
      role: "kasir",
      shiftId: shiftId
    };

    return new Response(
      JSON.stringify({
        success: true,
        kasir: kasirInfo,
        // Kompatibilitas field langsung
        username: kasirInfo.username,
        kasirName: kasirInfo.name,
        shiftId: shiftId,
        loginAt: new Date(openTimestamp).toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (err) {
    console.error("Critical error in kasir-auth function:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || "Terjadi kesalahan internal pada server kasir."
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
}
