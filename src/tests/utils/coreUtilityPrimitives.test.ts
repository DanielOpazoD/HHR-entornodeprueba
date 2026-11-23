// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';
import { escapeCsvValue } from '@/utils/csvUtils';
import { deepClone } from '@/utils/deepClone';
import { escapeHtml } from '@/utils/htmlEscape';
import {
  comparableName,
  normalizeNameSpacing,
  resolveLegacyNameParts,
} from '@/utils/legacyNameParts';
import { sha384Bytes, sha384Hex } from '@/utils/sha384';

describe('createCachedRuntimeLoader', () => {
  it('loads once for concurrent and later callers after success', async () => {
    const module = { value: 'synthetic module' };
    const loader = vi.fn().mockResolvedValue(module);
    const load = createCachedRuntimeLoader(loader);
    const first = load();
    const concurrent = load();
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(module);
    await expect(concurrent).resolves.toBe(module);
    await expect(load()).resolves.toBe(module);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('preserves the failure for every caller and loads again only on demand', async () => {
    const failure = new Error('synthetic import failure');
    const module = { value: 'recovered' };
    const loader = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(module);
    const load = createCachedRuntimeLoader(loader);
    const results = await Promise.allSettled([load(), load()]);
    expect(results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(load()).resolves.toBe(module);
    await expect(load()).resolves.toBe(module);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

describe('csvUtils', () => {
  describe('escapeCsvValue', () => {
    it('should handle simple values', () => {
      expect(escapeCsvValue('hello')).toBe('hello');
      expect(escapeCsvValue(123)).toBe('123');
      expect(escapeCsvValue(true)).toBe('true');
    });

    it('should handle null and undefined', () => {
      expect(escapeCsvValue(null)).toBe('');
      expect(escapeCsvValue(undefined)).toBe('');
    });

    it('should escape commas', () => {
      expect(escapeCsvValue('hello,world')).toBe('"hello,world"');
    });

    it('should escape quotes', () => {
      expect(escapeCsvValue('hello "world"')).toBe('"hello ""world"""');
    });

    it('should escape newlines', () => {
      expect(escapeCsvValue('hello\nworld')).toBe('"hello\nworld"');
    });
  });
});

describe('deepClone', () => {
  it('creates an independent deep copy of nested structures', () => {
    const original = {
      name: 'Paciente',
      nested: {
        values: [1, 2, 3],
      },
    };

    const cloned = deepClone(original);

    cloned.nested.values.push(4);

    expect(cloned).not.toBe(original);
    expect(cloned.nested).not.toBe(original.nested);
    expect(original.nested.values).toEqual([1, 2, 3]);
    expect(cloned.nested.values).toEqual([1, 2, 3, 4]);
  });

  it('preserves primitives and null values', () => {
    expect(deepClone(null)).toBeNull();
    expect(deepClone(undefined)).toBeUndefined();
    expect(deepClone('texto')).toBe('texto');
    expect(deepClone(42)).toBe(42);
  });
});

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`Tom & "Jerry" <b> it's`)).toBe(
      'Tom &amp; &quot;Jerry&quot; &lt;b&gt; it&#39;s'
    );
  });

  it('escapes the ampersand exactly once (no double-escaping of entities)', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
    // A literal entity-looking string must not have its leading & swallowed twice.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('is safe for both text content and attribute values', () => {
    expect(escapeHtml('<Alta & control>')).toBe('&lt;Alta &amp; control&gt;');
    expect(escapeHtml('Tom & "Jerry"')).toBe('Tom &amp; &quot;Jerry&quot;');
  });

  it('leaves strings without special characters untouched', () => {
    expect(escapeHtml('Paciente estable 24h')).toBe('Paciente estable 24h');
    expect(escapeHtml('')).toBe('');
  });
});

describe('patient name spacing and comparison', () => {
  it('trims and leaves one space between words, whatever the whitespace', () => {
    expect(normalizeNameSpacing('  María \t de\u00a0los  Ángeles ')).toBe('María de los Ángeles');
    expect(normalizeNameSpacing(' \n ')).toBe('');
  });

  it('compares spellings ignoring spacing and case but not accents', () => {
    expect(comparableName(' JUAN  Pérez ')).toBe(comparableName('juan pérez'));
    expect(comparableName('Pérez')).not.toBe(comparableName('Perez'));
  });

  it('guesses the last two words as surnames', () => {
    expect(resolveLegacyNameParts('  ')).toEqual({
      firstName: '',
      lastName: '',
      secondLastName: '',
    });
    expect(resolveLegacyNameParts('Ana')).toEqual({
      firstName: 'Ana',
      lastName: '',
      secondLastName: '',
    });
    expect(resolveLegacyNameParts('Ana  Soto')).toEqual({
      firstName: 'Ana',
      lastName: 'Soto',
      secondLastName: '',
    });
    expect(resolveLegacyNameParts(' María de los  Ángeles Soto Pérez ')).toEqual({
      firstName: 'María de los Ángeles',
      lastName: 'Soto',
      secondLastName: 'Pérez',
    });
  });
});

describe('sha384', () => {
  it.each([
    '',
    'abc',
    'episode-hhr-2026-11-22-cama-r1-paciente-ñandú',
    'a'.repeat(111),
    'a'.repeat(112),
    'a'.repeat(113),
    'a'.repeat(127),
    'a'.repeat(128),
    'a'.repeat(129),
    'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
  ])('matches Node crypto SHA-384 hex digest for input length %s', input => {
    const expected = createHash('sha384').update(input, 'utf8').digest('hex');
    expect(sha384Hex(input)).toBe(expected);
  });

  it('matches Node crypto SHA-384 bytes for arbitrary multi-block binary payloads', () => {
    const payload = Uint8Array.from({ length: 409 }, (_, index) => (index * 73 + 19) & 0xff);
    const expected = new Uint8Array(createHash('sha384').update(payload).digest());

    expect(sha384Bytes(payload)).toEqual(expected);
  });
});
