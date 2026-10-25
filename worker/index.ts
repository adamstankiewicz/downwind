// Cloudflare Worker: serves /api/awc/* from aviationweather.gov and
// /api/docs/<id> from the FAA's handbook PDFs, both with edge caching, and
// reserves /api/llm for the paid-tier model gateway.
// Deploy with `npx wrangler deploy` from this folder.

import { DOCS } from '../src/refs/catalog';

const AWC = 'https://aviationweather.gov/api/data';
const CACHE_SECONDS = 120;
const FAA = 'https://www.faa.gov';
// A handbook edition does not change under its file name often; a week at the edge is plenty.
const DOC_CACHE_SECONDS = 7 * 24 * 60 * 60;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/awc/')) return proxyAwc(request, url);
    if (url.pathname.startsWith('/api/docs/')) return proxyDoc(request, url);
    if (url.pathname === '/api/llm') {
      return json({ error: 'The model gateway is not enabled yet.' }, 501);
    }
    return new Response('Not found', { status: 404 });
  },
};

async function proxyAwc(request: Request, url: URL): Promise<Response> {
  const product = url.pathname.replace('/api/awc/', '');
  if (!/^(metar|taf|pirep|airsigmet|gairmet|windtemp|airport)$/.test(product)) {
    return new Response('Unknown product', { status: 400 });
  }
  const upstream = `${AWC}/${product}${url.search}`;
  // caches.default is the Workers edge cache.
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(upstream, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(upstream, { headers: { 'User-Agent': 'downwind-ground-school' } });
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
  out.headers.set('Access-Control-Allow-Origin', '*');
  if (res.ok && request.method === 'GET') await cache.put(key, out.clone());
  return out;
}

// Only files in the catalog are served, so this is not an open proxy to faa.gov.
async function proxyDoc(request: Request, url: URL): Promise<Response> {
  const doc = DOCS[url.pathname.replace('/api/docs/', '')];
  if (!doc) return new Response('Unknown document', { status: 404 });
  const upstream = `${FAA}${doc.path}`;
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(upstream, { method: 'GET' });
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(upstream, { headers: { 'User-Agent': 'downwind-ground-school' } });
  if (!res.ok || !(res.headers.get('Content-Type') ?? '').includes('pdf')) {
    return new Response('The FAA did not return this document', { status: 502 });
  }
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', `public, max-age=${DOC_CACHE_SECONDS}`);
  out.headers.set('Access-Control-Allow-Origin', '*');
  if (request.method === 'GET') await cache.put(key, out.clone());
  return out;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
