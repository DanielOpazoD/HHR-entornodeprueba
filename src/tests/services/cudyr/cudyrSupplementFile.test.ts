import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCudyrSupplementFile } from '@/services/cudyr/cudyrSupplementFile';

const report = { month: '2026-10', patients: [] };

class SlowWorker {
  static replyAfterMs = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage() {
    setTimeout(() => {
      this.onmessage?.({ data: { result: { ok: true, report } } } as MessageEvent);
    }, SlowWorker.replyAfterMs);
  }
}

const read = (signal = new AbortController().signal) =>
  readCudyrSupplementFile(
    {
      name: 'Categorizacion_2026-10.xls',
      size: 64,
      arrayBuffer: async () => new ArrayBuffer(64),
    } as File,
    signal
  );

describe('reading the monthly CUDYR report', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', SlowWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits for a worker that is slow to start, as on the first read after a release', async () => {
    SlowWorker.replyAfterMs = 12_000;
    const pending = read();
    await vi.advanceTimersByTimeAsync(12_000);
    await expect(pending).resolves.toMatchObject({ report });
  });

  it('stops the read when it is cancelled', async () => {
    SlowWorker.replyAfterMs = 60_000;
    const controller = new AbortController();
    const failure = expect(read(controller.signal)).rejects.toThrow('Lectura cancelada.');
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await failure;
  });

  it('still reports a worker that never answers', async () => {
    SlowWorker.replyAfterMs = 60_000;
    const failure = expect(read()).rejects.toThrow('El archivo excedió el tiempo de lectura.');
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
  });
});
