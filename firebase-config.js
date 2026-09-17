// firebase-config.js
// Konfigurasi Firebase Realtime Database & Auth (Modular SDK v9)
// File ini AMAN untuk publik (dapat di-load langsung di browser/client-side).
// Kunci API Firebase (apiKey) berfungsi sebagai identifier project, bukan secret key server.
// Keamanan data dijamin oleh Firebase Security Rules (lihat firebase-rules.json).

export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY_HERE",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};

// Mode Fallback Lokal untuk Demo Preview jika Firebase belum dihubungkan
export const IS_DEMO_MODE = !firebaseConfig.apiKey || firebaseConfig.apiKey.includes("YOUR_FIREBASE");
