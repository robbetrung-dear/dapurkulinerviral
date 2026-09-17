export async function onRequest(context) {
  const { env } = context;
  const apiKey = env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY || "";
  let projectId = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID || "";
  const databaseURL = env.FIREBASE_DATABASE_URL || env.VITE_FIREBASE_DATABASE_URL || "";

  // Auto-infer projectId from databaseURL if missing
  if (!projectId && databaseURL) {
    const match = databaseURL.match(/https:\/\/(.*?)-default-rtdb/);
    if (match && match[1]) {
      projectId = match[1];
    }
  }

  const finalDatabaseURL = databaseURL || (projectId ? `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app` : "");

  const config = {
    apiKey: apiKey,
    authDomain: projectId ? projectId + '.firebaseapp.com' : '',
    databaseURL: finalDatabaseURL,
    projectId: projectId,
    storageBucket: projectId ? projectId + '.appspot.com' : '',
    messagingSenderId: "123456789012",
    appId: "1:123456789012:web:abcdef1234567890"
  };

  return new Response(JSON.stringify(config), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
