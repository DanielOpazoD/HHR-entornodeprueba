import { describe, expect, it } from 'vitest';
import { clearMp4CreationTimes } from '@/services/radiology/dicomMp4Metadata';

const u32 = (value: number) => [
  value >>> 24,
  (value >>> 16) & 255,
  (value >>> 8) & 255,
  value & 255,
];
const box = (type: string, body: number[]) =>
  u32(8 + body.length).concat(
    [...type].map(char => char.charCodeAt(0)),
    body
  );
/** Version 1 headers carry 64-bit times; the trailing bytes stand for duration and the rest. */
const timed = (type: string, version: 0 | 1) =>
  box(type, [version, 0, 0, 0, ...new Array(version ? 16 : 8).fill(7), 1, 2, 3, 4]);
const file = (version: 0 | 1) =>
  new Uint8Array([
    ...box('ftyp', [105, 115, 111, 109]),
    ...box('moov', [
      ...timed('mvhd', version),
      ...box('trak', [...timed('tkhd', version), ...box('mdia', timed('mdhd', version))]),
    ]),
    ...box('mdat', [9, 9, 9, 9]),
  ]);
const timesOf = (bytes: Uint8Array, type: string, width: number) => {
  const at = String.fromCharCode(...bytes).indexOf(type) + 8;
  return [...bytes.slice(at, at + width * 2)];
};

describe('MP4 creation time', () => {
  it.each([0, 1] as const)('clears version %i movie, track and media times only', version => {
    const bytes = file(version);
    const before = [...bytes];
    clearMp4CreationTimes(bytes.buffer);
    const width = version ? 8 : 4;
    for (const type of ['mvhd', 'tkhd', 'mdhd'])
      expect(timesOf(bytes, type, width), type).toEqual(new Array(width * 2).fill(0));
    const changed = before.flatMap((value, i) => (value === bytes[i] ? [] : [i]));
    expect(changed).toHaveLength(3 * width * 2);
    expect([...bytes.slice(-4)]).toEqual([9, 9, 9, 9]);
  });
  it('fails closed on a truncated box or a file without a movie header', () => {
    const truncated = file(0).slice(0, 30);
    expect(() => clearMp4CreationTimes(truncated.buffer)).toThrow('No se pudo preparar el MP4.');
    const empty = new Uint8Array(box('ftyp', [1, 2, 3, 4]));
    expect(() => clearMp4CreationTimes(empty.buffer)).toThrow('No se pudo preparar el MP4.');
  });
});
