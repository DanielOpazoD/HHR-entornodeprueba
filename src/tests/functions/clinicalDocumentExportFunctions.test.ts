import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const driveMocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

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

vi.mock('googleapis', () => ({
  google: {
    auth: {
      GoogleAuth: vi.fn(() => ({})),
    },
    drive: vi.fn(() => ({
      files: {
        list: driveMocks.list,
        create: driveMocks.create,
        update: driveMocks.update,
      },
    })),
  },
}));

const require = createRequire(import.meta.url);
const {
  createClinicalDocumentExportFunctions,
  resolveConfiguredProjectId,
} = require('../../../functions/lib/clinicalDocumentExportFunctions.js');

describe('functions clinicalDocumentExportFunctions', () => {
  let nextFolderId = 1;
  const originalGcloudProject = process.env.GCLOUD_PROJECT;
  const originalFirebaseConfig = process.env.FIREBASE_CONFIG;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLINICAL_DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
    nextFolderId = 1;
    process.env.GCLOUD_PROJECT = originalGcloudProject;
    process.env.FIREBASE_CONFIG = originalFirebaseConfig;
  });

  it('prefers GCLOUD_PROJECT without parsing FIREBASE_CONFIG', () => {
    process.env.GCLOUD_PROJECT = 'project-from-env';
    delete process.env.FIREBASE_CONFIG;

    expect(resolveConfiguredProjectId()).toBe('project-from-env');
  });

  it('falls back safely when FIREBASE_CONFIG is malformed', () => {
    delete process.env.GCLOUD_PROJECT;
    process.env.FIREBASE_CONFIG = '{invalid-json';

    expect(resolveConfiguredProjectId()).toBe('hhr-pruebas');
  });

  it('rejects unauthenticated calls', async () => {
    const functionsApi = createClinicalDocumentExportFunctions({
      firestore: { collection: vi.fn() },
      resolveRoleForEmail: vi.fn(),
    });

    await expect(
      functionsApi.exportClinicalDocumentPdfToDrive.run({}, { auth: null })
    ).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('ignores stale token claims when export role is no longer authorized', async () => {
    const resolveRoleForEmail = vi.fn().mockResolvedValue('unauthorized');
    const functionsApi = createClinicalDocumentExportFunctions({
      firestore: { collection: vi.fn() },
      resolveRoleForEmail,
    });

    await expect(
      functionsApi.exportClinicalDocumentPdfToDrive.run(
        {
          fileName: 'Epicrisis.pdf',
          documentType: 'epicrisis',
          patientName: 'Paciente Prueba',
          patientRut: '12.345.678-9',
          episodeKey: '12345678-9__2026-03-04',
          contentBase64: Buffer.from('pdf-content').toString('base64'),
          mimeType: 'application/pdf',
        },
        {
          auth: {
            uid: 'u1',
            token: {
              email: 'removed@hospitalhangaroa.cl',
              role: 'doctor_urgency',
            },
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });

    expect(resolveRoleForEmail).toHaveBeenCalledWith('removed@hospitalhangaroa.cl', {
      auth: { uid: 'u1', token: { email: 'removed@hospitalhangaroa.cl', role: 'doctor_urgency' } },
    });
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    ['2026-11-01T02:00:00.000Z', '2026', 'Octubre 2026'],
    ['2026-11-01T04:30:00.000Z', '2026', 'Octubre 2026'],
    ['2027-01-01T02:00:00.000Z', '2026', 'Diciembre 2026'],
    ['2027-01-01T04:30:00.000Z', '2026', 'Diciembre 2026'],
  ])('exports at %s into the hospital month and year', async (instant, year, month) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(instant));
    driveMocks.list.mockResolvedValue({ data: { files: [] } });
    driveMocks.create.mockImplementation(
      async ({ requestBody }: { requestBody: { mimeType?: string } }) => ({
        data: {
          id:
            requestBody.mimeType === 'application/vnd.google-apps.folder'
              ? `folder-${nextFolderId++}`
              : 'file-synthetic',
        },
      })
    );
    const api = createClinicalDocumentExportFunctions({
      firestore: { collection: vi.fn() },
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_urgency'),
      buildDriveClientOverride: () => ({ files: driveMocks }),
    });
    const result = await api.exportClinicalDocumentPdfToDrive.run(
      {
        fileName: 'Prueba.pdf',
        documentType: 'epicrisis',
        patientName: 'Paciente Sintético',
        patientRut: '11.111.111-1',
        episodeKey: 'synthetic-episode',
        contentBase64: Buffer.from('synthetic-pdf').toString('base64'),
      },
      { auth: { uid: 'synthetic', token: { email: 'synthetic@example.com' } } }
    );
    expect(result.folderPath).toBe(`${year}/${month}`);
    expect(driveMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ name: year, parents: ['folder-1'] }),
      })
    );
    expect(driveMocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({ name: month, parents: ['folder-2'] }),
      })
    );
  });

  it('exports pdf to drive folder hierarchy for authorized doctor role', async () => {
    driveMocks.list.mockResolvedValue({ data: { files: [] } });
    driveMocks.create.mockImplementation(
      async ({ requestBody }: { requestBody: { mimeType?: string } }) => {
        if (requestBody.mimeType === 'application/vnd.google-apps.folder') {
          const id = `folder-${nextFolderId}`;
          nextFolderId += 1;
          return { data: { id } };
        }
        return {
          data: { id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' },
        };
      }
    );

    const setAudit = vi.fn().mockResolvedValue(undefined);
    const admin = {
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({
                set: setAudit,
              }),
            }),
          }),
        }),
      }),
    };

    const functionsApi = createClinicalDocumentExportFunctions({
      firestore: admin.firestore(),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_urgency'),
      buildDriveClientOverride: () => ({
        files: {
          list: driveMocks.list,
          create: driveMocks.create,
          update: driveMocks.update,
        },
      }),
    });

    const result = await functionsApi.exportClinicalDocumentPdfToDrive.run(
      {
        documentId: 'doc-1',
        fileName: 'Epicrisis.pdf',
        documentType: 'epicrisis',
        patientName: 'Paciente Prueba',
        patientRut: '12.345.678-9',
        episodeKey: '12345678-9__2026-03-04',
        contentBase64: Buffer.from('pdf-content').toString('base64'),
        mimeType: 'application/pdf',
      },
      { auth: { uid: 'u1', token: { email: 'medico.urgencia@hospitalhangaroa.cl' } } }
    );

    expect(result.fileId).toBe('file-1');
    expect(result.usedBackend).toBe(true);
    expect(driveMocks.create).toHaveBeenCalled();
    expect(setAudit).toHaveBeenCalled();
  });

  it('allows doctor_specialist callers to export pdf to drive', async () => {
    driveMocks.list.mockResolvedValue({ data: { files: [] } });
    driveMocks.create.mockImplementation(
      async ({ requestBody }: { requestBody: { mimeType?: string } }) => {
        if (requestBody.mimeType === 'application/vnd.google-apps.folder') {
          const id = `folder-${nextFolderId}`;
          nextFolderId += 1;
          return { data: { id } };
        }
        return {
          data: { id: 'file-1', webViewLink: 'https://drive.google.com/file/d/file-1/view' },
        };
      }
    );

    const setAudit = vi.fn().mockResolvedValue(undefined);
    const admin = {
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: () => ({
                set: setAudit,
              }),
            }),
          }),
        }),
      }),
    };

    const functionsApi = createClinicalDocumentExportFunctions({
      firestore: admin.firestore(),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
      buildDriveClientOverride: () => ({
        files: {
          list: driveMocks.list,
          create: driveMocks.create,
          update: driveMocks.update,
        },
      }),
    });

    const result = await functionsApi.exportClinicalDocumentPdfToDrive.run(
      {
        documentId: 'doc-1',
        fileName: 'Epicrisis.pdf',
        documentType: 'epicrisis',
        patientName: 'Paciente Prueba',
        patientRut: '12.345.678-9',
        episodeKey: '12345678-9__2026-03-04',
        contentBase64: Buffer.from('pdf-content').toString('base64'),
        mimeType: 'application/pdf',
      },
      { auth: { uid: 'u2', token: { email: 'especialista@hospitalhangaroa.cl' } } }
    );

    expect(result.fileId).toBe('file-1');
    expect(result.usedBackend).toBe(true);
    expect(setAudit).toHaveBeenCalled();
  });

  it('maps inaccessible configured Drive root folders to an actionable precondition error', async () => {
    driveMocks.list.mockResolvedValue({ data: { files: [] } });
    driveMocks.create.mockRejectedValueOnce({
      code: 404,
      response: {
        status: 404,
        data: {
          error: {
            message: 'File not found: root-folder-id.',
          },
        },
      },
      message: 'File not found: root-folder-id.',
    });

    const functionsApi = createClinicalDocumentExportFunctions({
      firestore: { collection: vi.fn() },
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_urgency'),
      buildDriveClientOverride: () => ({
        files: {
          list: driveMocks.list,
          create: driveMocks.create,
          update: driveMocks.update,
        },
      }),
    });

    await expect(
      functionsApi.exportClinicalDocumentPdfToDrive.run(
        {
          documentId: 'doc-1',
          fileName: 'Epicrisis.pdf',
          documentType: 'epicrisis',
          patientName: 'Paciente Prueba',
          patientRut: '12.345.678-9',
          episodeKey: '12345678-9__2026-03-04',
          contentBase64: Buffer.from('pdf-content').toString('base64'),
          mimeType: 'application/pdf',
        },
        { auth: { uid: 'u1', token: { email: 'medico.urgencia@hospitalhangaroa.cl' } } }
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
      message: expect.stringContaining('carpeta raiz de Drive'),
    });
  });
});
