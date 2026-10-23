import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApplyDailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types/domain/patientClassification';

const require = createRequire(import.meta.url);
const {
  parseSpecialtyIntent,
  protectSpecialtyDecisions,
} = require('../../../../functions/lib/specialtyDecisionContract.js');

const deployedManualSwitch = (context: string): string => {
  const configuration = readFileSync('netlify.toml', 'utf8');
  const section = configuration.split(`[context.${context}.environment]`)[1]?.split('\n[')[0];
  return section?.match(/^\s*VITE_HHR_SPECIALTY_EPISODE_ASSIGNMENT\s*=\s*"([^"]*)"/m)?.[1] ?? '';
};

describe('published manual specialty deployment contract', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_HHR_SPECIALTY_JEV_PILOT', '');
    vi.stubEnv('VITE_HHR_SPECIALTY_EPISODE_ASSIGNMENT', 'enabled');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
  });

  it.each([
    ['production', 'bed'],
    ['production', 'clinicalCrib'],
    ['deploy-preview', 'bed'],
    ['deploy-preview', 'clinicalCrib'],
  ] as const)(
    'sends a server-accepted %s decision for %s without enabling AI',
    async (context, target) => {
      vi.stubEnv('VITE_HHR_SPECIALTY_EPISODE_ASSIGNMENT', deployedManualSwitch(context));
      localStorage.setItem(
        'hhr_feature_flags',
        JSON.stringify({ SPECIALTY_EPISODE_ASSIGNMENT: false })
      );
      const { featureFlags } = await import('@/services/utils/featureFlags');
      const { executeBedManagementAction } =
        await import('@/hooks/controllers/bedManagementDispatchController');
      const record = DataFactory.createMockDailyRecord('2026-10-07');
      record.beds.R2 = DataFactory.createMockPatient('R2', {
        specialty: Specialty.PSIQUIATRIA,
        clinicalEpisodeId: 'synthetic-episode',
      });
      record.beds.R2.clinicalCrib = DataFactory.createMockPatient('R2', {
        specialty: Specialty.PEDIATRIA,
        clinicalEpisodeId: 'synthetic-crib-episode',
      });
      const scalarPath = target === 'bed' ? 'beds.R2.specialty' : 'beds.R2.clinicalCrib.specialty';
      const patchRecord = vi.fn<ApplyDailyRecordPatch>(async (patch, options) => {
        const candidate = structuredClone(record);
        const patient = target === 'bed' ? candidate.beds.R2 : candidate.beds.R2.clinicalCrib;
        if (!patient) throw new Error('Missing synthetic crib');
        patient.specialty = Specialty.MEDICINA;
        const decisions = protectSpecialtyDecisions({
          remoteRecord: record,
          candidate,
          patch,
          intent: parseSpecialtyIntent(options?.specialtyIntent),
          actorUid: 'synthetic-user',
          mutationId: 'synthetic-mutation',
          now: '2026-10-07T12:00:00.000Z',
        });
        expect(decisions).toHaveLength(1);
        expect(patient.specialtyAssignment).toMatchObject({ source: 'manual' });
      });
      const result = await executeBedManagementAction({
        currentRecord: record,
        action: {
          type: target === 'bed' ? 'UPDATE_PATIENT' : 'UPDATE_CLINICAL_CRIB',
          bedId: 'R2',
          field: 'specialty',
          value: Specialty.MEDICINA,
        },
        validation: { processFieldValue: vi.fn((_field, value) => ({ valid: true, value })) },
        bedAudit: {
          auditPatientChange: vi.fn(),
          auditCudyrChange: vi.fn(),
          auditCribCudyrChange: vi.fn(),
          auditPatientCleared: vi.fn(),
          auditPatientModified: vi.fn(),
          auditPatientMovement: vi.fn(),
        },
        patchRecord,
      });
      expect(result).toBe(true);
      expect(patchRecord).toHaveBeenCalledExactlyOnceWith(
        { [scalarPath]: Specialty.MEDICINA },
        {
          consistency: 'remote_confirmed',
          requireAtomicCas: true,
          specialtyIntent: {
            kind: 'manual',
            bedId: 'R2',
            target,
            episodeId: target === 'bed' ? 'synthetic-episode' : 'synthetic-crib-episode',
            value: Specialty.MEDICINA,
            expectedDecisionId: null,
          },
        }
      );
      expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(false);
      expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(false);
    }
  );

  it('keeps legacy deployments unchanged when neither build switch is enabled', async () => {
    vi.stubEnv('VITE_HHR_SPECIALTY_EPISODE_ASSIGNMENT', '');
    const { featureFlags } = await import('@/services/utils/featureFlags');
    expect(featureFlags.isEnabled('SPECIALTY_EPISODE_ASSIGNMENT')).toBe(false);
    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(false);
  });

  it('preserves the existing combined Jev pilot switch', async () => {
    vi.stubEnv('VITE_HHR_SPECIALTY_EPISODE_ASSIGNMENT', '');
    vi.stubEnv('VITE_HHR_SPECIALTY_JEV_PILOT', 'enabled');
    const { featureFlags } = await import('@/services/utils/featureFlags');
    expect(featureFlags.isEnabled('SPECIALTY_EPISODE_ASSIGNMENT')).toBe(true);
    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(true);
  });
});
