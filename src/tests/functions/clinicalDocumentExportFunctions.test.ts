import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

    expect(resolveRoleForEmail).toHaveBeenCalledWith('removed@hospitalhangaroa.cl');
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
