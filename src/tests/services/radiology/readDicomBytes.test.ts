import { describe, it, expect, vi } from 'vitest';
import { readDicomBytes } from '@/services/radiology/readDicomBytes';
describe('bounded speculative DICOM read', () => {
  it('cancels before reading an advertised oversized body', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'Content-Length': '10' },
    });
    await expect(readDicomBytes(response, new AbortController().signal, 4)).rejects.toThrow(
      'precarga'
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('cancels as soon as chunks exceed the budget even with a misleading length', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(3));
          c.enqueue(new Uint8Array(3));
        },
        cancel,
      }),
      { headers: { 'Content-Length': '1' } }
    );
    await expect(readDicomBytes(response, new AbortController().signal, 4)).rejects.toThrow(
      'precarga'
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('assembles a bounded response without a length header', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]));
    expect(await readDicomBytes(response, new AbortController().signal, 3)).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });
});
