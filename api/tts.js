// Vercel serverless TTS — proxies Fish Audio (Adrian) so the API key stays server-side.
// Set FISH_API_KEY (and optionally ADRIAN_MODEL_ID, FISH_MODEL) in Vercel → Project → Settings → Environment Variables.
const { encode } = require('@msgpack/msgpack');
const API_KEY = process.env.FISH_API_KEY || '';
const ADRIAN  = process.env.ADRIAN_MODEL_ID || 'bf322df2096a46f18c579d0baa36f41d';
const FISH_MODEL = process.env.FISH_MODEL || 's1';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).end('POST only'); return; }
  try {
    if (!API_KEY) { res.status(500).end('Missing FISH_API_KEY'); return; }
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
    const text = body && body.text;
    if (!text) { res.status(400).end('No text'); return; }
    const payload = encode({ text, reference_id: ADRIAN, format: 'mp3', mp3_bitrate: 128, normalize: true, latency: 'normal' });
    const r = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/msgpack', 'model': FISH_MODEL },
      body: payload,
    });
    if (!r.ok) { const t = await r.text(); res.status(r.status).end('Fish Audio error: ' + t); return; }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.status(200).send(buf);
  } catch (e) { res.status(500).end('Proxy error: ' + e.message); }
};
