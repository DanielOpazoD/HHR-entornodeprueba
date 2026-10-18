import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDicomMp4 } from '@/services/radiology/dicomMp4';

const mock = vi.hoisted(() => ({
  supported: true,
  hugePacket: false,
  badTimestamp: false,
  drop: false,
  fail: false,
  canceled: vi.fn(),
  adds: [] as number[],
  packet: undefined as undefined | ((packet: { data: Uint8Array; timestamp: number }) => void),
}));
vi.mock('mediabunny', () => ({
  Quality: class {},
  Mp4OutputFormat: class {},
  canEncodeVideo: async () => mock.supported,
  BufferTarget: class {
    buffer = new ArrayBuffer(20);
  },
  CanvasSource: class {
    constructor(_canvas: unknown, options: { onEncodedPacket: typeof mock.packet }) {
      mock.packet = options.onEncodedPacket;
    }
    async add(timestamp: number) {
      mock.adds.push(timestamp);
      if (mock.fail) throw new Error('encoding failed');
      // Native encoder callbacks run asynchronously, outside the add/finalize call stack.
      await new Promise<void>(resolve =>
        queueMicrotask(() => {
          if (!mock.drop)
            mock.packet?.({
              data: { byteLength: mock.hugePacket ? 65 * 1024 * 1024 : 1 } as Uint8Array,
              timestamp: mock.badTimestamp ? -1 : timestamp,
            });
          resolve();
        })
      );
    }
    close() {}
  },
  Output: class {
    state = 'pending';
    addVideoTrack() {}
    async start() {
      this.state = 'started';
    }
    async finalize() {
      this.state = 'finalized';
    }
    async cancel() {
      this.state = 'canceled';
      mock.canceled();
    }
  },
}));
const frame = () => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  vi.spyOn(canvas, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  return canvas;
};
beforeEach(() => {
  mock.supported = true;
  mock.hugePacket = false;
  mock.badTimestamp = false;
  mock.drop = false;
  mock.fail = false;
  mock.adds = [];
  mock.canceled.mockClear();
});
describe('deterministic MP4', () => {
  it('encodes each selected slice once with fixed timestamps regardless of retrieval speed', async () => {
    const session = { frame: vi.fn(async () => frame()), close: vi.fn() };
    const blob = await exportDicomMp4(
      session,
      { start: 3, end: 5, fps: 10 },
      12,
      new AbortController().signal,
      vi.fn()
    );
    expect(session.frame.mock.calls.map(call => (call as unknown[])[0])).toEqual([3, 4, 5]);
    expect(mock.adds).toEqual([0, 0.1, 0.2]);
    expect(blob.type).toBe('video/mp4');
  });
  it.each(['hugePacket', 'badTimestamp'] as const)(
    'surfaces asynchronous %s without uncaught callback errors',
    async failure => {
      mock[failure] = true;
      const session = { frame: vi.fn(async () => frame()), close: vi.fn() };
      await expect(
        exportDicomMp4(
          session,
          { start: 0, end: 4, fps: 5 },
          5,
          new AbortController().signal,
          vi.fn()
        )
      ).rejects.toThrow(failure === 'hugePacket' ? '64 MB' : 'secuencia');
      expect(session.frame).toHaveBeenCalledTimes(1);
      expect(mock.canceled).toHaveBeenCalled();
    }
  );
  it('refuses a silently dropped frame', async () => {
    mock.drop = true;
    await expect(
      exportDicomMp4(
        { frame: async () => frame(), close: vi.fn() },
        { start: 0, end: 1, fps: 5 },
        2,
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toThrow('todos los cortes');
  });
  it('reports unavailable H264 without creating a mislabeled fallback', async () => {
    mock.supported = false;
    await expect(
      exportDicomMp4(
        { frame: async () => frame(), close: vi.fn() },
        { start: 0, end: 1, fps: 5 },
        2,
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toThrow('MP4/H.264');
    expect(mock.adds).toEqual([]);
  });
  it('cancels encoder and never returns a partial file', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      exportDicomMp4(
        {
          frame: async () => {
            if (++calls === 2) controller.abort();
            return frame();
          },
          close: vi.fn(),
        },
        { start: 0, end: 3, fps: 5 },
        4,
        controller.signal,
        vi.fn()
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mock.adds).toEqual([0]);
    expect(mock.canceled).toHaveBeenCalled();
  });
  it('rejects changed frame dimensions and encoding errors', async () => {
    let calls = 0;
    await expect(
      exportDicomMp4(
        {
          frame: async () => {
            const canvas = frame();
            if (++calls === 2) canvas.width = 32;
            return canvas;
          },
          close: vi.fn(),
        },
        { start: 0, end: 2, fps: 5 },
        3,
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toThrow('tamaño');
    mock.fail = true;
    await expect(
      exportDicomMp4(
        { frame: async () => frame(), close: vi.fn() },
        { start: 0, end: 0, fps: 5 },
        1,
        new AbortController().signal,
        vi.fn()
      )
    ).rejects.toThrow('encoding failed');
  });
});
