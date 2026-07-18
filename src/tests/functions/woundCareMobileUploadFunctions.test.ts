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
}

const createFirebaseServicesMock = (
  session: Record<string, unknown> | null = buildValidSession()
): FirebaseServicesMockResult => {
  const setPhoto = vi.fn().mockResolvedValue(undefined);
  const setAudit = vi.fn().mockResolvedValue(undefined);
  const saveFile = vi.fn().mockResolvedValue(undefined);
  const updateSession = vi.fn().mockResolvedValue(undefined);

  const firestore = {
    collection: () => ({
      doc: () => ({
        collection: (name: string) => ({
          doc: () => {
            if (name === 'woundCareMobileUploadSessions') {
              return {
                get: vi.fn().mockResolvedValue({
                  exists: Boolean(session),
                  data: () => session,
                }),
                update: updateSession,
              };
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
        file: () => ({
          save: saveFile,
        }),
      }),
    },
  };

  return { firebaseServices, setPhoto, setAudit, saveFile, updateSession };
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

  it('uploads photo metadata, storage objects, audit entry, and increments the per-session counter', async () => {
    const { firebaseServices, setPhoto, setAudit, saveFile, updateSession } =
      createFirebaseServicesMock();
    const functionsApi = createWoundCareMobileUploadFunctions(firebaseServices);

    const result = await functionsApi.uploadWoundCareMobilePhoto.run(
      {
        sessionId: 'session-1',
        imageBase64: Buffer.from('image').toString('base64'),
        thumbnailBase64: Buffer.from('thumb').toString('base64'),
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
    expect(updateSession).toHaveBeenCalledWith({
      uploadCount: { __op: 'increment', amount: 1 },
    });
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
          imageBase64: Buffer.from('image').toString('base64'),
          thumbnailBase64: Buffer.from('thumb').toString('base64'),
        },
        {}
      )
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    expect(setPhoto).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
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
        imageBase64: Buffer.from('image').toString('base64'),
        thumbnailBase64: Buffer.from('thumb').toString('base64'),
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
          imageBase64: Buffer.from('image').toString('base64'),
          thumbnailBase64: Buffer.from('thumb').toString('base64'),
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
