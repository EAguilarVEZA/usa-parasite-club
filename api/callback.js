// Vercel serverless — Step 2 of Shopify OAuth: exchange code for the real Admin API token. (rev2)
// Needs SHOPIFY_CLIENT_SECRET in Vercel env (the app's Client secret from the Dev Dashboard).
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || 'b6ae2108ce4b2a032292e1ea105d67ab';
const CLIENT_SECRET = (process.env.SHOPIFY_CLIENT_SECRET || '').trim();

module.exports = async (req, res) => {
  const q = req.query || {};
  const shop = q.shop, code = q.code;
  if (!shop || !code) return res.status(400).send('Missing shop or code. Start at /api/auth');
  if (!CLIENT_SECRET) return res.status(500).send('SHOPIFY_CLIENT_SECRET is not set in Vercel.');
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code }),
    });
    const j = await r.json();
    if (!j.access_token) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(200).send('<pre style="font-family:monospace;padding:24px">Token exchange failed:\n' + JSON.stringify(j, null, 2) + '</pre>');
    }
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`<!doctype html><body style="font-family:ui-monospace,monospace;background:#0a0a0c;color:#fff;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.6">
      <h2 style="color:#C8FF00">✅ Admin API token captured</h2>
      <p>Copy the token below and paste it into <b>Vercel → Environment Variables → SHOPIFY_ADMIN_TOKEN</b> (replace the old value), then redeploy. This is a long‑lived offline token — keep it secret.</p>
      <textarea readonly onclick="this.select()" style="width:100%;height:90px;font-size:14px;background:#101218;color:#C8FF00;border:1px solid #C8FF00;border-radius:8px;padding:12px">${j.access_token}</textarea>
      <p style="color:#888;font-size:13px">Scopes granted: ${j.scope || '(see app config)'}</p>
    </body>`);
  } catch (e) {
    return res.status(500).send(String(e));
  }
};
