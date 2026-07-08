import { describe, expect, it } from 'vitest';
import {
  buildMedicalHandoffSignatureLink,
  resolveMedicalHandoffScope,
  resolveScopedMedicalHandoffSentAt,
  resolveScopedMedicalSignature,
  resolveScopedMedicalSignatureToken,
} from '@/features/handoff/controllers/medicalHandoffScopeController';

describe('resolveMedicalHandoffScope', () => {
  it.each([['all'], ['upc'], ['no-upc']] as const)(
    'returns "%s" verbatim when the input matches a known scope',
    raw => {
      expect(resolveMedicalHandoffScope(raw)).toBe(raw);
    }
  );

  it.each([null, undefined, '', 'random', 'ALL', ' upc'] as const)(
    'falls back to "all" when the input is %j (invalid)',
    raw => {
      expect(resolveMedicalHandoffScope(raw)).toBe('all');
    }
  );
});

describe('buildMedicalHandoffSignatureLink', () => {
  it('builds the signature URL with mode/date/scope and no token when omitted', () => {
    const url = buildMedicalHandoffSignatureLink('https://app.example', '2026-05-03', 'all');
    expect(url).toBe('https://app.example?mode=signature&date=2026-05-03&scope=all');
  });

  it('appends the token when provided', () => {
    const url = buildMedicalHandoffSignatureLink(
      'https://app.example',
      '2026-05-03',
      'upc',
      'tok-123'
    );
    expect(url).toBe('https://app.example?mode=signature&date=2026-05-03&scope=upc&token=tok-123');
  });

  it('omits the token when null/empty', () => {
    expect(
      buildMedicalHandoffSignatureLink('https://app.example', '2026-05-03', 'no-upc', null)
    ).toBe('https://app.example?mode=signature&date=2026-05-03&scope=no-upc');
    expect(
      buildMedicalHandoffSignatureLink('https://app.example', '2026-05-03', 'no-upc', '')
    ).toBe('https://app.example?mode=signature&date=2026-05-03&scope=no-upc');
  });

  it('properly URL-encodes special characters in the token', () => {
    const url = buildMedicalHandoffSignatureLink(
      'https://app.example',
      '2026-05-03',
      'all',
      'a b&c'
    );
    expect(url).toContain('token=a+b%26c');
  });
});

describe('resolveScopedMedicalSignatureToken', () => {
  it('returns null when the record is null/undefined', () => {
    expect(resolveScopedMedicalSignatureToken(null, 'all')).toBeNull();
    expect(resolveScopedMedicalSignatureToken(undefined, 'upc')).toBeNull();
  });

  it('returns null when the scope key is missing', () => {
    expect(
      resolveScopedMedicalSignatureToken({ medicalSignatureLinkTokenByScope: {} }, 'all')
    ).toBeNull();
    expect(resolveScopedMedicalSignatureToken({}, 'upc')).toBeNull();
  });

  it('returns the token for the requested scope', () => {
    const record = {
      medicalSignatureLinkTokenByScope: { all: 'tok-all', upc: 'tok-upc' },
    };
    expect(resolveScopedMedicalSignatureToken(record, 'all')).toBe('tok-all');
    expect(resolveScopedMedicalSignatureToken(record, 'upc')).toBe('tok-upc');
    expect(resolveScopedMedicalSignatureToken(record, 'no-upc')).toBeNull();
  });

  it('returns null when the token is an empty string (falsy)', () => {
    expect(
      resolveScopedMedicalSignatureToken({ medicalSignatureLinkTokenByScope: { all: '' } }, 'all')
    ).toBeNull();
  });
});

describe('resolveScopedMedicalHandoffSentAt', () => {
  it('returns null when the record is null/undefined', () => {
    expect(resolveScopedMedicalHandoffSentAt(null, 'all')).toBeNull();
    expect(resolveScopedMedicalHandoffSentAt(undefined, 'upc')).toBeNull();
  });

  it('returns the scoped sentAt when present', () => {
    const record = {
      medicalHandoffSentAtByScope: {
        all: '2026-05-03T08:00:00Z',
        upc: '2026-05-03T09:30:00Z',
      },
      medicalHandoffSentAt: '2026-05-02T20:00:00Z',
    };
    expect(resolveScopedMedicalHandoffSentAt(record, 'all')).toBe('2026-05-03T08:00:00Z');
    expect(resolveScopedMedicalHandoffSentAt(record, 'upc')).toBe('2026-05-03T09:30:00Z');
  });

  it('falls back to legacy `medicalHandoffSentAt` for the "all" scope when no scoped value exists', () => {
    const record = { medicalHandoffSentAt: '2026-05-02T20:00:00Z' };
    expect(resolveScopedMedicalHandoffSentAt(record, 'all')).toBe('2026-05-02T20:00:00Z');
  });

  it('does NOT fall back to legacy for non-"all" scopes', () => {
    const record = { medicalHandoffSentAt: '2026-05-02T20:00:00Z' };
    expect(resolveScopedMedicalHandoffSentAt(record, 'upc')).toBeNull();
    expect(resolveScopedMedicalHandoffSentAt(record, 'no-upc')).toBeNull();
  });

  it('returns null when the scoped value is empty string (falsy)', () => {
    const record = {
      medicalHandoffSentAtByScope: { upc: '' },
      medicalHandoffSentAt: '2026-05-02T20:00:00Z',
    };
    expect(resolveScopedMedicalHandoffSentAt(record, 'upc')).toBeNull();
  });
});

describe('resolveScopedMedicalSignature', () => {
  const sampleSignature = { doctorName: 'Dra. X', signedAt: '2026-05-03T08:00:00Z' };

  it('returns null when the record is null/undefined', () => {
    expect(resolveScopedMedicalSignature(null, 'all')).toBeNull();
    expect(resolveScopedMedicalSignature(undefined, 'all')).toBeNull();
  });

  it('returns the scoped signature when present', () => {
    const record = {
      medicalSignatureByScope: { all: sampleSignature },
    };
    expect(resolveScopedMedicalSignature(record, 'all')).toEqual(sampleSignature);
  });

  it('falls back to legacy `medicalSignature` only for the "all" scope', () => {
    const record = { medicalSignature: sampleSignature };
    expect(resolveScopedMedicalSignature(record, 'all')).toEqual(sampleSignature);
    expect(resolveScopedMedicalSignature(record, 'upc')).toBeNull();
    expect(resolveScopedMedicalSignature(record, 'no-upc')).toBeNull();
  });

  it('prefers the scoped value over the legacy fallback when both exist', () => {
    const scoped = { ...sampleSignature, doctorName: 'Dra. Scoped' };
    const legacy = { ...sampleSignature, doctorName: 'Dra. Legacy' };
    const record = {
      medicalSignatureByScope: { all: scoped },
      medicalSignature: legacy,
    };
    expect(resolveScopedMedicalSignature(record, 'all')).toEqual(scoped);
  });
});
