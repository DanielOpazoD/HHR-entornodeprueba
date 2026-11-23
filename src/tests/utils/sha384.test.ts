// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha384Bytes, sha384Hex } from '@/utils/sha384';

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
