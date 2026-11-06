import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { bootstrapSeededRecord, buildCanonicalE2ERecord, ensureAuthenticated } from './auth';

const require = createRequire(import.meta.url);
// Use the same Admin SDK instance as the callable implementation after separate npm installs.
const requireFunctions = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireFunctions(
  'firebase-admin/app'
) as typeof import('firebase-admin/app');
const { getFirestore } = requireFunctions(
  'firebase-admin/firestore'
) as typeof import('firebase-admin/firestore');
const { createCudyrHistoryFunctions } = require('../../functions/lib/cudyrHistoryFunctions.js');
export const DATE = '2026-02-20';
export const hospital = 'hospitals/hanga_roa';
export const episode = 'synthetic-cudyr-report';
let app: App;
export let db: Firestore;
let rules: RulesTestEnvironment;
export const patient = (bedId: string, id = episode, bedMode = 'Cama') => ({
  bedId,
  bedMode,
  clinicalEpisodeId: id,
  patientName: 'PACIENTE SINTÉTICO ' + bedId,
  firstName: 'PACIENTE',
  lastName: 'SINTÉTICO',
  secondLastName: bedId,
  rut: bedId === 'R1' ? '11111111-1' : 'synthetic-' + bedId,
  documentType: 'RUT',
  pathology: 'Diagnóstico sintético para reporte',
  specialty: 'Medicina',
  admissionDate: '2026-02-18',
  admissionTime: '09:00',
  isBlocked: false,
  hasCompanionCrib: false,
  cudyr: {
    changeClothes: 0,
    mobilization: 0,
    feeding: 0,
    elimination: 0,
    psychosocial: 3,
    surveillance: 3,
    vitalSigns: 2,
    fluidBalance: 0,
    oxygenTherapy: 0,
    airway: 0,
    proInterventions: 0,
    skinCare: 0,
    pharmacology: 0,
    invasiveElements: 0,
  },
});
export const record = () =>
  buildCanonicalE2ERecord(DATE, {
    beds: {
      R1: patient('R1'),
      NEO1: patient('NEO1', 'synthetic-media'),
      H1C1: patient('H1C1', 'synthetic-crib', 'Cuna'),
      CMA1: { ...patient('CMA1', 'synthetic-cma'), location: 'CMA recuperación' },
    },
    discharges: [],
    transfers: [],
    cma: [],
  });
export const seedHospitalAdmissions = async (beds: unknown) => {
  const patients = beds as Record<string, ReturnType<typeof patient> & { location?: string }>;
  for (const p of Object.values(patients)) {
    if (!p.patientName || !p.clinicalEpisodeId) continue;
    const id = 'admission-' + p.clinicalEpisodeId;
    await db.doc(hospital + '/cudyrCaptures/' + id).set({
      schemaVersion: 1,
      id,
      censusDate: p.admissionDate,
      observationIds: [],
      captureContexts: [],
      receivedAt: '2026-02-21T15:00:00Z',
      receivedBy: 'synthetic@example.com',
      verifiedRunId: 'run',
      capture: {
        id,
        clinicalEpisodeId: p.clinicalEpisodeId,
        sourceRunId: 'run',
        observedAt: '2026-02-21T15:00:00Z',
        status: 'observed',
        metadataStatus: 'complete',
        part: 0,
        totalParts: 1,
        totalEvaluations: 0,
        sourcePlacements: [
          {
            clinicalEpisodeId: p.clinicalEpisodeId,
            sourceMappingId: id,
            sourceBedId: p.bedId,
            sourceBedLabel: p.bedId + ' Hospitalizados',
            bedId: p.bedId,
            sourceDepartmentId: 'hospital',
            sourceDepartmentLabel: p.location || 'Médico quirúrgico',
            sourceVersion: 'synthetic',
            sourceStartAt: p.admissionDate + 'T' + p.admissionTime + ':00-05:00',
            sourceEndAt: '',
            currentAssignment: true,
            isDeleted: false,
            modality: p.bedMode === 'Cuna' ? 'cuna' : 'hospitalizacion',
          },
        ],
      },
    });
  }
};
const context = {
  auth: {
    uid: 'synthetic-cudyr-editor',
    token: { email: 'report@example.com', name: 'Editor Sintético' },
  },
};
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
};
test.beforeAll(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host))
    throw new Error('CUDYR browser proof requires a local Firestore emulator.');
  const [hostname, port] = host.split(':');
  // Isolated synthetic demo project only. Browser auth is the repository fixture; callable guards
  // are exercised independently below and in cudyr-discharge.emulator.test.ts.
  rules = await initializeTestEnvironment({
    projectId: 'demo-hhr-e2e',
    firestore: {
      host: hostname,
      port: Number(port),
      rules:
        'rules_version = "2"; service cloud.firestore { match /databases/{database}/documents { match /hospitals/hanga_roa/dailyRecords/{day} { allow read: if true; } } }',
    },
  });
  app = initializeApp({ projectId: 'demo-hhr-e2e' }, 'cudyr-report-e2e');
  db = getFirestore(app);
});
test.afterAll(async () => {
  if (db) await db.terminate();
  if (app) await deleteApp(app);
  if (rules) await rules.cleanup();
});

