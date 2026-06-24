// Vercel serverless — Shopify Admin API bridge for Parasite Club USA. (rev2)
// Token lives ONLY in Vercel env (SHOPIFY_ADMIN_TOKEN). Store domain is public.
// Actions (?action=): ping | variants | sync | trunk
const STORE = process.env.SHOPIFY_STORE || 'hne7dx-gc';
const V = '2024-10';
const TOKEN = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim();

async function sf(path, method = 'GET', body = null) {
  const r = await fetch(`https://${STORE}.myshopify.com/admin/api/${V}/${path}`, {
    method,
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t.slice(0, 400) }; }
  return { status: r.status, headers: r.headers, json: j };
}

async function allProducts() {
  let path = `products.json?limit=250`, out = [];
  for (let i = 0; i < 4; i++) {
    const r = await sf(path);
    if (r.status !== 200) return { error: r.status, detail: r.json };
    (r.json.products || []).forEach(p => {
      const v = p.variants && p.variants[0];
      out.push({ id: p.id, handle: p.handle, title: p.title, status: p.status, vid: v && Number(v.id), price: v && v.price });
    });
    const link = r.headers.get('link') || '';
    const m = link.match(/[?&]page_info=([^>&]+)>;\s*rel="next"/);
    if (!m) break;
    path = `products.json?limit=250&page_info=${m[1]}`;
  }
  return { products: out };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!TOKEN) return res.status(500).json({ error: 'SHOPIFY_ADMIN_TOKEN not set' });

  const action = (req.query && req.query.action) || 'ping';
  try {
    if (action === 'ping') {
      const { status, json } = await sf('shop.json');
      return res.status(200).json({
        ok: status === 200, status,
        shop: json.shop ? { name: json.shop.name, domain: json.shop.myshopify_domain, currency: json.shop.currency, plan: json.shop.plan_name } : json,
      });
    }
    if (action === 'variants') {
      const r = await allProducts();
      if (r.error) return res.status(200).json(r);
      const draft = r.products.filter(p => p.status === 'draft').length;
      return res.status(200).json({ count: r.products.length, draft, products: r.products });
    }
    return res.status(400).json({ error: 'unknown action', allowed: ['ping', 'variants'] });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
