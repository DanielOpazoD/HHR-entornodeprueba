import { describe, expect, it } from 'vitest';
import { safeErrorMessage } from '../../../netlify/functions/lib/safe-error-message';

describe('safeErrorMessage', () => {
  it.each([
    'HTTP 503 Operation timed out after 8000ms',
    'Paciente sintético Ana Pérez, RUT 12.345.678-5',
    'Missing Authorization bearer token.',
    'HTTP 503 from api.example.com',
    'Authorization header must use Bearer token.',
    "Access denied for role 'viewer'.",
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
});
