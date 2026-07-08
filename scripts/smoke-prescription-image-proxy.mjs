#!/usr/bin/env node
import http from 'node:http';

const baseUrl = process.env.HHR_PRESCRIPTION_IMAGE_PROXY_BASE_URL || 'http://localhost:3021';
const fixtureSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="#ffffff"/>
  <rect x="64" y="64" width="1072" height="772" fill="#f8fafc" stroke="#0f172a" stroke-width="12"/>
  <text x="112" y="180" font-family="Arial, Helvetica, sans-serif" font-size="72" font-weight="700" fill="#0f172a">Receta fixture</text>
  <text x="112" y="300" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#334155">Smoke proxy imagen receta</text>
  <line x1="112" y1="420" x2="960" y2="420" stroke="#475569" stroke-width="10"/>
  <line x1="112" y1="520" x2="820" y2="520" stroke="#475569" stroke-width="10"/>
  <line x1="112" y1="620" x2="900" y2="620" stroke="#475569" stroke-width="10"/>
</svg>`;

const listen = server =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });

const close = server =>
  new Promise(resolve => {
    server.close(resolve);
  });

const fail = message => {
  throw new Error(`[prescription-image-proxy-smoke] ${message}`);
};

const fixtureServer = http.createServer((request, response) => {
  if (request.url !== '/prescription-fixture.svg') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'image/svg+xml; charset=utf-8',
  });
  response.end(fixtureSvg);
});

try {
  const address = await listen(fixtureServer);
  const fixtureUrl = `http://127.0.0.1:${address.port}/prescription-fixture.svg`;
  const proxyUrl = new URL('/.netlify/functions/prescription-image-proxy', baseUrl);
  proxyUrl.searchParams.set('url', fixtureUrl);
  proxyUrl.searchParams.set('w', '760');
  proxyUrl.searchParams.set('q', '58');

  const response = await fetch(proxyUrl, {
    headers: { Origin: baseUrl },
  });

  if (!response.ok) {
    fail(`proxy responded ${response.status} ${await response.text()}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const optimizationStatus = response.headers.get('x-prescription-image-optimization') || '';
  const bytes = Buffer.from(await response.arrayBuffer());

  if (!contentType.includes('image/jpeg')) {
    fail(`expected image/jpeg response, got ${contentType || '(empty)'}`);
  }
  if (optimizationStatus !== 'optimized') {
    fail(`expected optimized header, got ${optimizationStatus || '(empty)'}`);
  }
  if (bytes.length === 0) {
    fail('proxy returned an empty image body');
  }

  console.log(
    `[prescription-image-proxy-smoke] OK ${bytes.length} bytes (${optimizationStatus}) via ${proxyUrl.origin}`
  );
} finally {
  await close(fixtureServer);
}
