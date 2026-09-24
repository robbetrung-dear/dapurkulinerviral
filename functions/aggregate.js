/**
 * functions/aggregate.js
 * Cloudflare Pages Function — no-op endpoint untuk /aggregate
 * Karena aggregation sudah dilakukan di /accounting/journal/pos
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request } = context;
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  
  // Accept POST & return success — aggregation handled by /accounting/journal/pos
  return new Response(JSON.stringify({
    success: true,
    message: 'Aggregate endpoint OK (handled by /accounting/journal/pos)',
    timestamp: Date.now()
  }), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
