import fs from 'node:fs';
import path from 'node:path';

const validJpegBuffer = fs.readFileSync(
  path.resolve(process.cwd(), 'public/images/logos/logo_SSMO.jpg')
);

export const validJpegBase64 = validJpegBuffer.toString('base64');
export const differentJpegBase64 = Buffer.concat([
  validJpegBuffer.subarray(0, -2),
  Buffer.from([0]),
  validJpegBuffer.subarray(-2),
]).toString('base64');

const buildOversizedJpeg = () => {
  const buffer = Buffer.from(validJpegBuffer);
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) break;
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    const segmentLength = buffer.readUInt16BE(offset);
    if (frameMarkers.has(marker)) {
      buffer.writeUInt16BE(2201, offset + 5);
      return buffer;
    }
    offset += segmentLength;
  }
  throw new Error('Test JPEG has no start-of-frame marker.');
};

export const oversizedJpegBase64 = buildOversizedJpeg().toString('base64');

export const buildHarness = () => {
  const records: Record<string, Record<string, unknown>> = {};
  const blobs: Record<string, Buffer> = {};
  let resolveBlockedSaveStarted: () => void = () => undefined;
  let resolveBlockedSave: () => void = () => undefined;
  let blockedSave = Promise.resolve();
  const controls = {
    failBlobDelete: false,
    afterQueueDelete: null as
      | ((id: string, previous: Record<string, unknown> | undefined) => void)
      | null,
    blockNextSave: false,
    blockedSaveStarted: Promise.resolve(),
    prepareBlockedSave: () => {
      controls.blockNextSave = true;
      controls.blockedSaveStarted = new Promise<void>(resolve => {
        resolveBlockedSaveStarted = resolve;
      });
      blockedSave = new Promise<void>(resolve => {
        resolveBlockedSave = resolve;
      });
    },
    releaseBlockedSave: () => resolveBlockedSave(),
  };

  const queueCollection = {
    doc: (id: string) => ({
      set: async (value: Record<string, unknown>) => {
        records[id] = value;
      },
      get: async () => ({ exists: Boolean(records[id]), data: () => records[id] }),
      delete: async () => {
        const previous = records[id];
        delete records[id];
        controls.afterQueueDelete?.(id, previous);
      },
    }),
    get: async () => ({
      forEach: (callback: (doc: { data: () => Record<string, unknown> }) => void) =>
        Object.values(records).forEach(record => callback({ data: () => record })),
    }),
  };

  const firestore = {
    collection: () => ({
      doc: () => ({
        collection: () => queueCollection,
      }),
    }),
    runTransaction: async (
      operation: (transaction: {
        get: (ref: { get: () => Promise<unknown> }) => Promise<unknown>;
        set: (
          ref: { set: (value: Record<string, unknown>) => Promise<void> },
          value: Record<string, unknown>
        ) => void;
        delete: (ref: { delete: () => Promise<void> }) => void;
      }) => Promise<unknown>
    ) => {
      const pendingWrites: Array<() => Promise<void>> = [];
      const result = await operation({
        get: ref => ref.get(),
        set: (ref, value) => pendingWrites.push(() => ref.set(value)),
        delete: ref => pendingWrites.push(() => ref.delete()),
      });
      for (const write of pendingWrites) await write();
      return result;
    },
  };
  const storageMetadata: Record<string, Record<string, unknown>> = {};
  const storage = {
    bucket: () => ({
      name: 'hhr-local-scanner.appspot.com',
      file: (storagePath: string) => ({
        save: async (buffer: Buffer) => {
          if (controls.blockNextSave) {
            controls.blockNextSave = false;
            resolveBlockedSaveStarted();
            await blockedSave;
          }
          blobs[storagePath] = buffer;
        },
        delete: async () => {
          if (controls.failBlobDelete) throw new Error('forced Storage delete failure');
          delete blobs[storagePath];
        },
        getSignedUrl: async () => [`https://storage.test/${encodeURIComponent(storagePath)}`],
        getMetadata: async () => [{ metadata: storageMetadata[storagePath] || {} }],
        setMetadata: async (value: { metadata?: Record<string, unknown> }) => {
          storageMetadata[storagePath] = value.metadata || {};
        },
      }),
    }),
  };
  return { firestore, storage, records, blobs, controls };
};
