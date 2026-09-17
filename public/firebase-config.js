// firebase-config.js (Client-side loader)
// Mengambil konfigurasi dari server secara dinamis

let fetchedConfig = { 
  apiKey: "YOUR_FIREBASE_API_KEY_HERE",
  projectId: "demo-mode",
  databaseURL: "local-storage"
};

try {
  // Tambahkan cache-busting agar browser/Cloudflare CDN tidak menyimpan respon lama
  const timestamp = new Date().getTime();
  const res = await fetch(`/api/firebase-config?_cb=${timestamp}`);
  
  if (res.ok) {
    const data = await res.json();
    // Validasi ketat: pastikan apiKey benar-benar ada dan bukan string kosong
    if (data && data.apiKey && data.apiKey.trim() !== "") {
      fetchedConfig = data;
    } else {
      console.warn("⚠️ Server API merespon, tetapi Environment Variables Firebase kosong. Pastikan sudah Re-Deploy di Cloudflare.");
    }
  } else {
    console.warn(`⚠️ Gagal mengambil config dari server. HTTP Status: ${res.status}`);
  }
} catch (e) {
  console.warn("⚠️ Menggunakan fallback kredensial browser lokal karena server tidak dapat dihubungi.", e);
}

export const firebaseConfig = fetchedConfig;
export const IS_DEMO_MODE = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE");
