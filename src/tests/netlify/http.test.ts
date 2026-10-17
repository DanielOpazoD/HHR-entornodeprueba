import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHeader,
  getRequestOrigin,
  resolveAllowedOrigins,
  isOriginAllowed,
  buildCorsHeaders,
  buildJsonResponse,
  buildTextResponse,
  getClientIp,
  isRateLimited,
  buildTooManyRequestsResponse,
  parseJsonBody,
} from '../../../netlify/functions/lib/http';

describe('http utilities', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      DEPLOY_PRIME_URL: 'https://deploy-preview--app.netlify.app',
      DEPLOY_URL: '',
      SITE_URL: '',
      APP_URL: '',
      SITE_NAME: '',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /* ── getHeader ───────────────────────────────────────────────────────── */

  describe('getHeader', () => {
    it('returns the header value with exact case match', () => {
      expect(getHeader({ 'Content-Type': 'application/json' }, 'Content-Type')).toBe(
        'application/json'
      );
    });

    it('performs case-insensitive lookup', () => {
      expect(getHeader({ 'content-type': 'text/plain' }, 'Content-Type')).toBe('text/plain');
    });

    it('returns undefined for missing headers', () => {
      expect(getHeader({ accept: 'text/html' }, 'Authorization')).toBeUndefined();
    });

    it('returns undefined when headers object is undefined', () => {
      expect(getHeader(undefined, 'Content-Type')).toBeUndefined();
    });
  });

  /* ── getRequestOrigin ────────────────────────────────────────────────── */

  describe('getRequestOrigin', () => {
    it('extracts the origin header from the event', () => {
      expect(getRequestOrigin({ headers: { origin: 'https://app.example.com' } })).toBe(
        'https://app.example.com'
      );
    });

    it('returns undefined when origin header is absent', () => {
      expect(getRequestOrigin({ headers: {} })).toBeUndefined();
    });
  });

  /* ── resolveAllowedOrigins ───────────────────────────────────────────── */

  describe('resolveAllowedOrigins', () => {
    it('reads origins from URL and DEPLOY_PRIME_URL env vars', () => {
      const origins = resolveAllowedOrigins();
      expect(origins).toContain('https://app.example.com');
      expect(origins).toContain('https://deploy-preview--app.netlify.app');
    });

    it('normalizes URLs to origins (strips path/trailing slash)', () => {
      process.env.URL = 'https://app.example.com/some/path';
      const origins = resolveAllowedOrigins();
      expect(origins).toContain('https://app.example.com');
    });

    it('filters out empty or invalid values', () => {
      process.env.URL = '';
      process.env.DEPLOY_PRIME_URL = 'not-a-url';
      process.env.DEPLOY_URL = '';
      process.env.SITE_URL = '';
      process.env.APP_URL = '';
      expect(resolveAllowedOrigins()).toEqual([]);
    });
  });

  /* ── isOriginAllowed ─────────────────────────────────────────────────── */

  describe('isOriginAllowed', () => {
    it('returns true for an allowed origin', () => {
      expect(isOriginAllowed('https://app.example.com')).toBe(true);
    });

    it('accepts this site deploy previews without build-only environment variables', () => {
      process.env.SITE_NAME = 'synthetic-hhr';
      delete process.env.DEPLOY_PRIME_URL;
      delete process.env.DEPLOY_URL;
      for (const number of [1, 874, 1000, 1001]) {
        const origin = `https://deploy-preview-${number}--synthetic-hhr.netlify.app`;
        expect(isOriginAllowed(origin)).toBe(true);
        expect(buildCorsHeaders(origin)['Access-Control-Allow-Origin']).toBe(origin);
      }
    });

    it('requires the server-provided site identity to accept a preview', () => {
      delete process.env.SITE_NAME;
      expect(isOriginAllowed('https://deploy-preview-874--synthetic-hhr.netlify.app')).toBe(false);
    });

    it.each([
      'https://deploy-preview-874--other-site.netlify.app',
      'https://deploy-preview-874--synthetic-hhr-evil.netlify.app',
      'https://deploy-preview-874--synthetic-hhr.netlify.app.evil.example',
      'http://deploy-preview-874--synthetic-hhr.netlify.app',
      'https://deploy-preview-874--synthetic-hhr.netlify.app:444',
      'https://deploy-preview-874--synthetic-hhr.netlify.app/path',
      'https://deploy-preview-874--synthetic-hhr.netlify.app?query=1',
      'https://deploy-preview-874--synthetic-hhr.netlify.app#fragment',
      'https://deploy-preview-874--synthetic-hhr.netlify.app\n',
      'https://user@deploy-preview-874--synthetic-hhr.netlify.app',
      'https://feature--synthetic-hhr.netlify.app',
      'https://deploy-preview-0--synthetic-hhr.netlify.app',
      'null',
    ])('rejects foreign or malformed preview origins: %s', origin => {
      process.env.SITE_NAME = 'synthetic-hhr';
      expect(isOriginAllowed(origin)).toBe(false);
      expect(buildCorsHeaders(origin)['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('returns true for loopback origins while local function development is enabled', () => {
      process.env.HHR_ALLOW_LOCAL_FUNCTION_ORIGINS = 'true';

      expect(isOriginAllowed('http://127.0.0.1:3000')).toBe(true);
      expect(isOriginAllowed('http://localhost:5173')).toBe(true);
      expect(isOriginAllowed('http://[::1]:3000')).toBe(true);
    });

    it('does not allow loopback origins unless local function development is enabled', () => {
      process.env.HHR_ALLOW_LOCAL_FUNCTION_ORIGINS = '';

      expect(isOriginAllowed('http://127.0.0.1:3000')).toBe(false);
    });

    it('returns true when origin is undefined (same-origin request)', () => {
      expect(isOriginAllowed(undefined)).toBe(true);
    });

    it('returns false for an unknown origin', () => {
      expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    });
  });

  /* ── buildCorsHeaders ────────────────────────────────────────────────── */

  describe('buildCorsHeaders', () => {
    it('includes Vary: Origin', () => {
      const headers = buildCorsHeaders('https://app.example.com');
      expect(headers.Vary).toBe('Origin');
    });

    it('reflects the allowed origin in Access-Control-Allow-Origin', () => {
      const headers = buildCorsHeaders('https://app.example.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    });

    it('reflects loopback origins while local function development is enabled', () => {
      process.env.HHR_ALLOW_LOCAL_FUNCTION_ORIGINS = 'true';

      const headers = buildCorsHeaders('http://127.0.0.1:3000');

      expect(headers['Access-Control-Allow-Origin']).toBe('http://127.0.0.1:3000');
    });

    it('omits Access-Control-Allow-Origin for unknown origins', () => {
      const headers = buildCorsHeaders('https://evil.example.com');
      expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
    });

    it('supports custom allowedHeaders and allowedMethods', () => {
      const headers = buildCorsHeaders('https://app.example.com', {
        allowedHeaders: 'X-Custom',
        allowedMethods: 'PUT,DELETE',
      });
      expect(headers['Access-Control-Allow-Headers']).toBe('X-Custom');
      expect(headers['Access-Control-Allow-Methods']).toBe('PUT,DELETE');
    });
  });

  /* ── buildJsonResponse ───────────────────────────────────────────────── */

  describe('buildJsonResponse', () => {
    it('sets Content-Type to application/json', () => {
      const res = buildJsonResponse(200, { ok: true });
      expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8');
    });

    it('stringifies the body', () => {
      const res = buildJsonResponse(200, { ok: true });
      expect(res.body).toBe(JSON.stringify({ ok: true }));
    });

    it('includes CORS headers when requestOrigin is provided', () => {
      const res = buildJsonResponse(200, {}, { requestOrigin: 'https://app.example.com' });
      const headers = res.headers as Record<string, string>;
      expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
      expect(headers.Vary).toBe('Origin');
    });
  });

  /* ── buildTextResponse ───────────────────────────────────────────────── */

  describe('buildTextResponse', () => {
    it('sets Content-Type to text/plain', () => {
      const res = buildTextResponse(200, 'hello');
      expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8');
    });

    it('returns the body as-is', () => {
      const res = buildTextResponse(200, 'hello world');
      expect(res.body).toBe('hello world');
    });
  });

  /* ── getClientIp ─────────────────────────────────────────────────────── */

  describe('getClientIp', () => {
    it('prefers x-nf-client-connection-ip', () => {
      expect(
        getClientIp({
          headers: {
            'x-nf-client-connection-ip': '1.2.3.4',
            'x-forwarded-for': '5.6.7.8',
            'client-ip': '9.10.11.12',
          },
        })
      ).toBe('1.2.3.4');
    });

    it('falls back to x-forwarded-for (first IP)', () => {
      expect(
        getClientIp({
          headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2', 'client-ip': '9.9.9.9' },
        })
      ).toBe('10.0.0.1');
    });

    it('falls back to client-ip', () => {
      expect(getClientIp({ headers: { 'client-ip': '192.168.1.1' } })).toBe('192.168.1.1');
    });

    it('returns "unknown" when no IP headers are present', () => {
      expect(getClientIp({ headers: {} })).toBe('unknown');
    });
  });

  /* ── isRateLimited ───────────────────────────────────────────────────── */

  describe('isRateLimited', () => {
    it('allows up to maxPerWindow requests', () => {
      const ip = 'rate-limit-allow-test-1';
      for (let i = 0; i < 3; i++) {
        expect(isRateLimited(ip, { maxPerWindow: 3, windowMs: 60_000 })).toBe(false);
      }
    });

    it('blocks after exceeding maxPerWindow', () => {
      const ip = 'rate-limit-block-test-1';
      for (let i = 0; i < 5; i++) {
        isRateLimited(ip, { maxPerWindow: 5, windowMs: 60_000 });
      }
      expect(isRateLimited(ip, { maxPerWindow: 5, windowMs: 60_000 })).toBe(true);
    });

    it('respects windowMs — old requests expire', () => {
      vi.useFakeTimers();
      const ip = 'rate-limit-expire-test-1';

      // Fill up the bucket
      for (let i = 0; i < 3; i++) {
        isRateLimited(ip, { maxPerWindow: 3, windowMs: 1000 });
      }
      // Now limited
      expect(isRateLimited(ip, { maxPerWindow: 3, windowMs: 1000 })).toBe(true);

      // Advance time past the window
      vi.advanceTimersByTime(1100);

      // Should be allowed again
      expect(isRateLimited(ip, { maxPerWindow: 3, windowMs: 1000 })).toBe(false);

      vi.useRealTimers();
    });

    it('prunes stale IPs when map grows beyond 500', () => {
      vi.useFakeTimers();
      const windowMs = 1000;

      // Create 501 stale entries at time 0
      for (let i = 0; i < 501; i++) {
        isRateLimited(`prune-stale-ip-${i}`, { maxPerWindow: 10, windowMs });
      }

      // Advance past the window so all entries are stale
      vi.advanceTimersByTime(windowMs + 100);

      // Trigger the prune by adding one more fresh IP (map will be >500)
      // The fresh IP request should succeed (not rate limited)
      expect(isRateLimited('prune-fresh-ip', { maxPerWindow: 10, windowMs })).toBe(false);

      vi.useRealTimers();
    });
  });

  /* ── buildTooManyRequestsResponse ────────────────────────────────────── */

  describe('buildTooManyRequestsResponse', () => {
    it('returns 429 with Retry-After header', () => {
      const res = buildTooManyRequestsResponse('https://app.example.com');
      const headers = res.headers as Record<string, string>;
      expect(res.statusCode).toBe(429);
      expect(headers['Retry-After']).toBe('60');
      expect(res.body).toContain('Demasiadas solicitudes');
    });
  });

  /* ── parseJsonBody ───────────────────────────────────────────────────── */

  describe('parseJsonBody', () => {
    it('returns error for null body', () => {
      const result = parseJsonBody(null);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('falta el cuerpo');
    });

    it('returns error for undefined body', () => {
      const result = parseJsonBody(undefined);
      expect(result.ok).toBe(false);
    });

    it('parses valid JSON', () => {
      const result = parseJsonBody<{ name: string }>('{"name":"test"}');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value).toEqual({ name: 'test' });
    });

    it('returns error for invalid JSON', () => {
      const result = parseJsonBody('{not json}');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('no es JSON');
    });
  });
});
