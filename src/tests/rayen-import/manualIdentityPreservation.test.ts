// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PATIENT } from '@/constants/patient';
import {
  applyCensusImportDiff,
  planRayenCensusImport,
  rayenToPatientData,
  type RayenCensusSnapshot,
  type RayenEncounter,
} from '@/features/rayen-import';
import { isRayenCensusSnapshot } from '@/features/rayen-import/bridge/rayenSnapshotBridge';
import { collectClinicalFillCandidates } from '@/features/rayen-import/domain/clinicalFillCandidates';
import { historicalEncounterFromLocal } from '@/features/rayen-import/domain/historicalEncounterFromLocal';
import {
  applyReviewedPatientChanges,
  diffSyncablePatientFields,
  mergeSyncablePatient,
} from '@/features/rayen-import/domain/patientSyncPolicy';
import { presentPatientUpdates } from '@/features/rayen-import/components/rayenImportUpdatePresentation';
import {
  executeBedManagementAction,
  type BedManagementAuditPort,
  type BedManagementValidationPort,
} from '@/hooks/controllers/bedManagementDispatchController';
import {
  buildClinicalCribMultipleFieldPatches,
  buildUpdateClinicalCribPatches,
  buildUpdatePatientPatches,
} from '@/hooks/controllers/bedManagementPatchController';
import { PatientDataSchema } from '@/schemas/zod/patient';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  createAdminMock,
  createDailyRecordWriteAuthorityFunctions,
  makeContext,
} from '@/tests/functions/dailyRecordWriteAuthorityFunctions.test-support';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { Specialty } from '@/types/domain/patientClassification';
import type { PatientFieldValue } from '@/types/valueTypes';
import { applyPatches } from '@/utils/patchUtils';
import { formatRut, hasNonRutLetter, isValidRut } from '@/utils/rutUtils';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const REFERENCE = new Date('2026-11-26T15:00:00-05:00');
const STAMP = '2026-11-26T15:00:00.000Z';

const touristEncounter = (overrides: Partial<RayenEncounter> = {}): RayenEncounter => ({
  encounterId: '149901',
  // Synthetic 9-digit foreign passport (fails Chilean mod-11 check digit)
  run: '556677884',
  firstGivenName: 'Ana',
  nextGivenNames: 'Clara',
  firstFamilyName: 'Miller',
  birthDate: '1969-05-10',
  administrativeSex: 'Mujer',
  room: 'R1',
  bed: 'R1',
  admissionDatetime: '2026-11-25T11:30:00-05:00',
  diagnosis: 'Neumonía adquirida en la comunidad',
  diagnosisCode: 'J18.9',
  diagnosisDescription: 'Neumonía, organismo no especificado',
  ...overrides,
});

const syncRecord = (current: DailyRecord, encounters: RayenEncounter[]) => {
  const snapshot: RayenCensusSnapshot = {
    capturedAt: REFERENCE.toISOString(),
    facilityId: 1342,
    encounters,
  };
  const { diff } = planRayenCensusImport({ current, snapshot, reference: REFERENCE });
  const result = applyCensusImportDiff(current, diff, {
    now: REFERENCE,
    idFactory: () => 'synthetic-movement',
    syncRunId: 'synthetic-sync',
  });
  return { diff, result };
};

const realValidationPort: BedManagementValidationPort = {
  processFieldValue: (
    field: keyof PatientData,
    value: PatientFieldValue,
    context?: Pick<PatientData, 'documentType'>
  ) => {
    if (field === 'rut' && typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || context?.documentType === 'Pasaporte' || hasNonRutLetter(trimmed)) {
        return { valid: true, value: trimmed };
      }
      const formatted = formatRut(trimmed);
      return { valid: true, value: isValidRut(formatted) ? formatted : trimmed };
    }
    return { valid: true, value };
  },
};

const noopAuditPort: BedManagementAuditPort = {
  auditPatientChange: vi.fn(),
  auditPatientCleared: vi.fn(),
  auditPatientModified: vi.fn(),
  auditPatientMovement: vi.fn(),
};

