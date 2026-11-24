// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

const require = createRequire(import.meta.url);
const {
  createWoundCareMobileUploadFunctions,
} = require('../../../functions/lib/woundCareMobileUploadFunctions.js');

const SYNTHETIC_WEBP_BASE64 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]).toString('base64');

const SYNTHETIC_JPEG_BASE64 = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]).toString('base64');

const SYNTHETIC_PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]).toString('base64');

const SYNTHETIC_SVG_BASE64 = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'
).toString('base64');

const buildValidSession = () => ({
  sessionId: 'session-1',
  hospitalId: 'H1',
  episodeKey: '12345678-9__2026-05-02',
  patientRut: '12.345.678-9',
  patientName: 'Paciente Test',
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  scope: 'wound_care_upload_only',
  maxUploads: 50,
  uploadCount: 0,
});

interface FirebaseServicesMockResult {
  firebaseServices: {
    firestore: unknown;
    storage: unknown;
    FieldValue: unknown;
  };
  setPhoto: ReturnType<typeof vi.fn>;
  setAudit: ReturnType<typeof vi.fn>;
  saveFile: ReturnType<typeof vi.fn>;
  updateSession: ReturnType<typeof vi.fn>;
  getSessionState: () => Record<string, unknown> | null;
}

const applySessionUpdate = (
  current: Record<string, unknown> | null,
  patch: Record<string, unknown>
): Record<string, unknown> | null => {
  if (!current) return null;
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      '__op' in value &&
      (value as { __op?: unknown }).__op === 'increment'
    ) {
      const prev = typeof next[key] === 'number' ? (next[key] as number) : 0;
      next[key] = prev + Number((value as { amount?: number }).amount || 0);
    } else {
      next[key] = value;
    }
  }
  return next;
};

const createFirebaseServicesMock = (
  session: Record<string, unknown> | null = buildValidSession()
): FirebaseServicesMockResult => {
  let sessionState: Record<string, unknown> | null = session ? { ...session } : null;
  let txChain: Promise<unknown> = Promise.resolve();
  const setPhoto = vi.fn().mockResolvedValue(undefined);
  const setAudit = vi.fn().mockResolvedValue(undefined);
  const saveFile = vi.fn().mockResolvedValue(undefined);
  const updateSession = vi.fn().mockImplementation(async (patch: Record<string, unknown>) => {
    sessionState = applySessionUpdate(sessionState, patch);
  });

  const getSessionSnapshot = () => ({
    exists: Boolean(sessionState),
    data: () => (sessionState ? { ...sessionState } : undefined),
  });

  const sessionDocRef = {
    get: vi.fn().mockImplementation(async () => getSessionSnapshot()),
    update: updateSession,
  };

  const firestore = {
    runTransaction: vi.fn(
      <T>(
        fn: (tx: {
          get: (ref: unknown) => Promise<ReturnType<typeof getSessionSnapshot>>;
          update: (ref: unknown, patch: Record<string, unknown>) => void;
        }) => Promise<T>
      ): Promise<T> => {
        const result = txChain.then(async () => {
          const pendingPatches: Array<Record<string, unknown>> = [];
          const tx = {
            get: async () => getSessionSnapshot(),
            update: (_ref: unknown, patch: Record<string, unknown>) => {
              pendingPatches.push(patch);
            },
          };
          const out = await fn(tx);
          for (const patch of pendingPatches) {
            await updateSession(patch);
          }
          return out;
        });
        txChain = result.then(
          () => undefined,
          () => undefined
        );
        return result;
      }
    ),
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({
          doc: () => {
            if (name === 'woundCareMobileUploadSessions') {
              return sessionDocRef;
            }

            if (name === 'woundCarePhotos') {
              return { set: setPhoto };
            }

            return { set: setAudit };
          },
        }),
      }),
    }),
  };
  const FieldValue = { increment: (n: number) => ({ __op: 'increment', amount: n }) };

  const firebaseServices = {
    firestore,
    FieldValue,
    storage: {
      bucket: () => ({
        name: 'test-bucket',
        file: (filePath: string) => ({
          save: (buffer: Buffer, options: unknown) => saveFile(buffer, options, filePath),
        }),
      }),
    },
  };

  return {
    firebaseServices,
    setPhoto,
    setAudit,
    saveFile,
    updateSession,
    getSessionState: () => sessionState,
  };
};

