import { describe, expect, it } from 'vitest';
import { safeErrorLog, safeErrorMessage } from '../../../netlify/functions/lib/safe-error-message';

describe('safeErrorMessage', () => {
  it.each([
    'HTTP 503 Operation timed out after 8000ms',
    'Paciente sintético Ana Pérez, RUT 12.345.678-5',
    'Missing Authorization bearer token.',
    'HTTP 503 from api.example.com',
    'Authorization header must use Bearer token.',
    "Access denied for role 'viewer'.",
    'No document to update: hospitals/hanga_roa/dailyRecords/2026-11-10',
    'indexeddb_get_records_for_month_failed_after_retry',
    'episode 3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f not found',
    'at handler (/var/task/netlify/functions/lib/observability.js:120:11)',
  ])('preserves diagnostic text without credentials: %s', message => {
    expect(safeErrorMessage(new Error(message))).toBe(message);
  });

  it.each([
    'Authorization: Basic SYNTHETIC_HEADER',
    'authorization: Bearer SYNTHETIC_HEADER',
    'Cookie: sid=SYNTHETIC_HEADER; other=SECOND_COOKIE',
    'Set-Cookie: sid=SYNTHETIC_HEADER; HttpOnly',
    '"Authorization": "Basic SYNTHETIC_HEADER"',
    'Bearer abc.def.ghi',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature',
    'https://x/y?access_token=SYNTHETIC_HEADER&key=SECOND_COOKIE',
    'token=SYNTHETIC_HEADER password="SYNTHETIC_HEADER with spaces"',
    'secret=SYNTHETIC_HEADER session=SECOND_COOKIE',
    'a'.repeat(32),
    'AbCd0123+/'.repeat(4) + '==',
    'AbCd0123-_'.repeat(4),
    'abcdefghijklmnopqrstuvwxyz0123456789abcd',
    'sk_live_' + 'q7'.repeat(16),
    'QUJD/REVG/R0hJ/SktM/TU5P/UFFS/U1RV/VldY',
  ])('redacts credential formats: %s', credential => {
    const result = safeErrorMessage(new Error(`HTTP 503; ${credential}`));
    expect(result).toContain('HTTP 503');
    expect(result).toContain('[redacted]');
    for (const secret of [
      'SYNTHETIC_HEADER',
      'SECOND_COOKIE',
      'abc.def.ghi',
      'signature',
      'a'.repeat(32),
      'AbCd0123+/',
      'AbCd0123-_',
      'abcdefghijklmnopqrstuvwxyz0123456789abcd',
      'q7q7q7q7',
      'REVG',
    ]) {
      expect(result).not.toContain(secret);
    }
  });

  it('redacts before truncation so partial credentials cannot survive the boundary', () => {
    const result = safeErrorMessage('x '.repeat(990) + 'token=' + 'a'.repeat(100));
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result).not.toContain('aaaa');
  });

  it('uses a controlled fallback without serializing unknown objects', () => {
    expect(safeErrorMessage({ message: 'secret', cause: 'secret' }, 'unavailable')).toBe(
      'unavailable'
    );
  });

  it('keeps the stack for server logs, redacted like the message', () => {
    const error = new Error('HTTP 503; token=SYNTHETIC_HEADER');
    const logged = safeErrorLog(error);
    expect(logged).toContain('HTTP 503');
    expect(logged).toMatch(/\n\s+at /);
    expect(logged).not.toContain('SYNTHETIC_HEADER');
  });
});