describe('manual identity edits preserve diagnosis, server authority and Eloísa synchronization', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(STAMP) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
  it.each([
    { label: 'switch RUT to Pasaporte keeping formatted digits', nextRut: '55.667.788-4' },
    { label: 'switch RUT to Pasaporte stripping separators', nextRut: '556677884' },
    { label: 'switch RUT to alphanumeric foreign passport', nextRut: 'US556677884' },
    {
      label: 'switch RUT to numeric passport that passes Chilean mod-11 without reformatting',
      nextRut: '123456785',
    },
  ])(
    'preserves diagnosis, episode ownership, server write and subsequent Eloísa syncs ($label)',
    async ({ nextRut }) => {
      const initialEmpty = DataFactory.createMockDailyRecord('2026-11-26', {
        beds: { R1: { ...EMPTY_PATIENT, bedId: 'R1' } },
        lastUpdated: STAMP,
      });
      const initialSync = syncRecord(initialEmpty, [touristEncounter()]);
      const syncedRecord: DailyRecord = {
        ...initialSync.result.record,
        lastUpdated: STAMP,
      };

      // Initially inferred as RUT because Eloísa did not send documentType for digits only.
      expect(syncedRecord.beds.R1).toMatchObject({
        clinicalEpisodeId: '149901',
        documentType: 'RUT',
        rut: '55.667.788-4',
        pathology: 'Neumonía adquirida en la comunidad',
        cie10Code: 'J18.9',
      });

      const submittedPatches: Record<string, unknown>[] = [];
      let localAfterEdit = syncedRecord;
      const ok = await executeBedManagementAction({
        currentRecord: syncedRecord,
        action: {
          type: 'UPDATE_PATIENT_MULTIPLE',
          bedId: 'R1',
          fields: {
            firstName: syncedRecord.beds.R1.firstName,
            lastName: syncedRecord.beds.R1.lastName,
            secondLastName: syncedRecord.beds.R1.secondLastName,
            patientName: syncedRecord.beds.R1.patientName,
            documentType: 'Pasaporte',
            rut: nextRut,
          },
        },
        validation: realValidationPort,
        bedAudit: noopAuditPort,
        patchRecord: async patch => {
          submittedPatches.push(patch);
          localAfterEdit = applyPatches(localAfterEdit, patch);
        },
      });

      expect(ok).toBe(true);
      // Pure structural patch: 1 single write, no mixed clinical/structural split.
      expect(submittedPatches).toHaveLength(1);
      const [patch] = submittedPatches;
      expect(patch).not.toHaveProperty('beds.R1.pathology');
      expect(patch).not.toHaveProperty('beds.R1.cie10Code');
      expect(patch).not.toHaveProperty('beds.R1.cie10Description');
      expect(patch).not.toHaveProperty('beds.R1.clinicalEpisodeId');
      expect(patch).not.toHaveProperty('beds.R1.specialty');
      expect(patch).not.toHaveProperty('bedTypeOverrides.R1');
      expect(patch['beds.R1.documentType']).toBe('Pasaporte');
      expect(patch['beds.R1.documentManualOverride']).toBe(true);
      expect(localAfterEdit.beds.R1).toMatchObject({
        clinicalEpisodeId: '149901',
        documentType: 'Pasaporte',
        rut: nextRut,
        documentManualOverride: true,
        pathology: 'Neumonía adquirida en la comunidad',
        cie10Code: 'J18.9',
        cie10Description: 'Neumonía, organismo no especificado',
      });

      // Verify the exact patch passes server clinical/structural authority BOTH when specialty is
      // pending and when a confirmed protected specialty already exists.
      for (const withProtectedSpecialty of [false, true]) {
        const remote = structuredClone(syncedRecord);
        const specialtyAssignment = {
          schemaVersion: 3,
          episodeId: '149901',
          decisionId: 'dec-1',
          recordDate: '2026-11-26',
          source: 'manual',
          actorUid: 'nurse-1',
          decidedAt: STAMP,
        } as const;
        if (withProtectedSpecialty) {
          remote.beds.R1.specialty = Specialty.MEDICINA;
          remote.beds.R1.specialtyAssignment = { ...specialtyAssignment };
        }
        const mock = createAdminMock({
          remoteData: {
            ...Object.fromEntries(Object.entries(remote)),
            meta: { revision: 2, lastMutationId: 'initial-sync' },
          },
          policyData: {
            schemaVersion: 2,
            clinicalBatchMode: 'enforced',
            mode: 'auto',
            revision: 7,
          },
          ...(withProtectedSpecialty
            ? {
                specialtyAuditData: {
                  recordDate: '2026-11-26',
                  decisionId: 'dec-1',
                  episodeId: '149901',
                  value: Specialty.MEDICINA,
                  metadata: specialtyAssignment,
                },
              }
            : {}),
        });
        const api = createDailyRecordWriteAuthorityFunctions({
          firestore: mock.admin.firestore(),
          Timestamp: mock.admin.firestore.Timestamp,
          resolveRoleForEmail: vi.fn().mockResolvedValue('nurse_hospital'),
        });
        const response = await api.patchDailyRecordWithClinicalAuthority.run(
          {
            date: '2026-11-26',
            patch,
            expectedLastUpdated: STAMP,
            mode: 'enforced',
            origin: 'outbox',
            clientRuntimeContractVersion: 3,
            syncContract: {
              mutationId: `manual-id-${withProtectedSpecialty}`,
              baseRevision: 2,
              changedPaths: Object.keys(patch),
            },
          },
          makeContext()
        );
        expect(response.success).toBe(true);
        expect(response.recordState.record.beds.R1).toMatchObject({
          clinicalEpisodeId: '149901',
          documentType: 'Pasaporte',
          rut: nextRut,
          documentManualOverride: true,
          pathology: 'Neumonía adquirida en la comunidad',
          ...(withProtectedSpecialty ? { specialty: Specialty.MEDICINA } : {}),
        });
      }

      // Subsequent Eloísa sync with the original source encounter converges cleanly:
      // no conflict, manual passport kept, diagnosis preserved, clinical fill still eligible.
      const resync = syncRecord(localAfterEdit, [touristEncounter()]);
      expect(resync.diff.conflicts).toEqual([]);
      expect(resync.diff.updates).toEqual([]);
      expect(resync.result.skipped).toEqual([]);
      expect(resync.result.record.beds.R1).toMatchObject({
        clinicalEpisodeId: '149901',
        documentType: 'Pasaporte',
        rut: nextRut,
        documentManualOverride: true,
        pathology: 'Neumonía adquirida en la comunidad',
      });
      expect(collectClinicalFillCandidates(resync.result.record, ['149901'])).toHaveLength(1);

      // Later clinical updates from Eloísa (e.g. updated diagnosis or isolation) STILL sync
      // because only document identity was overridden manually, not the diagnosis.
      const clinicalUpdate = syncRecord(resync.result.record, [
        touristEncounter({
          diagnosis: 'Neumonía comunitaria en resolución',
          isIsolated: true,
          isolationType: 'Gotitas',
        }),
      ]);
      expect(clinicalUpdate.diff.conflicts).toEqual([]);
      expect(clinicalUpdate.result.record.beds.R1).toMatchObject({
        clinicalEpisodeId: '149901',
        documentType: 'Pasaporte',
        rut: nextRut,
        documentManualOverride: true,
        pathology: 'Neumonía comunitaria en resolución',
        isIsolated: true,
        isolationType: 'Gotitas',
      });
    }
  );

  it('protects manual document edits made after opening preview and drops override on a new episode', () => {
    const old = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: '149901',
      documentType: 'RUT',
      rut: '55.667.788-4',
    });
    const incoming = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: '149901',
      documentType: 'RUT',
      rut: '55.667.788-9',
    });
    const changes = diffSyncablePatientFields(old, incoming);
    const editedAfterPreview: PatientData = {
      ...old,
      documentType: 'Pasaporte',
      rut: 'US556677884',
      documentManualOverride: true,
    };

    expect(applyReviewedPatientChanges(editedAfterPreview, incoming, changes)).toMatchObject({
      documentType: 'Pasaporte',
      rut: 'US556677884',
      documentManualOverride: true,
    });

    // Different episode does not inherit documentManualOverride.
    const nextEpisode: PatientData = {
      ...incoming,
      clinicalEpisodeId: '149999',
      documentType: 'RUT',
      rut: '12.345.678-5',
    };
    const merged = mergeSyncablePatient(editedAfterPreview, nextEpisode);
    expect(merged).toMatchObject({
      clinicalEpisodeId: '149999',
      documentType: 'RUT',
      rut: '12.345.678-5',
    });
    expect(merged.documentManualOverride).toBeUndefined();
    expect(
      applyReviewedPatientChanges(
        editedAfterPreview,
        nextEpisode,
        diffSyncablePatientFields(editedAfterPreview, nextEpisode)
      ).documentManualOverride
    ).toBeUndefined();
  });

  it('marks manual document edits on clinical cribs and wins over stale false markers', () => {
    const record = DataFactory.createMockDailyRecord('2026-11-26');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente',
      rut: '55.667.788-4',
      documentType: 'RUT',
      documentManualOverride: false,
      clinicalCrib: DataFactory.createMockPatient('R1', {
        bedMode: 'Cuna',
        patientName: 'RN Sintético',
        rut: '55.667.788-4',
        documentType: 'RUT',
        clinicalEpisodeId: '149902',
      }),
    });

    expect(
      buildUpdatePatientPatches(record, 'R1', {
        documentManualOverride: false,
        documentType: 'Pasaporte',
      })
    ).toMatchObject({
      'beds.R1.documentType': 'Pasaporte',
      'beds.R1.documentManualOverride': true,
    });

    expect(
      buildClinicalCribMultipleFieldPatches(record, 'R1', {
        documentType: 'Pasaporte',
        rut: 'RN-PAS-901',
      })
    ).toMatchObject({
      'beds.R1.clinicalCrib.documentType': 'Pasaporte',
      'beds.R1.clinicalCrib.rut': 'RN-PAS-901',
      'beds.R1.clinicalCrib.documentManualOverride': true,
    });

    expect(buildUpdateClinicalCribPatches(record, 'R1', 'documentType', 'Pasaporte')).toEqual({
      'beds.R1.clinicalCrib.documentType': 'Pasaporte',
      'beds.R1.clinicalCrib.documentManualOverride': true,
    });
  });

  it('honors explicit source documentType Pasaporte, validates it at the bridge, and round-trips schema & history', () => {
    const explicitPassport = touristEncounter({ documentType: 'Pasaporte' });
    const mapped = rayenToPatientData(explicitPassport, REFERENCE);
    expect(mapped.patient.documentType).toBe('Pasaporte');
    expect(mapped.patient.rut).toBe('556677884');

    const rebuilt = historicalEncounterFromLocal(mapped.patient);
    expect(rebuilt.documentType).toBe('Pasaporte');
    expect(rayenToPatientData(rebuilt, REFERENCE).patient).toMatchObject({
      documentType: 'Pasaporte',
      rut: '556677884',
    });

    expect(
      isRayenCensusSnapshot({
        capturedAt: STAMP,
        facilityId: 1342,
        encounters: [explicitPassport],
      })
    ).toBe(true);
    expect(
      isRayenCensusSnapshot({
        capturedAt: STAMP,
        facilityId: 1342,
        encounters: [{ ...explicitPassport, documentType: 'INVALID' }],
      })
    ).toBe(false);

    expect(
      PatientDataSchema.parse({ ...mapped.patient, documentManualOverride: true })
        .documentManualOverride
    ).toBe(true);
    expect(
      PatientDataSchema.parse({ ...mapped.patient, documentManualOverride: null })
        .documentManualOverride
    ).toBeUndefined();

    expect(
      presentPatientUpdates([
        {
          bedId: 'R1',
          rut: '556677884',
          patientName: 'Ana Clara Miller',
          changes: [{ field: 'documentType', from: 'RUT', to: 'Pasaporte' }],
          patient: mapped.patient,
          source: explicitPassport,
        },
      ])[0]?.visibleLabels
    ).toEqual(['tipo de documento']);
  });
});
