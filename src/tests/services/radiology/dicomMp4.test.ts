import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDicomMp4, type DicomMp4Settings } from '@/services/radiology/dicomMp4';
import type { DicomCineSession } from '@/services/radiology/dicomCine';

/** ftyp + moov(mvhd, trak(tkhd, mdia(mdhd))) with a non-zero creation/modification time. */
const syntheticMp4 = () => {
  const box = (type: string, body: number[]) => {
    const size = 8 + body.length;
    return [size >>> 24, (size >>> 16) & 255, (size >>> 8) & 255, size & 255]
      .concat([...type].map(char => char.charCodeAt(0)))
      .concat(body);
  };
  const timed = (type: string) => box(type, [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9]);
  const bytes = [
    ...box('ftyp', [105, 115, 111, 109]),
    ...box('moov', [
      ...timed('mvhd'),
      ...box('trak', [...timed('tkhd'), ...box('mdia', timed('mdhd'))]),
    ]),
  ];
  return new Uint8Array(bytes).buffer;
};
const mock = vi.hoisted(() => ({
  supported: (_size: { width: number; height: number }): boolean => true,
  hugePacket: false,
  badTimestamp: false,
  drop: false,
  fail: false,
  canceled: vi.fn(),
  adds: [] as number[],
  sizes: [] as Array<[number, number]>,
  packet: undefined as undefined | ((packet: { data: Uint8Array; timestamp: number }) => void),
  buffer: undefined as ArrayBuffer | undefined,
}));
vi.mock('mediabunny', () => ({
  Quality: class {},
  Mp4OutputFormat: class {},
  canEncodeVideo: async (_codec: string, options: { width: number; height: number }) =>
    mock.supported(options),
  BufferTarget: class {
    get buffer() {
      return mock.buffer;
    }
  },
  CanvasSource: class {
    constructor(canvas: HTMLCanvasElement, options: { onEncodedPacket: typeof mock.packet }) {
      mock.packet = options.onEncodedPacket;
      mock.sizes.push([canvas.width, canvas.height]);
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
const texts: string[] = [];
const frame = (label = 'Corte', width = 64, height = 64) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, label };
};
const session = (produce = (position: number) => frame(`Corte ${position + 1}`)) => ({
  frame: vi.fn(async (position: number) => produce(position)),
  close: vi.fn(),
});
const settings: DicomMp4Settings = { fps: 10, resolution: '720p' };
const run = (
  source: DicomCineSession,
  positions: number[],
  options: Partial<DicomMp4Settings> = {},
  signal = new AbortController().signal
) => exportDicomMp4(source, positions, { ...settings, ...options }, signal, vi.fn());
beforeEach(() => {
  mock.supported = () => true;
  mock.hugePacket = false;
  mock.badTimestamp = false;
  mock.drop = false;
  mock.fail = false;
  mock.adds = [];
  mock.sizes = [];
  mock.buffer = syntheticMp4();
  mock.canceled.mockClear();
  texts.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    fillText: (text: string) => texts.push(text),
    measureText: (text: string) => ({ width: text.length * 7 }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

describe('deterministic MP4', () => {
  it('encodes each planned position once, in order, with fixed timestamps', async () => {
    const source = session();
    const result = await run(source, [3, 4, 5, 4]);
    expect(source.frame.mock.calls.map(call => call[0])).toEqual([3, 4, 5, 4]);
    expect(mock.adds).toEqual([0, 0.1, 0.2, 0.3]);
    expect(result).toMatchObject({ frames: 4, width: 64, height: 64 });
    expect(result.blob.type).toBe('video/mp4');
    expect(texts.filter(text => text.startsWith('Corte'))).toEqual([
      'Corte 4',
      'Corte 5',
      'Corte 6',
      'Corte 5',
    ]);
  });
  it('writes no creation or modification date in the MP4 headers', async () => {
    await run(session(), [0, 1]);
    // The muxer's buffer is cleared in place before it becomes the Blob.
    const bytes = new Uint8Array(mock.buffer!);
    const text = String.fromCharCode(...bytes);
    for (const type of ['mvhd', 'tkhd', 'mdhd']) {
      const at = text.indexOf(type) + 4;
      expect([...bytes.slice(at + 4, at + 12)], type).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    }
  });
  it('burns the identity only when the anonymous profile is off', async () => {
    await run(session(), [0, 1]);
    expect(texts.some(text => text.includes('PACIENTE'))).toBe(false);
    texts.length = 0;
    await run(session(), [0, 1], { identity: 'PACIENTE SINTÉTICO · 11.111.111-1' });
    expect(texts.filter(text => text.includes('PACIENTE'))).toHaveLength(2);
  });
  it('keeps even dimensions without upscaling and falls back from 1080p with a notice', async () => {
    const large = session(() => frame('Volumen 3D', 2000, 1200));
    mock.supported = ({ width }) => width <= 1280;
    const result = await run(large, [0, 90], { resolution: '1080p' });
    expect(result).toMatchObject({ width: 1200, height: 720 });
    expect(result.notice).toBe('Este navegador no codifica 1080p; el video se generó en 720p.');
    expect(mock.sizes.at(-1)).toEqual([1200, 720]);
    mock.supported = () => true;
    expect(await run(large, [0], { resolution: '1080p' })).toMatchObject({
      width: 1800,
      height: 1080,
      notice: undefined,
    });
    expect(
      await run(
        session(() => frame('Corte', 1000, 1400)),
        [0]
      )
    ).toMatchObject({
      width: 720,
      height: 1008,
    });
    expect(
      await run(
        session(() => frame('Corte', 301, 151)),
        [0]
      )
    ).toMatchObject({
      width: 300,
      height: 150,
    });
  });
  it.each(['hugePacket', 'badTimestamp'] as const)(
    'surfaces asynchronous %s without uncaught callback errors',
    async failure => {
      mock[failure] = true;
      const source = session();
      await expect(run(source, [0, 1, 2, 3, 4], { fps: 5 })).rejects.toThrow(
        failure === 'hugePacket' ? '64 MB' : 'secuencia'
      );
      expect(source.frame).toHaveBeenCalledTimes(1);
      expect(mock.canceled).toHaveBeenCalled();
    }
  );
  it('refuses a silently dropped frame', async () => {
    mock.drop = true;
    await expect(run(session(), [0, 1], { fps: 5 })).rejects.toThrow('todos los cuadros');
  });
  it('reports unavailable H264 without creating a mislabeled fallback', async () => {
    mock.supported = () => false;
    await expect(run(session(), [0, 1], { fps: 5 })).rejects.toThrow('MP4/H.264');
    expect(mock.adds).toEqual([]);
  });
  it('rejects invalid speeds and empty or oversized plans before rendering', async () => {
    const source = session();
    await expect(run(source, [0], { fps: 7 })).rejects.toThrow('velocidad');
    await expect(run(source, [])).rejects.toThrow('cuadros');
    await expect(
      run(
        source,
        Array.from({ length: 2049 }, () => 0)
      )
    ).rejects.toThrow('2048');
    expect(source.frame).not.toHaveBeenCalled();
  });
  it('cancels encoder and never returns a partial file', async () => {
    const controller = new AbortController();
    let calls = 0;
    const source = session(() => {
      if (++calls === 2) controller.abort();
      return frame();
    });
    await expect(run(source, [0, 1, 2, 3], { fps: 5 }, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mock.adds).toEqual([0]);
    expect(mock.canceled).toHaveBeenCalled();
  });
  it('rejects changed frame dimensions and encoding errors', async () => {
    let calls = 0;
    const source = session(() => frame('Corte', ++calls === 2 ? 32 : 64));
    await expect(run(source, [0, 1, 2], { fps: 5 })).rejects.toThrow('tamaño');
    mock.fail = true;
    await expect(run(session(), [0], { fps: 5 })).rejects.toThrow('encoding failed');
  });
  it('fails closed when the finished file has no movie header to clear', async () => {
    mock.buffer = new ArrayBuffer(20);
    await expect(run(session(), [0])).rejects.toThrow('No se pudo preparar el MP4.');
  });
});
