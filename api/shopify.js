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
const sleep = ms => new Promise(r => setTimeout(r, ms));
// gql with automatic backoff on Shopify THROTTLED.
async function gqlR(query, variables) {
  for (let i = 0; i < 7; i++) {
    const r = await gql(query, variables);
    const thr = r.j && r.j.errors && JSON.stringify(r.j.errors).indexOf('THROTTLED') !== -1;
    if (!thr) return r;
    await sleep(800 + i * 600);
  }
  return await gql(query, variables);
}

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
      const n = Math.min(parseInt(q.n || '40', 10), 100);
      const CONC = Math.min(parseInt(q.conc || '3', 10), 6);
      let cursor = q.cursor || null;
      const t0 = Date.now();
      let seen = 0, pricedChanged = 0, published = 0, errs = [];
      let done = false;
      // One product's work (price then publish), each call throttle-retried.
      async function work(node) {
        const v = node.variants.edges[0] && node.variants.edges[0].node;
        const target = price[node.handle];
        if (!target) return;
        if (doPrice && v && Number(v.price) !== Number(target.price)) {
          if (dry) pricedChanged++;
          else {
            const m = await gqlR(
              `mutation($pid:ID!,$vid:ID!,$p:Money!){ productVariantsBulkUpdate(productId:$pid, variants:[{id:$vid, price:$p}]){ userErrors{ message } } }`,
              { pid: node.id, vid: v.id, p: String(target.price) }
            );
            const ue = m.j && m.j.data && m.j.data.productVariantsBulkUpdate && m.j.data.productVariantsBulkUpdate.userErrors;
            if (ue && ue.length) errs.push({ h: node.handle, e: ue[0].message });
            else if (m.j && m.j.errors) errs.push({ h: node.handle, e: 'gql:' + JSON.stringify(m.j.errors).slice(0, 60) });
            else pricedChanged++;
          }
        }
        if (doPub && node.status !== 'ACTIVE') {
          if (dry) published++;
          else {
            const m = await gqlR(
              `mutation($id:ID!){ productUpdate(input:{id:$id, status:ACTIVE}){ userErrors{ message } } }`,
              { id: node.id }
            );
            const ue = m.j && m.j.data && m.j.data.productUpdate && m.j.data.productUpdate.userErrors;
            if (ue && ue.length) errs.push({ h: node.handle, e: ue[0].message });
            else if (m.j && m.j.errors) errs.push({ h: node.handle, e: 'gql:' + JSON.stringify(m.j.errors).slice(0, 60) });
            else published++;
          }
        }
      }
      do {
        const { status, j } = await gqlR(PAGE_Q, { c: cursor, n });
        if (status !== 200 || !j.data) return res.status(200).json({ status, error: j.errors || j, at: cursor });
        const nodes = j.data.products.edges.map(e => e.node);
        seen += nodes.length;
        // Bounded-concurrency pool over the page's products.
        let idx = 0;
        await Promise.all(Array.from({ length: CONC }, async () => {
          while (idx < nodes.length) { const i = idx++; await work(nodes[i]); }
        }));
        cursor = j.data.products.pageInfo.hasNextPage ? j.data.products.edges.slice(-1)[0].cursor : null;
        if (!cursor) done = true;
      } while (!done && Date.now() - t0 < 50000);
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

    // Resolve one handle -> variant GID + numeric id.
    async function variantForHandle(handle) {
      const { j } = await gqlR(
        `query($q:String!){ products(first:1, query:$q){ edges{ node{ id handle variants(first:1){ edges{ node{ id } } } } } } }`,
        { q: 'handle:' + handle }
      );
      const node = j && j.data && j.data.products.edges[0] && j.data.products.edges[0].node;
      const vgid = node && node.variants.edges[0] && node.variants.edges[0].node.id;
      return vgid || null;
    }

    // Buy-now: 302 to the live Shopify cart permalink (Shop Pay available at checkout).
    if (action === 'checkout') {
      const handle = q.handle, qty = parseInt(q.qty || '1', 10) || 1;
      if (!handle) return res.status(400).json({ error: 'handle required' });
      const vgid = await variantForHandle(handle);
      if (!vgid) return res.status(404).json({ error: 'variant not found for handle', handle });
      const url = `https://${STORE}.myshopify.com/cart/${numId(vgid)}:${qty}`;
      res.writeHead(302, { Location: url });
      return res.end();
    }

    // Trunk hold: create a draft order (a quote/hold) for the selected frames.
    // params: handles=h1,h2,... email=... tier=standard|inner
    if (action === 'trunk') {
      const handles = String(q.handles || '').split(',').map(s => s.trim()).filter(Boolean);
      const email = q.email || null;
      const tier = q.tier === 'inner' ? 'inner' : 'standard';
      const limit = tier === 'inner' ? 5 : 3;
      if (!handles.length) return res.status(400).json({ error: 'handles required' });
      if (handles.length > limit) return res.status(400).json({ error: 'over tier limit', tier, limit, got: handles.length });
      const lineItems = [], missing = [];
      for (const h of handles) {
        const vgid = await variantForHandle(h);
        if (vgid) lineItems.push({ variantId: vgid, quantity: 1 }); else missing.push(h);
      }
      if (!lineItems.length) return res.status(404).json({ error: 'no variants resolved', missing });
      const input = {
        email: email || undefined,
        lineItems,
        tags: ['trunk', 'tier:' + tier],
        note: `Parasite Club USA home try-on trunk (${tier}, ${lineItems.length}/${limit} frames).`,
      };
      const { j } = await gqlR(
        `mutation($input:DraftOrderInput!){ draftOrderCreate(input:$input){ draftOrder{ id name invoiceUrl totalPrice } userErrors{ field message } } }`,
        { input }
      );
      const r = j && j.data && j.data.draftOrderCreate;
      if (!r || (r.userErrors && r.userErrors.length)) {
        return res.status(200).json({ ok: false, errors: (r && r.userErrors) || j.errors || j, missing });
      }
      return res.status(200).json({ ok: true, tier, limit, draft: r.draftOrder, missing });
    }

    return res.status(400).json({ error: 'unknown action', allowed: ['ping', 'summary', 'sync', 'variants', 'checkout', 'trunk'] });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
