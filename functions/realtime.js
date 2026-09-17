/**
 * functions/realtime.js - Cloudflare Pages Function & Durable Object
 * Handler WebSocket & Realtime Synchronization untuk update pesanan seketika.
 * Alternatif / pelengkap Firebase Realtime Database langsung di edge network Cloudflare.
 */

// Cloudflare Durable Object Class untuk sinkronisasi state order lintas sesi
export class OrderSyncSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Set();
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Endpoint upgrade WebSocket
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      server.accept();
      this.sessions.add(server);

      server.addEventListener("message", async (event) => {
        try {
          const data = JSON.parse(event.data);
          // Broadcast perubahan status order ke seluruh client yang terhubung
          this.broadcast(JSON.stringify({
            type: "ORDER_STATUS_UPDATED",
            order_id: data.order_id,
            status: data.status,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.warn("WebSocket parse error:", e);
        }
      });

      server.addEventListener("close", () => {
        this.sessions.delete(server);
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP Broadcast fallback
    if (request.method === "POST") {
      const data = await request.json();
      this.broadcast(JSON.stringify(data));
      return new Response(JSON.stringify({ success: true, clients: this.sessions.size }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    return new Response("Durable Object Realtime Order Worker Active", { status: 200 });
  }

  broadcast(message) {
    for (const session of this.sessions) {
      try {
        session.send(message);
      } catch (err) {
        this.sessions.delete(session);
      }
    }
  }
}

// Pages Function onRequest router untuk Durable Object
export async function onRequest(context) {
  const { request, env } = context;

  // Jika Durable Object binding tersedia di Cloudflare
  if (env.ORDER_SYNC) {
    const id = env.ORDER_SYNC.idFromName("global_orders");
    const obj = env.ORDER_SYNC.get(id);
    return obj.fetch(request);
  }

  // Fallback SSE (Server-Sent Events) jika Durable Object belum diaktifkan
  return new Response(JSON.stringify({
    message: "Cloudflare Realtime Endpoint Ready. Gunakan Firebase Realtime Database SDK untuk sinkronisasi default client-side.",
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
