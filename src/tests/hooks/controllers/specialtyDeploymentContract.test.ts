import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { Specialty } from '@/types/domain/patientClassification';

const require = createRequire(import.meta.url);
const {
  parseSpecialtyIntent,
  protectSpecialtyDecisions,
} = require('../../../../functions/lib/specialtyDecisionContract.js');

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

  it('sends an episode-bound human decision accepted by the server without enabling AI', async () => {
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
    const patchRecord = vi.fn(async (patch, options) => {
      const candidate = structuredClone(record);
      candidate.beds.R2.specialty = patch['beds.R2.specialty'];
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
      expect(candidate.beds.R2.specialtyAssignment).toMatchObject({ source: 'manual' });
    });
    const result = await executeBedManagementAction({
      currentRecord: record,
      action: {
        type: 'UPDATE_PATIENT',
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
      { 'beds.R2.specialty': Specialty.MEDICINA },
      {
        consistency: 'remote_confirmed',
        requireAtomicCas: true,
        specialtyIntent: {
          kind: 'manual',
          bedId: 'R2',
          target: 'bed',
          episodeId: 'synthetic-episode',
          value: Specialty.MEDICINA,
          expectedDecisionId: null,
        },
      }
    );
    expect(featureFlags.isEnabled('SPECIALTY_JEV_CONSULTATION')).toBe(false);
    expect(featureFlags.isEnabled('SPECIALTY_RULES_MEMORY')).toBe(false);
  });

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
