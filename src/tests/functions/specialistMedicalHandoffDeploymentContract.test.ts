// @vitest-environment node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

type Caller = 'admin' | 'unauthenticated' | 'viewer';

const callableObservation = z.object({
  result: z.unknown(),
  error: z.string().nullable(),
  reads: z.array(z.string()),
  updates: z.array(z.object({ path: z.string(), data: z.record(z.string(), z.unknown()) })),
  firebaseAdminLoaded: z.boolean(),
});

const entrypointProbe = String.raw`
const { createRequire, Module } = require('node:module');
const indexPath = process.argv[1];
const caller = process.argv[2];
const load = createRequire(indexPath);
const reads = [];
const updates = [];
const unexpected = () => { throw new Error('Unexpected external or unrelated operation'); };
const deniedService = new Proxy({}, { get: unexpected });

const cache = (request, exports) => {
  const filename = load.resolve(request);
  const module = new Module(filename);
  module.exports = exports;
  module.loaded = true;
  load.cache[filename] = module;
};

const document = pathname => ({
  collection: name => document(pathname + '/' + name),
  doc: name => document(pathname + '/' + name),
  get: async () => {
    reads.push(pathname);
    return {
      exists: true,
      data: () => ({ date: '2026-01-01', beds: { R4: {} } }),
    };
  },
  update: async data => { updates.push({ path: pathname, data }); },
});

cache('./lib/appContext', {
  auth: deniedService,
  storage: deniedService,
  FieldValue: deniedService,
  firestore: { collection: name => document(name) },
  Timestamp: { now: () => ({ seconds: 1767225600, nanoseconds: 123 }) },
  HOSPITAL_CAPACITY: 1,
});
cache('firebase-functions/v1', {
  https: {
    onCall: run => ({ run }),
    HttpsError: class extends Error {
      constructor(code, message) { super(message); this.code = code; }
    },
  },
});
cache('./lib/authFunctions', {
  createAuthHelpers: () => ({
    resolveRoleForEmail: async email => {
      if (email !== 'synthetic@example.invalid') unexpected();
      return caller === 'admin' ? 'admin' : 'viewer';
    },
    hasCallableClinicalAccess: unexpected,
  }),
  createAuthFunctions: () => ({}),
});

for (const [request, factory] of [
  ['./lib/accounts/accountFunctions', 'createAccountFunctions'],
  ['./lib/minsalFunctions', 'createMinsalFunctions'],
  ['./lib/handoffSignatureFunctions', 'createHandoffSignatureFunctions'],
  ['./lib/dailyRecordWriteAuthorityFunctions', 'createDailyRecordWriteAuthorityFunctions'],
  ['./lib/adminCudyrResultFunctions', 'createAdminCudyrResultFunctions'],
  ['./lib/cudyrHistoryFunctions', 'createCudyrHistoryFunctions'],
  ['./lib/rayenClinicalEnrichmentFunctions', 'createRayenClinicalEnrichmentFunctions'],
  ['./lib/specialtyPolicyFunctions', 'createSpecialtyPolicyFunctions'],
  ['./lib/specialtyJevFunctions', 'createSpecialtyJevFunctions'],
  ['./lib/clinicalDocumentExportFunctions', 'createClinicalDocumentExportFunctions'],
  ['./lib/clinicalDocumentPdfRenderFunctions', 'createClinicalDocumentPdfRenderFunctions'],
  ['./lib/woundCareMobileUploadFunctions', 'createWoundCareMobileUploadFunctions'],
  ['./lib/documentScannerFunctions', 'createDocumentScannerFunctions'],
  ['./lib/medicalHandoffSpreadsheetFunctions', 'createMedicalHandoffSpreadsheetFunctions'],
]) {
  cache(request, { [factory]: () => ({}) });
}
cache('./lib/prescriptionAccessFunctions', {
  createPrescriptionAccessFunctions: () => ({}),
  validatePinAgainstConfig: unexpected,
  resolveUploadPatientOptionForExactDate: unexpected,
});

(async () => {
  const api = load(indexPath);
  if (typeof api.updateSpecialistMedicalHandoff?.run !== 'function') {
    throw new Error('Entrypoint must export updateSpecialistMedicalHandoff callable');
  }
  let result = null;
  let error = null;
  try {
    result = await api.updateSpecialistMedicalHandoff.run(
      {
        date: '2026-01-01',
        patch: {
          'beds.R4.medicalHandoffNote': 'Synthetic handoff note',
          lastUpdated: 'client-value-ignored',
        },
      },
      caller === 'unauthenticated'
        ? {}
        : { auth: { token: { email: 'synthetic@example.invalid' } } }
    );
  } catch (caught) {
    if (typeof caught?.code !== 'string') throw caught;
    error = caught.code;
  }
  process.stdout.write(JSON.stringify({
    result,
    error,
    reads,
    updates,
    firebaseAdminLoaded: Object.keys(load.cache).some(filename =>
      /[/\\]firebase-admin[/\\]/.test(filename)
    ),
  }));
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

const observeEntrypoint = (caller: Caller): z.infer<typeof callableObservation> => {
  const child = spawnSync(
    process.execPath,
    ['-e', entrypointProbe, path.resolve('functions/index.js'), caller],
    {
      cwd: process.cwd(),
      env: { HOSPITAL_ID: 'synthetic_hospital' },
      encoding: 'utf8',
      timeout: 10000,
    }
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.status, child.stderr).toBe(0);
  const observation: unknown = JSON.parse(child.stdout);
  return callableObservation.parse(observation);
};

describe('specialist medical handoff entrypoint contract', () => {
  it('exports the callable that updates one bed with a server-owned timestamp', () => {
    expect(observeEntrypoint('admin')).toEqual({
      result: { success: true, date: '2026-01-01', bedId: 'R4' },
      error: null,
      reads: ['hospitals/synthetic_hospital/dailyRecords/2026-01-01'],
      updates: [
        {
          path: 'hospitals/synthetic_hospital/dailyRecords/2026-01-01',
          data: {
            'beds.R4.medicalHandoffNote': 'Synthetic handoff note',
            lastUpdated: { seconds: 1767225600, nanoseconds: 123 },
          },
        },
      ],
      firebaseAdminLoaded: false,
    });
  });

  it.each([
    { caller: 'unauthenticated', code: 'unauthenticated' },
    { caller: 'viewer', code: 'permission-denied' },
  ] satisfies { caller: Caller; code: string }[])(
    'rejects $caller before reading or updating a record',
    ({ caller, code }) => {
      expect(observeEntrypoint(caller)).toEqual({
        result: null,
        error: code,
        reads: [],
        updates: [],
        firebaseAdminLoaded: false,
      });
    }
  );
});
