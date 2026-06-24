// Vercel serverless — Step 1 of Shopify OAuth: redirect merchant to authorize.
// Visit https://usa-parasite-club.vercel.app/api/auth to start.
const STORE = process.env.SHOPIFY_STORE || 'hne7dx-gc';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || 'b6ae2108ce4b2a032292e1ea105d67ab';
const SCOPES = 'read_products,write_products,read_orders,write_orders,read_draft_orders,write_draft_orders';
const REDIRECT = 'https://usa-parasite-club.vercel.app/api/callback';

module.exports = (req, res) => {
  const shop = (req.query && req.query.shop) || (STORE + '.myshopify.com');
  const state = Math.random().toString(36).slice(2);
  const url = `https://${shop}/admin/oauth/authorize?client_id=${CLIENT_ID}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
    `&state=${state}`;
  res.writeHead(302, { Location: url });
  res.end();
};
