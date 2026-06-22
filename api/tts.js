// Vercel serverless TTS for Adrian — supports two providers so we can A/B the voice.
//   provider = "eleven"  → ElevenLabs   (most human / premium)
//   provider = "fish"    → Fish Audio   (cheaper, current Adrian clone)
// Pick with: request body { provider }, else env TTS_PROVIDER, else auto (eleven if its key is set).
// Keys live ONLY in Vercel env vars — never in the page.
const { encode } = require('@msgpack/msgpack');

// Fish Audio
const FISH_KEY   = process.env.FISH_API_KEY || '';
const FISH_MODEL = process.env.FISH_MODEL || 's1';
const ADRIAN     = process.env.ADRIAN_MODEL_ID || 'bf322df2096a46f18c579d0baa36f41d';

// ElevenLabs (set ELEVENLABS_API_KEY; optionally ELEVENLABS_VOICE_ID for a custom "Adrian")
const ELEVEN_KEY   = process.env.ELEVENLABS_API_KEY || '';
const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'; // default male preset; override with your Adrian voice
const ELEVEN_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_turbo_v2_5';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).end('POST only'); return; }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
    if (!body) body = {};
    const text = body.text;
    if (!text) { res.status(400).end('No text'); return; }

    const provider = (body.provider || process.env.TTS_PROVIDER || (ELEVEN_KEY ? 'eleven' : 'fish')).toLowerCase();

    let buf;
    if (provider === 'eleven') {
      if (!ELEVEN_KEY) { res.status(500).end('Missing ELEVENLABS_API_KEY'); return; }
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': ELEVEN_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: ELEVEN_MODEL,
          voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.3, use_speaker_boost: true }
        }),
      });
      if (!r.ok) { const t = await r.text(); res.status(r.status).end('ElevenLabs error: ' + t); return; }
      buf = Buffer.from(await r.arrayBuffer());
    } else {
      if (!FISH_KEY) { res.status(500).end('Missing FISH_API_KEY'); return; }
      const payload = encode({ text, reference_id: ADRIAN, format: 'mp3', mp3_bitrate: 128, normalize: true, latency: 'normal' });
      const r = await fetch('https://api.fish.audio/v1/tts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${FISH_KEY}`, 'Content-Type': 'application/msgpack', 'model': FISH_MODEL },
        body: payload,
      });
      if (!r.ok) { const t = await r.text(); res.status(r.status).end('Fish Audio error: ' + t); return; }
      buf = Buffer.from(await r.arrayBuffer());
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-TTS-Provider', provider);
    res.status(200).send(buf);
  } catch (e) {
    res.status(500).end('Proxy error: ' + e.message);
  }
};
