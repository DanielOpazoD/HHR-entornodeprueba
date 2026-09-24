import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createAdminMock, createDailyRecordWriteAuthorityFunctions, makeContext, makeRecord,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';

const require = createRequire(import.meta.url);
const { protectSpecialtyDecisions } = require('../../../functions/lib/specialtyDecisionContract.js');
const { buildJevEvidence } = require('../../../functions/lib/specialtyJevEvidence.js');
const { OPTIONS } = require('../../../functions/lib/specialtyJevAdapter.js');
const currentRapaNuiDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Easter',
    year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const calendar = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${calendar.year}-${calendar.month}-${calendar.day}`;
};

describe('specialty decision through the real clinical authority callable', () => {
  afterEach(() => { delete process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT;
    delete process.env.HHR_JEV_CLINICAL_APPROVED; vi.clearAllMocks(); });

  it('commits a manual selection and one audit event in the same transaction', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    const remote = { ...makeRecord(), meta: { revision: 2 },
      beds: { R1: { ...makeRecord().beds.R1, specialty: '' } } };
    const specialtyPolicyData = { schemaVersion: 1, revision: 1, autoEnabled: false,
      memoryEnabled: false, aiMode: 'off', rules: [], memory: [] };
    const { admin, docRef, transaction, update, set } = createAdminMock({ remoteData: remote,
      specialtyPolicyData });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(), Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });
    const context = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
    const response = await functionsApi.patchDailyRecordWithClinicalAuthority.run({
      date: remote.date, patch: { 'beds.R1.specialty': 'Cirugía' },
      syncContract: { mutationId: 'new-mutation', baseRevision: 2, changedPaths: ['beds.R1.specialty'] },
      specialtyIntent: { kind: 'manual', bedId: 'R1', target: 'bed',
        episodeId: 'ep-uno', value: 'Cirugía', expectedDecisionId: null },
    }, context);
    expect(response.success).toBe(true);
    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(docRef, expect.objectContaining({
      'beds.R1.specialty': 'Cirugía',
      'beds.R1.specialtyAssignment': expect.objectContaining({ source: 'manual', decisionId: 'new-mutation' }),
    }));
    expect(set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decisionId: 'new-mutation' }));
    expect(transaction.set).toHaveBeenCalledOnce();
  });

  it('rejects an untrusted specialty change without explicit intent', () => {
    const remote = { ...makeRecord(), beds: { R1: { ...makeRecord().beds.R1, specialty: 'Cirugía' } } };
    expect(() => protectSpecialtyDecisions({ remoteRecord: remote,
      candidate: { ...remote, beds: { R1: { ...remote.beds.R1, specialty: 'Pediatría' } } },
      actorUid: 'synthetic-user', mutationId: 'm', now: '2026-09-23T00:00:00.000Z' })).toThrow();
  });

  it('does not erase an occupied legacy specialty during an unrelated partial write', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    const base = makeRecord();
    const remote = { ...base, meta: { revision: 2 }, beds: { R1: {
      ...base.beds.R1, clinicalEpisodeId: '', specialty: 'Cirugía', age: '41',
    } } };
    const { admin, docRef, update } = createAdminMock({ remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
      specialtyPolicyData: { schemaVersion: 1, revision: 1, autoEnabled: false,
        memoryEnabled: false, aiMode: 'off', rules: [], memory: [] } });
    const api = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(), Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    const response = await api.patchDailyRecordWithClinicalAuthority.run({
      date: base.date, patch: { 'beds.R1.age': '42' },
      syncContract: { mutationId: 'legacy-age-edit', baseRevision: 2,
        changedPaths: ['beds.R1.age'] },
    }, { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } });
    expect(response.success).toBe(true);
    const write = update.mock.calls.find(([reference]) => reference === docRef)?.[1] as
      Record<string, unknown>;
    expect(write['beds.R1.age']).toBe('42');
    expect(write['beds.R1.specialty']).not.toBe('');
  });

  it('persists verified provenance copied by a partial bed swap', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    const base = makeRecord();
    const metadata = { schemaVersion: 3, episodeId: 'ep-uno', decisionId: 'prior-decision',
      recordDate: base.date, source: 'manual', actorUid: 'synthetic-user',
      decidedAt: '2026-05-13T08:00:00.000Z' };
    const remote = { ...base, meta: { revision: 2 }, beds: {
      R1: { ...base.beds.R1, specialty: 'Cirugía', specialtyAssignment: metadata },
      R2: { ...base.beds.R1, bedId: 'R2', patientName: 'Paciente Dos',
        rut: '22.222.222-2', clinicalEpisodeId: 'ep-dos', specialty: '' },
    } };
    const patch = {
      'beds.R1.patientName': 'Paciente Dos', 'beds.R1.rut': '22.222.222-2',
      'beds.R1.clinicalEpisodeId': 'ep-dos', 'beds.R1.specialty': '',
      'beds.R1.specialtyAssignment': null,
      'beds.R2.patientName': 'Paciente Uno', 'beds.R2.rut': '11.111.111-1',
      'beds.R2.clinicalEpisodeId': 'ep-uno', 'beds.R2.specialty': 'Cirugía',
    };
    const { admin, docRef, update, set } = createAdminMock({ remoteData: remote,
      policyData: { schemaVersion: 2, clinicalBatchMode: 'enforced' },
      specialtyPolicyData: { schemaVersion: 1, revision: 1, autoEnabled: false,
        memoryEnabled: false, aiMode: 'off', rules: [], memory: [] },
      specialtyAuditData: { recordDate: base.date, decisionId: 'prior-decision',
        episodeId: 'ep-uno', value: 'Cirugía', metadata },
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(), Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    const response = await functionsApi.patchDailyRecordWithClinicalAuthority.run({
      date: base.date, patch,
      syncContract: { mutationId: 'swap-mutation', baseRevision: 2,
        changedPaths: Object.keys(patch) },
    }, { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } });
    expect(response.success).toBe(true);
    expect(update).toHaveBeenCalledWith(docRef, expect.objectContaining({
      'beds.R2.specialtyAssignment': metadata,
      'beds.R1.specialtyAssignment': null,
    }));
    expect(set).not.toHaveBeenCalled();
  });

  it('accepts one fresh Jev receipt as one authorized patient write plus audit', async () => {
    process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT = 'enabled';
    process.env.HHR_JEV_CLINICAL_APPROVED = 'enabled';
    const date = currentRapaNuiDate();
    const patient = { ...makeRecord().beds.R1, specialty: '', cie10Code: 'J18.9' };
    const remote = { ...makeRecord(), date, meta: { revision: 2 }, beds: { R1: patient } };
    const specialtyPolicyData = { schemaVersion: 1, revision: 3, autoEnabled: false,
      memoryEnabled: false, aiMode: 'consultative', rules: [], memory: [],
      aiMonthlyLimit: 5, diagnosisLabels: { 'J18.9': 'Neumonía sintética' },
      aiRubrics: Object.fromEntries(OPTIONS.map((key: string) => [key,
        `Criterio de prueba sintético para ${key}.`])) };
    const evidence = buildJevEvidence({ date, bedId: 'R1', target: 'bed',
      patient, policy: specialtyPolicyData });
    const aiRequestData = { status: 'complete', requesterUid: 'synthetic-user',
      date, bedId: 'R1', target: 'bed', episodeId: 'ep-uno',
      policyRevision: 3, digest: evidence.digest,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
      result: { model: 'jev-1.13.0', promptVersion: 'hhr-specialty-choice-v1',
        specialty: 'Med Interna', choice: 'internal_medicine' } };
    const { admin, docRef, aiRequestRef, update, set } = createAdminMock({
      remoteData: remote, specialtyPolicyData, aiRequestData,
    });
    const functionsApi = createDailyRecordWriteAuthorityFunctions({
      firestore: admin.firestore(), Timestamp: admin.firestore.Timestamp,
      resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
    });
    const context = { ...makeContext(), auth: { ...makeContext().auth, uid: 'synthetic-user' } };
    const payload = { date, patch: { 'beds.R1.specialty': 'Med Interna' },
      syncContract: { mutationId: 'ai-mutation', baseRevision: 2,
        changedPaths: ['beds.R1.specialty'] },
      specialtyIntent: { kind: 'accept_ai', requestId: 'synthetic-request-001',
        bedId: 'R1', target: 'bed', episodeId: 'ep-uno',
        value: 'Med Interna', expectedDecisionId: null } };
    await functionsApi.patchDailyRecordWithClinicalAuthority.run(payload, context);
    expect(update).toHaveBeenCalledWith(docRef, expect.objectContaining({
      'beds.R1.specialtyAssignment': expect.objectContaining({ source: 'manual_ai',
        ai: { requestId: 'synthetic-request-001', model: 'jev-1.13.0',
          promptVersion: 'hhr-specialty-choice-v1' } }),
    }));
    expect(update).toHaveBeenCalledWith(aiRequestRef,
      expect.objectContaining({ status: 'accepted', acceptedMutationId: 'ai-mutation' }));
    expect(set).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ source: 'manual_ai', decisionId: 'ai-mutation' }));

    update.mockClear();
    aiRequestData.expiresAt = new Date(Date.now() - 60_000).toISOString();
    await expect(functionsApi.patchDailyRecordWithClinicalAuthority.run(payload, context))
      .rejects.toThrow(/stale or unavailable/i);
    expect(update).not.toHaveBeenCalled();
  });
});
