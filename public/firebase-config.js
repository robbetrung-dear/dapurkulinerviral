// firebase-config.js (Client-side loader)
// Mengambil konfigurasi dari server secara dinamis

let fetchedConfig = { 
  apiKey: "YOUR_FIREBASE_API_KEY_HERE",
  projectId: "demo-mode",
  databaseURL: "local-storage"
};

try {
  const res = await fetch('/api/firebase-config');
  if (res.ok) {
    const data = await res.json();
    if (data && data.apiKey) {
      fetchedConfig = data;
    }
  }
} catch (e) {
  console.warn("Menggunakan fallback kredensial browser lokal karena server tidak mengirimkan config.");
}

export const firebaseConfig = fetchedConfig;
export const IS_DEMO_MODE = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE");