export const open = async (page: Page, role: 'admin' | 'viewer' = 'admin', daily = false) => {
  for (const collection of [
    'cudyrCaptures',
    'cudyrDailyExclusions',
    'cudyrMonthlyReviews',
    'cudyrMonthlySupplements',
    'cudyrSupplementFiles',
    'cudyrSupplementImports',
  ])
    await db.recursiveDelete(db.collection(hospital + '/' + collection));
  await db.recursiveDelete(db.collection(hospital + '/cudyrDischargeCorrections'));
  await db.recursiveDelete(db.collection(hospital + '/cudyrDischargeAudit'));
  await db.doc(hospital + '/dailyRecords/' + DATE).set(record());
  await seedHospitalAdmissions(record().beds);
  await db.doc(hospital + '/cudyrHistory/synthetic-observation').set({
    schemaVersion: 1,
    id: 'synthetic-observation',
    eventKey: 'synthetic-event',
    censusDate: DATE,
    attributionRule: 'hhr-night-v1',
    captureCensusDate: DATE,
    captureContexts: [{ ...patient('R1'), section: 'census' }],
    evaluation: {
      clinicalEpisodeId: episode,
      sourceEvaluationId: 'synthetic-event',
      category: 'C2',
      source: 'gestion_camas',
      recordedAt: '2026-02-20T20:00:00-05:00',
      author: 'AUTORA SINTÉTICA',
      authorId: 'author',
      authorRole: 'Enfermera',
      dependencyScore: 9,
      riskScore: 8,
    },
    firstCapturedAt: '2026-02-21T06:00:00Z',
    lastVerifiedAt: '2026-02-21T06:00:00Z',
    firstCapturedBy: 'sync@example.com',
    firstCaptureRunId: 'run',
    lastVerifiedRunId: 'run',
  });
  const fns = createCudyrHistoryFunctions({
    firestore: db,
    resolveRoleForEmail: async () => (role === 'admin' ? 'admin' : 'doctor_urgency'),
    hasCallableClinicalAccess: async () => true,
  });
  const calls: string[] = [];
  const requests: { endpoint: string; kind: string }[] = [];
  for (const endpoint of ['readCudyrHistory', 'archiveCudyrHistory'])
    await page.route('**/' + endpoint, async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      calls.push(endpoint);
      const data = route.request().postDataJSON().data;
      requests.push({ endpoint, kind: data.kind || 'observations' });
      const result = await fns[endpoint].run(data, context);
      await route.fulfill({ status: 200, headers: cors, json: { result } });
    });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const runtimeConfig = {
    apiKey: 'placeholder',
    authDomain: 'demo-hhr.firebaseapp.com',
    projectId: 'demo-hhr-e2e',
    storageBucket: 'demo-hhr-e2e.firebasestorage.app',
    messagingSenderId: '1234567890',
    appId: '1:1234567890:web:abcdef123456',
  };
  await page.route('**/.netlify/functions/firebase-config**', route =>
    route.fulfill({ json: runtimeConfig })
  );
  await page.addInitScript(
    config => localStorage.setItem('hhr_firebase_config', JSON.stringify(config)),
    runtimeConfig
  );
  await bootstrapSeededRecord(page, {
    role,
    date: DATE,
    record: record(),
    useRuntimeOverride: true,
  });
  await page.goto('/cudyr?date=' + DATE);
  await ensureAuthenticated(page);
  if (daily) {
    await expect(page.getByText('PACIENTE SINTÉTICO R1', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    return { calls, requests, errors };
  }
  await page.getByRole('button', { name: 'Explorar reporte estadístico' }).click();
  await expect(page.getByRole('heading', { name: 'Explorador CUDYR' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Consultar período' })).toBeEnabled({
    timeout: 30000,
  });
  await page.getByLabel('Desde', { exact: true }).fill(DATE);
  await page.getByLabel('Hasta', { exact: true }).fill(DATE);
  await page.getByRole('button', { name: 'Consultar período' }).click();
  await expect(page.getByText('PACIENTE SINTÉTICO R1', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  return { calls, requests, errors };
};
export const screenshot = async (page: Page, name: string) => {
  if (!process.env.CUDYR_QA_OUTPUT) return;
  await mkdir(process.env.CUDYR_QA_OUTPUT, { recursive: true });
  await page.screenshot({
    path: path.join(process.env.CUDYR_QA_OUTPUT, name + '.png'),
    fullPage: !name.includes('movil'),
    animations: 'disabled',
  });
};