describe('functions woundCareMobileUploadFunctions', () => {
  const ORIGINAL_APP_CHECK_FLAG = process.env.ENFORCE_WOUND_CARE_APP_CHECK;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
    delete process.env.ENFORCE_WOUND_CARE_APP_CHECK;
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_APP_CHECK_FLAG === undefined) {
      delete process.env.ENFORCE_WOUND_CARE_APP_CHECK;
    } else {
      process.env.ENFORCE_WOUND_CARE_APP_CHECK = ORIGINAL_APP_CHECK_FLAG;
    }
  });

  describe.each([
    ['summer', '2026-10-25T02:00:00.000Z', '2026-10-24'],
    ['winter', '2026-07-02T03:00:00.000Z', '2026-07-01'],
  ])('hospital evening in %s', (_season, now, hospitalDay) => {
    beforeEach(() => {
      vi.setSystemTime(new Date(now));
    });

    it('dates the QR validation audit on the hospital day at 21:00', async () => {
      const { firebaseServices, setAudit } = createFirebaseServicesMock();
      const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);
      await functionsApi.validateWoundCareMobileUploadSession.run({ sessionId: 'session-1' }, {});
      expect(setAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WOUND_CARE_MOBILE_SESSION_VALIDATED',
          timestamp: now,
          recordDate: hospitalDay,
        })
      );
    });

    it('dates the photo audit and storage paths on the hospital day at 21:00', async () => {
      const { firebaseServices, setPhoto, setAudit } = createFirebaseServicesMock();
      const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);
      await functionsApi.uploadWoundCareMobilePhoto.run(
        {
          sessionId: 'session-1',
          imageBase64: SYNTHETIC_WEBP_BASE64,
          thumbnailBase64: SYNTHETIC_WEBP_BASE64,
        },
        {}
      );
      expect(setAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'WOUND_CARE_PHOTO_UPLOADED',
          timestamp: now,
          recordDate: hospitalDay,
        })
      );
      expect(setPhoto).toHaveBeenCalledWith(
        expect.objectContaining({
          uploadedAt: now,
          storagePath: expect.stringContaining(`/${hospitalDay}/`),
          thumbnailStoragePath: expect.stringContaining(`/${hospitalDay}/`),
        })
      );
    });
  });

  it('rejects expired or missing upload sessions', async () => {
    const expiredSession = {
      ...buildValidSession(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const { firebaseServices } = createFirebaseServicesMock(expiredSession);
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    await expect(
      functionsApi.validateWoundCareMobileUploadSession.run({ sessionId: 'session-1' }, {})
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('emits a WOUND_CARE_MOBILE_SESSION_VALIDATED audit entry alongside the session payload', async () => {
    const { firebaseServices, setAudit } = createFirebaseServicesMock();
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    const payload = await functionsApi.validateWoundCareMobileUploadSession.run(
      { sessionId: 'session-1', userAgent: 'Vitest' },
      {}
    );

    expect(payload).toMatchObject({
      sessionId: 'session-1',
      patientName: 'Paciente Test',
      maxUploads: 50,
      uploadCount: 0,
    });
    expect(setAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WOUND_CARE_MOBILE_SESSION_VALIDATED',
        entityType: 'woundCareMobileUploadSession',
        entityId: 'session-1',
        details: expect.objectContaining({
          source: 'wound_care_mobile_qr',
          appCheckEnforced: false,
          appCheckPresent: false,
        }),
      })
    );
  });

  it('uploads photo metadata, storage objects, audit entry, and reserves the per-session counter', async () => {
    const { firebaseServices, setPhoto, setAudit, saveFile, updateSession, getSessionState } =
      createFirebaseServicesMock();
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    const result = await functionsApi.uploadWoundCareMobilePhoto.run(
      {
        sessionId: 'session-1',
        imageBase64: SYNTHETIC_WEBP_BASE64,
        thumbnailBase64: SYNTHETIC_WEBP_BASE64,
        mimeType: 'image/webp',
        originalFileSize: 1024,
        compressedFileSize: 512,
        width: 800,
        height: 600,
        bodyLocation: 'Sacro',
        description: 'Control de curación',
        userAgent: 'Vitest',
      },
      {}
    );

    expect(result.photoId).toMatch(/^wound_photo_/);
    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(setPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        patientName: 'Paciente Test',
        episodeKey: '12345678-9__2026-05-02',
        mimeType: 'image/webp',
        uploadedViaSessionId: 'session-1',
        uploadedBy: expect.objectContaining({ displayName: 'Carga móvil por QR' }),
      })
    );
    expect(setAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WOUND_CARE_PHOTO_UPLOADED',
        details: expect.objectContaining({
          patientName: 'Paciente Test',
          bodyLocation: 'Sacro',
        }),
      })
    );
    expect(updateSession).toHaveBeenCalledWith({ uploadCount: 1 });
    expect(getSessionState()?.uploadCount).toBe(1);
  });

  it('rejects uploads when the session has reached its maxUploads cap', async () => {
    const exhaustedSession = {
      ...buildValidSession(),
      maxUploads: 3,
      uploadCount: 3,
    };
    const { firebaseServices, setPhoto, updateSession } =
      createFirebaseServicesMock(exhaustedSession);
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    await expect(
      functionsApi.uploadWoundCareMobilePhoto.run(
        {
          sessionId: 'session-1',
          imageBase64: SYNTHETIC_WEBP_BASE64,
          thumbnailBase64: SYNTHETIC_WEBP_BASE64,
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(setPhoto).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('allows only one concurrent upload when one slot remains before maxUploads', async () => {
    const nearlyFullSession = {
      ...buildValidSession(),
      maxUploads: 3,
      uploadCount: 2,
    };
    const { firebaseServices, setPhoto, getSessionState } =
      createFirebaseServicesMock(nearlyFullSession);
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        functionsApi.uploadWoundCareMobilePhoto.run(
          {
            sessionId: 'session-1',
            imageBase64: SYNTHETIC_WEBP_BASE64,
            thumbnailBase64: SYNTHETIC_WEBP_BASE64,
          },
          {}
        )
      )
    );

    const fulfilled = outcomes.filter(outcome => outcome.status === 'fulfilled');
    const rejected = outcomes.filter(outcome => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const item of rejected) {
      expect(item.reason).toMatchObject({ code: 'resource-exhausted' });
    }
    expect(setPhoto).toHaveBeenCalledTimes(1);
    expect(getSessionState()?.uploadCount).toBe(3);
  });

  it('rejects SVG or non-image payloads by magic bytes without consuming quota', async () => {
    const { firebaseServices, saveFile, setPhoto, updateSession, getSessionState } =
      createFirebaseServicesMock();
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    await expect(
      functionsApi.uploadWoundCareMobilePhoto.run(
        {
          sessionId: 'session-1',
          imageBase64: SYNTHETIC_SVG_BASE64,
          thumbnailBase64: SYNTHETIC_WEBP_BASE64,
          mimeType: 'image/svg+xml',
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    await expect(
      functionsApi.uploadWoundCareMobilePhoto.run(
        {
          sessionId: 'session-1',
          imageBase64: SYNTHETIC_WEBP_BASE64,
          thumbnailBase64: SYNTHETIC_SVG_BASE64,
          mimeType: 'image/webp',
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    expect(saveFile).not.toHaveBeenCalled();
    expect(setPhoto).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
    expect(getSessionState()?.uploadCount).toBe(0);
  });

  it('ignores untrusted client mimeType and stores valid JPEG bytes (iOS fallback) as image/jpeg', async () => {
    const { firebaseServices, saveFile, setPhoto } = createFirebaseServicesMock();
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    await functionsApi.uploadWoundCareMobilePhoto.run(
      {
        sessionId: 'session-1',
        imageBase64: SYNTHETIC_JPEG_BASE64,
        thumbnailBase64: SYNTHETIC_JPEG_BASE64,
        mimeType: 'image/svg+xml',
      },
      {}
    );

    expect(saveFile).toHaveBeenCalledTimes(2);
    expect(saveFile).toHaveBeenNthCalledWith(
      1,
      expect.any(Buffer),
      expect.objectContaining({
        metadata: expect.objectContaining({ contentType: 'image/jpeg' }),
      }),
      expect.stringMatching(/\.jpg$/)
    );
    expect(saveFile).toHaveBeenNthCalledWith(
      2,
      expect.any(Buffer),
      expect.objectContaining({
        metadata: expect.objectContaining({ contentType: 'image/jpeg' }),
      }),
      expect.stringMatching(/_thumb\.jpg$/)
    );
    expect(setPhoto).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/jpeg',
        storagePath: expect.stringMatching(/\.jpg$/),
        thumbnailStoragePath: expect.stringMatching(/_thumb\.jpg$/),
      })
    );

    await functionsApi.uploadWoundCareMobilePhoto.run(
      {
        sessionId: 'session-1',
        imageBase64: SYNTHETIC_PNG_BASE64,
        thumbnailBase64: SYNTHETIC_PNG_BASE64,
        mimeType: 'text/html',
      },
      {}
    );
    expect(setPhoto).toHaveBeenLastCalledWith(
      expect.objectContaining({
        mimeType: 'image/png',
        storagePath: expect.stringMatching(/\.png$/),
        thumbnailStoragePath: expect.stringMatching(/_thumb\.png$/),
      })
    );
  });

  it('releases the reserved quota slot when Storage or photo metadata write fails', async () => {
    const { firebaseServices, saveFile, setPhoto, getSessionState } = createFirebaseServicesMock();
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    saveFile.mockRejectedValueOnce(new Error('storage offline'));
    await expect(
      functionsApi.uploadWoundCareMobilePhoto.run(
        {
          sessionId: 'session-1',
          imageBase64: SYNTHETIC_WEBP_BASE64,
          thumbnailBase64: SYNTHETIC_WEBP_BASE64,
        },
        {}
      )
    ).rejects.toThrow('storage offline');
    expect(getSessionState()?.uploadCount).toBe(0);

    setPhoto.mockRejectedValueOnce(new Error('firestore write failed'));
    await expect(
      functionsApi.uploadWoundCareMobilePhoto.run(
        {
          sessionId: 'session-1',
          imageBase64: SYNTHETIC_WEBP_BASE64,
          thumbnailBase64: SYNTHETIC_WEBP_BASE64,
        },
        {}
      )
    ).rejects.toThrow('firestore write failed');
    expect(getSessionState()?.uploadCount).toBe(0);
  });

  it('falls back to the default cap when the session lacks maxUploads (legacy session)', async () => {
    const legacySession = { ...buildValidSession() };
    delete (legacySession as Record<string, unknown>).maxUploads;
    delete (legacySession as Record<string, unknown>).uploadCount;
    const { firebaseServices, setPhoto } = createFirebaseServicesMock(legacySession);
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    const result = await functionsApi.uploadWoundCareMobilePhoto.run(
      {
        sessionId: 'session-1',
        imageBase64: SYNTHETIC_WEBP_BASE64,
        thumbnailBase64: SYNTHETIC_WEBP_BASE64,
      },
      {}
    );

    expect(result.photoId).toMatch(/^wound_photo_/);
    expect(setPhoto).toHaveBeenCalled();
  });

  it('rejects calls without an App Check token when ENFORCE_WOUND_CARE_APP_CHECK=1', async () => {
    process.env.ENFORCE_WOUND_CARE_APP_CHECK = '1';
    // Re-require so the module reads the new env value at top-level.
    const {
      createWoundCareMobileUploadFunctions: createApiWithEnforce,
    } = require('../../../functions/lib/woundCareMobileUploadFunctions.js');
    const { firebaseServices } = createFirebaseServicesMock();
    const functionsApi = createApiWithEnforce(firebaseServices);

    await expect(
      functionsApi.validateWoundCareMobileUploadSession.run({ sessionId: 'session-1' }, {})
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    await expect(
      functionsApi.uploadWoundCareMobilePhoto.run(
        {
          sessionId: 'session-1',
          imageBase64: SYNTHETIC_WEBP_BASE64,
          thumbnailBase64: SYNTHETIC_WEBP_BASE64,
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('accepts calls with an App Check token when ENFORCE_WOUND_CARE_APP_CHECK=1', async () => {
    process.env.ENFORCE_WOUND_CARE_APP_CHECK = '1';
    const {
      createWoundCareMobileUploadFunctions: createApiWithEnforce,
    } = require('../../../functions/lib/woundCareMobileUploadFunctions.js');
    const { firebaseServices, setAudit } = createFirebaseServicesMock();
    const functionsApi = createApiWithEnforce(firebaseServices);

    const payload = await functionsApi.validateWoundCareMobileUploadSession.run(
      { sessionId: 'session-1' },
      { app: { appId: 'app-1', token: { issuedAtTime: '2026-05-03T00:00:00Z' } } }
    );

    expect(payload.sessionId).toBe('session-1');
    expect(setAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          appCheckEnforced: true,
          appCheckPresent: true,
        }),
      })
    );
  });
});
