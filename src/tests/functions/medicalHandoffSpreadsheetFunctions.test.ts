import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  runWith: () => ({
    https: {
      onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    },
  }),
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
  createMedicalHandoffSpreadsheetFunctions,
} = require('../../../functions/lib/medicalHandoffSpreadsheetFunctions.js');

const validRequest = {
  date: '2026-08-07',
  rows: [
    {
      stableKey: 'episode:123',
      bed: 'R1',
      patientName: 'Paciente Uno',
      age: '52a',
      diagnosis: 'Diagnóstico',
      specialty: 'Med Interna',
      treatingPhysician: 'Dra. Aravena',
      rut: '11.111.111-1',
    },
  ],
};

const authorizedContext = {
  auth: { uid: 'user-1', token: { email: 'medico@hospitalhangaroa.cl' } },
};

const validConfig = {
  appsScriptUrl: 'https://script.google.com/macros/s/deployment-id_123/exec',
  sharedSecret: 'a-secure-shared-secret-value',
};

const successfulFetch = vi.fn().mockResolvedValue({
  ok: true,
  text: vi.fn().mockResolvedValue(
    JSON.stringify({
      ok: true,
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit',
      created: true,
      rowCount: 1,
    })
  ),
});

describe('functions medicalHandoffSpreadsheetFunctions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated calls before contacting Google', async () => {
    const functionsApi = createMedicalHandoffSpreadsheetFunctions({
      resolveRoleForEmail: vi.fn(),
      fetchImpl: successfulFetch,
      readConfig: () => validConfig,
    });

    await expect(
      functionsApi.openMedicalHandoffSpreadsheet.run(validRequest, { auth: null })
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(successfulFetch).not.toHaveBeenCalled();
  });

  it('rejects callers without clinical export permission', async () => {
    const functionsApi = createMedicalHandoffSpreadsheetFunctions({
      resolveRoleForEmail: vi.fn().mockResolvedValue('viewer'),
      fetchImpl: successfulFetch,
      readConfig: () => validConfig,
    });

    await expect(
      functionsApi.openMedicalHandoffSpreadsheet.run(validRequest, authorizedContext)
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(successfulFetch).not.toHaveBeenCalled();
  });

  it('requires the institutional Apps Script configuration', async () => {
    const functionsApi = createMedicalHandoffSpreadsheetFunctions({
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      fetchImpl: successfulFetch,
      readConfig: () => ({ appsScriptUrl: '', sharedSecret: '' }),
    });

    await expect(
      functionsApi.openMedicalHandoffSpreadsheet.run(validRequest, authorizedContext)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });

  it('allows only the Apps Script deployment host', async () => {
    const functionsApi = createMedicalHandoffSpreadsheetFunctions({
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      fetchImpl: successfulFetch,
      readConfig: () => ({
        ...validConfig,
        appsScriptUrl: 'https://example.com/collect',
      }),
    });

    await expect(
      functionsApi.openMedicalHandoffSpreadsheet.run(validRequest, authorizedContext)
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(successfulFetch).not.toHaveBeenCalled();
  });

  it('rejects impossible calendar dates and duplicate patient keys', async () => {
    const functionsApi = createMedicalHandoffSpreadsheetFunctions({
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      fetchImpl: successfulFetch,
      readConfig: () => validConfig,
    });

    await expect(
      functionsApi.openMedicalHandoffSpreadsheet.run(
        { ...validRequest, date: '2026-02-31' },
        authorizedContext
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      functionsApi.openMedicalHandoffSpreadsheet.run(
        {
          ...validRequest,
          rows: [{ ...validRequest.rows[0], stableKey: '=IMPORTDATA("https://example.com")' }],
        },
        authorizedContext
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(
      functionsApi.openMedicalHandoffSpreadsheet.run(
        { ...validRequest, rows: [validRequest.rows[0], validRequest.rows[0]] },
        authorizedContext
      )
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(successfulFetch).not.toHaveBeenCalled();
  });

  it('sends only allowlisted handoff columns and returns the spreadsheet URL', async () => {
    const resolveRoleForEmail = vi.fn().mockResolvedValue('doctor_urgency');
    const functionsApi = createMedicalHandoffSpreadsheetFunctions({
      resolveRoleForEmail,
      fetchImpl: successfulFetch,
      readConfig: () => validConfig,
    });

    const result = await functionsApi.openMedicalHandoffSpreadsheet.run(
      validRequest,
      authorizedContext
    );

    expect(result).toEqual({
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-id/edit',
      created: true,
      rowCount: 1,
      date: '2026-08-07',
    });
    expect(resolveRoleForEmail).toHaveBeenCalledWith('medico@hospitalhangaroa.cl');
    const [, requestInit] = successfulFetch.mock.calls[0];
    const sentPayload = JSON.parse(requestInit.body);
    expect(sentPayload.secret).toBe(validConfig.sharedSecret);
    expect(sentPayload.rows[0]).toEqual({
      stableKey: 'episode:123',
      bed: 'R1',
      patientName: 'Paciente Uno',
      age: '52a',
      diagnosis: 'Diagnóstico',
      specialty: 'Med Interna',
      treatingPhysician: 'Dra. Aravena',
    });
    expect(sentPayload.rows[0]).not.toHaveProperty('rut');
  });

  it('keeps the callable exported from the deployable entrypoint', () => {
    const functionsIndex = readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
    const functionModule = readFileSync(
      path.join(process.cwd(), 'functions/lib/medicalHandoffSpreadsheetFunctions.js'),
      'utf8'
    );

    expect(functionsIndex).toContain("require('./lib/medicalHandoffSpreadsheetFunctions')");
    expect(functionsIndex).toContain('...createMedicalHandoffSpreadsheetFunctions({');
    expect(functionModule).toContain('openMedicalHandoffSpreadsheet: functions');
  });
});
