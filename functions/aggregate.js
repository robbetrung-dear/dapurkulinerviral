const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return new Response(JSON.stringify({ success: true, message: 'Aggregate OK' }), {
    status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
