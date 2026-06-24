// Vercel serverless — Shopify Admin GraphQL bridge for Parasite Club USA. (rev3 / GraphQL)
// Token lives ONLY in Vercel env (SHOPIFY_ADMIN_TOKEN). Store domain is public.
// New Shopify apps are GraphQL-only, so we use the GraphQL Admin API.
const STORE = process.env.SHOPIFY_STORE || 'hne7dx-gc';
const V = '2024-10';
const TOKEN = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim();

async function gql(query, variables) {
  const r = await fetch(`https://${STORE}.myshopify.com/admin/api/${V}/graphql.json`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t.slice(0, 400) }; }
  return { status: r.status, j };
}
const numId = gid => (gid && String(gid).split('/').pop()) || null;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!TOKEN) return res.status(500).json({ error: 'SHOPIFY_ADMIN_TOKEN not set' });

  const action = (req.query && req.query.action) || 'ping';
  try {
    if (action === 'ping') {
      const { status, j } = await gql(`{ shop { name myshopifyDomain currencyCode } }`);
      const shop = j && j.data && j.data.shop;
      return res.status(200).json({ ok: !!shop, status, shop: shop || j, token: { present: !!TOKEN, len: TOKEN.length, prefix: TOKEN.slice(0, 5) } });
    }
    if (action === 'variants') {
      let cursor = null, out = [], pages = 0;
      do {
        const { status, j } = await gql(
          `query($c:String){ products(first:250, after:$c){ edges{ cursor node{ id handle title status variants(first:1){ edges{ node{ id price } } } } } pageInfo{ hasNextPage } } }`,
          { c: cursor }
        );
        if (status !== 200 || !j.data) return res.status(200).json({ status, error: j.errors || j });
        const edges = j.data.products.edges;
        edges.forEach(e => {
          const n = e.node, v = n.variants.edges[0] && n.variants.edges[0].node;
          out.push({ pid: numId(n.id), handle: n.handle, title: n.title, status: n.status, vid: v && numId(v.id), price: v && v.price });
        });
        cursor = edges.length ? edges[edges.length - 1].cursor : null;
        if (!j.data.products.pageInfo.hasNextPage) cursor = null;
      } while (cursor && ++pages < 6);
      const draft = out.filter(p => p.status === 'DRAFT').length;
      return res.status(200).json({ count: out.length, draft, products: out });
    }
    return res.status(400).json({ error: 'unknown action', allowed: ['ping', 'variants'] });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
