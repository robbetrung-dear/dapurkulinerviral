/**
 * functions/api/send-wa.js
 * Cloudflare Pages Function — WhatsApp Gateway Proxy & Notification Logger
 */

export async function onRequest(context) {
  const { request, env } = context;
  const method = request.method;

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  const dbUrl = (env.FIREBASE_DATABASE_URL || "https://digitalculinary-app-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/$/, "");
  const apiKey = env.FIREBASE_API_KEY || "";
  const authParam = apiKey ? `?auth=${encodeURIComponent(apiKey)}` : "";

  try {
    const body = await request.json().catch(() => ({}));
    let phone = String(body.phone || '').trim().replace(/[^0-9]/g, '');
    const message = String(body.message || '').trim();
    const template = body.template || 'custom';
    // FASE 5 RTO: kunci log deterministik untuk idempotency — /notifications_log/{orderId}_wa_{status}
    const logIdRaw = body.logId ? String(body.logId).trim().replace(/[^A-Za-z0-9_.-]/g, '_') : '';

    if (!phone || !message) {
      return new Response(JSON.stringify({ success: false, error: 'phone dan message wajib diisi' }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" }
      });
    }

    // Normalisasi nomor telepon: jika mulai '08' -> ganti jadi '628'
    if (phone.startsWith('08')) {
      phone = '62' + phone.slice(1);
    }

    // Ambil konfigurasi WhatsApp dari site_config
    let waConfig = { waEnabled: false, waGatewayUrl: '', waSenderNumber: '', fonnteToken: '' };
    try {
      const cfgRes = await fetch(`${dbUrl}/site_config.json${authParam}`);
      const cfg = await cfgRes.json();
      if (cfg) {
        waConfig.waEnabled = Boolean(cfg.waEnabled);
        waConfig.waGatewayUrl = (cfg.waGatewayUrl || '').replace(/\/$/, '');
        waConfig.waSenderNumber = cfg.waSenderNumber || '';
        waConfig.fonnteToken = cfg.fonnteToken || '';
      }
    } catch (e) {
      // fallback jika gagal fetch config
    }

    // FASE 5: provider Fonnte (production) — token dari env, fallback site_config
    const fonnteToken = String(env.WA_FONNTE_TOKEN || env.FONNTE_TOKEN || waConfig.fonnteToken || '').trim();
    const gatewayConfigured = Boolean(fonnteToken || (waConfig.waEnabled && waConfig.waGatewayUrl));

    // FASE 5: idempotency — kalau log untuk key ini sudah ada, jangan kirim ulang
    if (logIdRaw) {
      try {
        const existRes = await fetch(`${dbUrl}/notifications_log/${encodeURIComponent(logIdRaw)}.json${authParam}`);
        const exist = await existRes.json();
        if (exist) {
          return new Response(JSON.stringify({
            success: true, skipped: true, duplicate: true, logId: logIdRaw,
            status: (exist && exist.status) || 'duplicate',
            provider: (exist && exist.provider) || 'none',
            phone, messageId: (exist && exist.messageId) || '', waLink: '',
            gatewayConfigured
          }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
      } catch (e) {
        // kalau gagal cek, lanjut kirim (log tetap ditulis setelah kirim)
      }
    }

    let gatewayResult = null;
    let sendStatus = 'simulated';
    let provider = 'none';
    const messageId = `wa_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const logId = logIdRaw || `notif_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    // Penanda awal anti dobel kirim (di-update lagi setelah hasil kirim diketahui)
    if (logIdRaw) {
      await fetch(`${dbUrl}/notifications_log/${encodeURIComponent(logId)}.json${authParam}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: logId, at: new Date().toISOString(), phone, template,
          status: 'sending', messagePreview: message.slice(0, 100), messageId
        })
      }).catch(() => {});
    }

    if (fonnteToken) {
      // FASE 5: produksi pakai Fonnte API
      provider = 'fonnte';
      try {
        const form = new URLSearchParams();
        form.append('target', phone);
        form.append('message', message);
        form.append('countryCode', '62');
        const fRes = await fetch('https://api.fonnte.com/send', {
          method: 'POST',
          headers: {
            'Authorization': fonnteToken,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: form.toString()
        });
        gatewayResult = await fRes.json().catch(() => null);
        // Fonnte membalas HTTP 200 walau token invalid (body: {"status":false,"reason":"invalid token"})
        const fonnteOk = fRes.ok && !(gatewayResult && gatewayResult.status === false);
        sendStatus = fonnteOk ? 'sent' : (fRes.ok ? 'failed_gateway' : 'failed_http');
      } catch (gwErr) {
        gatewayResult = { error: gwErr.message };
        sendStatus = 'fonnte_error';
      }
    } else if (waConfig.waEnabled && waConfig.waGatewayUrl) {
      provider = 'gateway';
      try {
        // Kirim request ke HTTP Gateway (WAHA / Baileys endpoint)
        const gwRes = await fetch(`${waConfig.waGatewayUrl}/api/send-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone: phone.includes('@') ? phone : `${phone}@c.us`,
            message,
            chatId: phone.includes('@') ? phone : `${phone}@c.us`,
            text: message
          })
        });
        gatewayResult = await gwRes.json().catch(() => null);
        sendStatus = gwRes.ok ? 'sent' : 'failed';
      } catch (gwErr) {
        gatewayResult = { error: gwErr.message };
        sendStatus = 'gateway_error';
      }
    } else {
      // Belum ada kredensial Fonnte / gateway -> dicatat sebagai ready (belum terkirim)
      sendStatus = 'ready_for_web';
    }

    // Catat ke /notifications_log (id deterministik saat caller mengirim logId)
    const logPayload = {
      id: logId,
      at: new Date().toISOString(),
      phone,
      template,
      provider,
      messagePreview: message.slice(0, 100),
      status: sendStatus,
      messageId,
      gatewayResponse: gatewayResult
    };

    await fetch(`${dbUrl}/notifications_log/${encodeURIComponent(logId)}.json${authParam}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logPayload)
    }).catch(() => {});

    return new Response(JSON.stringify({
      success: true,
      skipped: false,
      messageId,
      status: sendStatus,
      provider,
      logId,
      phone,
      waLink: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
      gatewayConfigured
    }), {
      headers: { ...cors, "Content-Type": "application/json" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }
}
