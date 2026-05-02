import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  scope: 'wound_care_upload_only',
});

const createAdminMock = (session: Record<string, unknown> | null = buildValidSession()) => {
  const setPhoto = vi.fn().mockResolvedValue(undefined);
  const setAudit = vi.fn().mockResolvedValue(undefined);
  const saveFile = vi.fn().mockResolvedValue(undefined);

  const admin = {
    firestore: () => ({
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
    }),
    storage: () => ({
      bucket: () => ({
        name: 'test-bucket',
        file: () => ({
          save: saveFile,
        }),
      }),
    }),
  };

  return { admin, setPhoto, setAudit, saveFile };
};

describe('functions woundCareMobileUploadFunctions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects expired or missing upload sessions', async () => {
    const expiredSession = {
      ...buildValidSession(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const { admin } = createAdminMock(expiredSession);
    const functionsApi = createWoundCareMobileUploadFunctions({ admin });

    await expect(
      functionsApi.validateWoundCareMobileUploadSession.run({ sessionId: 'session-1' })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('uploads photo metadata, storage objects and audit entry for valid QR session', async () => {
    const { admin, setPhoto, setAudit, saveFile } = createAdminMock();
    const functionsApi = createWoundCareMobileUploadFunctions({ admin });

    const result = await functionsApi.uploadWoundCareMobilePhoto.run({
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
    });

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
  });
});
