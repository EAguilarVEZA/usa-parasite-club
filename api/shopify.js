// Vercel serverless — Shopify Admin GraphQL bridge for Parasite Club USA. (rev4 / sync+publish)
// Token lives ONLY in Vercel env (SHOPIFY_ADMIN_TOKEN). Store domain is public.
const STORE = process.env.SHOPIFY_STORE || 'hne7dx-gc';
const V = '2024-10';
const TOKEN = (process.env.SHOPIFY_ADMIN_TOKEN || '').trim();
const SITE = 'https://usa-parasite-club.vercel.app';

async function gql(query, variables) {
  const r = await fetch(`https://${STORE}.myshopify.com/admin/api/${V}/graphql.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch (_) { j = { raw: t.slice(0, 400) }; }
  return { status: r.status, j };
}
const numId = gid => (gid && String(gid).split('/').pop()) || null;

// Cache the price map (handle -> {price,name,brand,type}) across warm invocations.
let PRICE = null;
async function loadPrices() {
  if (PRICE) return PRICE;
  const r = await fetch(SITE + '/products.json');
  const d = await r.json();
  const m = {};
  d.forEach(p => { m[p.h] = { price: p.p, name: p.n, brand: p.b, type: p.t }; });
  PRICE = m;
  return PRICE;
}

const PAGE_Q = `query($c:String,$n:Int!){ products(first:$n, after:$c){ edges{ cursor node{ id handle title status variants(first:1){ edges{ node{ id price } } } } } pageInfo{ hasNextPage } } }`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!TOKEN) return res.status(500).json({ error: 'SHOPIFY_ADMIN_TOKEN not set' });

  const q = req.query || {};
  const action = q.action || 'ping';
  try {
    if (action === 'ping') {
      const { status, j } = await gql(`{ shop { name myshopifyDomain currencyCode } }`);
      const shop = j && j.data && j.data.shop;
      return res.status(200).json({ ok: !!shop, status, shop: shop || j, token: { present: !!TOKEN, len: TOKEN.length, prefix: TOKEN.slice(0, 5) } });
    }

    // Read-only health check: counts, match rate, price-mismatch count.
    if (action === 'summary') {
      const price = await loadPrices();
      let cursor = null, pages = 0;
      let total = 0, draft = 0, active = 0, matched = 0, mism = 0, noVar = 0;
      const unmatched = [], sample = [];
      do {
        const { status, j } = await gql(PAGE_Q, { c: cursor, n: 250 });
        if (status !== 200 || !j.data) return res.status(200).json({ status, error: j.errors || j });
        for (const e of j.data.products.edges) {
          const n = e.node, v = n.variants.edges[0] && n.variants.edges[0].node;
          total++;
          if (n.status === 'DRAFT') draft++; else if (n.status === 'ACTIVE') active++;
          if (!v) noVar++;
          const target = price[n.handle];
          if (target) {
            matched++;
            if (v && Number(v.price) !== Number(target.price)) {
              mism++;
              if (sample.length < 8) sample.push({ handle: n.handle, was: v.price, will: target.price });
            }
          } else if (unmatched.length < 12) unmatched.push({ handle: n.handle, title: n.title });
        }
        cursor = j.data.products.pageInfo.hasNextPage ? j.data.products.edges.slice(-1)[0].cursor : null;
      } while (cursor && ++pages < 6);
      return res.status(200).json({ total, draft, active, noVariant: noVar, matchedByHandle: matched, priceMismatch: mism, mismSample: sample, unmatchedSample: unmatched, mapSize: Object.keys(price).length });
    }

    // Mutating sync: price + optional publish, time-bounded, resumable via cursor.
    // params: dry=1|0 (default 1), publish=1|0 (default 0), prices=1|0 (default 1), cursor, n (page size)
    if (action === 'sync') {
      const price = await loadPrices();
      const dry = q.dry !== '0';
      const doPub = q.publish === '1';
      const doPrice = q.prices !== '0';
      const n = Math.min(parseInt(q.n || '20', 10), 50);
      let cursor = q.cursor || null;
      const t0 = Date.now();
      let seen = 0, pricedChanged = 0, published = 0, errs = [];
      let done = false;
      do {
        const { status, j } = await gql(PAGE_Q, { c: cursor, n });
        if (status !== 200 || !j.data) return res.status(200).json({ status, error: j.errors || j, at: cursor });
        for (const e of j.data.products.edges) {
          const node = e.node, v = node.variants.edges[0] && node.variants.edges[0].node;
          const target = price[node.handle];
          seen++;
          if (!target) continue;
          if (doPrice && v && Number(v.price) !== Number(target.price)) {
            if (dry) pricedChanged++;
            else {
              const m = await gql(
                `mutation($pid:ID!,$vid:ID!,$p:Money!){ productVariantsBulkUpdate(productId:$pid, variants:[{id:$vid, price:$p}]){ userErrors{ message } } }`,
                { pid: node.id, vid: v.id, p: String(target.price) }
              );
              const ue = m.j && m.j.data && m.j.data.productVariantsBulkUpdate && m.j.data.productVariantsBulkUpdate.userErrors;
              if (ue && ue.length) errs.push({ h: node.handle, e: ue[0].message }); else pricedChanged++;
            }
          }
          if (doPub && node.status !== 'ACTIVE') {
            if (dry) published++;
            else {
              const m = await gql(
                `mutation($id:ID!){ productUpdate(input:{id:$id, status:ACTIVE}){ userErrors{ message } } }`,
                { id: node.id }
              );
              const ue = m.j && m.j.data && m.j.data.productUpdate && m.j.data.productUpdate.userErrors;
              if (ue && ue.length) errs.push({ h: node.handle, e: ue[0].message }); else published++;
            }
          }
        }
        cursor = j.data.products.pageInfo.hasNextPage ? j.data.products.edges.slice(-1)[0].cursor : null;
        if (!cursor) done = true;
      } while (!done && Date.now() - t0 < 45000);
      return res.status(200).json({ dry, doPrice, doPub, seen, pricedChanged, published, done, nextCursor: done ? null : cursor, errs: errs.slice(0, 10) });
    }

    if (action === 'variants') {
      let cursor = null, out = [], pages = 0;
      do {
        const { status, j } = await gql(PAGE_Q, { c: cursor, n: 250 });
        if (status !== 200 || !j.data) return res.status(200).json({ status, error: j.errors || j });
        j.data.products.edges.forEach(e => {
          const node = e.node, v = node.variants.edges[0] && node.variants.edges[0].node;
          out.push({ pid: numId(node.id), handle: node.handle, title: node.title, status: node.status, vid: v && numId(v.id), price: v && v.price });
        });
        cursor = j.data.products.pageInfo.hasNextPage ? j.data.products.edges.slice(-1)[0].cursor : null;
      } while (cursor && ++pages < 6);
      return res.status(200).json({ count: out.length, draft: out.filter(p => p.status === 'DRAFT').length, products: out });
    }

    return res.status(400).json({ error: 'unknown action', allowed: ['ping', 'summary', 'sync', 'variants'] });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
