import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const extractHeaderBlock = (content: string, route: string): string => {
  const marker = `for = "${route}"`;
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) return '';
  const nextBlockIndex = content.indexOf('[[headers]]', markerIndex);
  return content.slice(markerIndex, nextBlockIndex < 0 ? content.length : nextBlockIndex);
};

describe('netlify security headers', () => {
  it('keeps CSP compatible with Google Auth (fonts bundled locally)', () => {
    const content = readFileSync('netlify.toml', 'utf-8');

    expect(content).toContain('Content-Security-Policy');
    expect(content).toContain('https://apis.google.com');
    expect(content).toContain('https://accounts.google.com');
    expect(content).toContain('https://www.gstatic.com');
    expect(content).toContain('https://*.cloudfunctions.net');
    expect(content).toContain("worker-src 'self' blob:");
    expect(content).not.toContain('https://fonts.googleapis.com');
    expect(content).not.toContain('https://fonts.gstatic.com');
  });

  it('keeps the SPA shell strict while only allowing the legacy offline page inline script', () => {
    const content = readFileSync('netlify.toml', 'utf-8');

    expect(content).toContain(
      "script-src 'self' https://apis.google.com https://www.gstatic.com https://accounts.google.com;"
    );
    expect(content).toContain('for = "/offline.html"');
    expect(content).toContain("script-src 'self' 'unsafe-inline' https:;");
  });

  it('isolates document scanner camera and WebAssembly permissions to its public route', () => {
    const content = readFileSync('netlify.toml', 'utf-8');
    const scannerMarkerIndex = content.indexOf('for = "/documentos/escanear-demo*"');
    const workerMarkerIndex = content.indexOf('for = "/document-scanner/jscanify-worker.js"');
    const catchAllMarkerIndex = content.indexOf('for = "/*"');
    const scannerHeaders = extractHeaderBlock(content, '/documentos/escanear-demo*');
    const workerHeaders = extractHeaderBlock(content, '/document-scanner/jscanify-worker.js');

    expect(scannerMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(workerMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(catchAllMarkerIndex).toBeGreaterThanOrEqual(0);
    expect(scannerMarkerIndex).toBeLessThan(catchAllMarkerIndex);
    expect(workerMarkerIndex).toBeLessThan(catchAllMarkerIndex);
    expect(content).toContain('Permissions-Policy = "camera=(),');
    expect(scannerHeaders).toContain('Permissions-Policy = "camera=(self),');
    expect(scannerHeaders).toContain(
      "script-src 'self' blob: 'wasm-unsafe-eval' https://cdn.jsdelivr.net"
    );
    expect(scannerHeaders).toContain("worker-src 'self' blob: data:");
    expect(workerHeaders).toContain("script-src blob: 'unsafe-eval' 'wasm-unsafe-eval'");
    expect(workerHeaders).toContain('Cache-Control = "no-cache"');
    expect(workerHeaders).not.toContain('Permissions-Policy = "camera=(self),');
    expect(workerHeaders).not.toContain("worker-src 'self' blob: data:");
    expect(scannerHeaders).toContain('X-Content-Type-Options = "nosniff"');
    expect(scannerHeaders).toContain('Strict-Transport-Security');
  });

  it('keeps COOP mode compatible with popup login flow', () => {
    const content = readFileSync('netlify.toml', 'utf-8');
    expect(content).toContain('Cross-Origin-Opener-Policy = "unsafe-none"');
  });

  it('keeps the SPA rewrite so refresh works on clean module routes', () => {
    const content = readFileSync('netlify.toml', 'utf-8');
    expect(content).toContain('[[redirects]]');
    expect(content).toContain('from = "/*"');
    expect(content).toContain('to = "/index.html"');
    expect(content).toContain('status = 200');
  });

  it('prevents caching for service worker entrypoints used across deploys', () => {
    const content = readFileSync('netlify.toml', 'utf-8');

    expect(content).toContain('for = "/sw.js"');
    expect(content).toContain('for = "/service-worker.js"');
    expect(content).toContain('for = "/registerSW.js"');
    expect(content).toContain('Cache-Control = "no-cache, no-store, must-revalidate"');
  });

  it('keeps PWA registration external so the strict SPA CSP can block inline scripts', () => {
    const content = readFileSync('vite.config.ts', 'utf-8');

    expect(content).toContain("injectRegister: 'script'");
    expect(content).not.toContain("injectRegister: 'auto'");
  });

  it('loads the startup surface script as an external asset under the strict SPA CSP', () => {
    const content = readFileSync('index.html', 'utf-8');

    expect(content).toContain('<script src="/startup-surface.js"></script>');
    expect(content).not.toContain('<script>\n');
  });

  it('does not route third-party tracking pixels through the service worker image cache', () => {
    const content = readFileSync('src/service-worker.ts', 'utf-8');

    expect(content).toContain('url.origin === self.location.origin');
    expect(content).toContain("request.destination === 'image'");
  });
});
