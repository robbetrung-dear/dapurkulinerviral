// firebase-config.js (client-side loader)
// TEMPLATE — salin file ini menjadi firebase-config.js dan isi dengan
// kredensial Firebase project Anda. firebase-config.js TIDAK di-commit
// (lihat .gitignore). Anda juga bisa men-generate-nya dari Panel Admin
// (tombol "Download firebase-config.js").

export const firebaseConfig = {
  apiKey: "YOUR_FIREBASE_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

export const IS_DEMO_MODE = true;
