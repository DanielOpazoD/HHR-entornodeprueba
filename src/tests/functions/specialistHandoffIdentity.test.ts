import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { buildLegacyClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';

const require = createRequire(import.meta.url);
const {
  createSpecialistMedicalHandoffFunctions,
} = require('../../../functions/lib/specialistMedicalHandoffFunctions.js');
const context = {
  auth: { uid: 'synthetic-specialist', token: { email: 'specialist@example.invalid' } },
};
const patient = {
  patientName: 'Paciente A Sintético',
  rut: '99.999.999-9',
  documentType: 'RUT',
  clinicalEpisodeId: 'synthetic-episode-A',
  medicalHandoffNote: '',
};
const expected = { bedId: 'R4', target: 'bed', ...patient };
const replacement = {
  ...patient,
  patientName: 'Paciente B Sintético',
  clinicalEpisodeId: 'synthetic-episode-B',
};

// Models Firestore's optimistic transaction: a concurrent version discards staged writes and
// reruns the callback with the new snapshot. Direct updates intentionally have no such protection.
type Occupant = Omit<typeof patient, 'clinicalEpisodeId'> & {
  clinicalEpisodeId?: string;
  admissionDate?: string;
  firstSeenDate?: string;
  admissionTime?: string;
};
const setup = (turnover?: () => Occupant, crib = false, initial: Occupant = patient) => {
  let occupant = { ...initial };
  const writes: Record<string, unknown>[] = [];
  const snapshot = () => {
    const captured = { ...occupant };
    return {
      exists: true,
      data: () => ({
        date: '2026-01-01',
        beds: {
          R4: crib ? { ...patient, clinicalCrib: captured } : captured,
        },
      }),
    };
  };
  const commit = (patch: Record<string, unknown>) => {
    writes.push(patch);
    const key = `beds.R4.${crib ? 'clinicalCrib.' : ''}medicalHandoffNote`;
    if (typeof patch[key] === 'string') occupant.medicalHandoffNote = patch[key];
  };
  const docRef = {
    get: async () => {
      const read = snapshot();
      if (turnover) occupant = turnover();
      return read;
    },
    update: async (patch: Record<string, unknown>) => commit(patch),
  };
  const firestore = {
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => docRef }) }) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      let staged: Record<string, unknown> | undefined;
      const tx = {
        get: async () => snapshot(),
        update: (_ref: unknown, patch: Record<string, unknown>) => {
          staged = patch;
        },
      };
      let result = await fn(tx);
      if (turnover) {
        occupant = turnover();
        staged = undefined;
        result = await fn(tx);
      }
      if (staged) commit(staged);
      return result;
    },
  };
  const api = createSpecialistMedicalHandoffFunctions({
    firestore,
    Timestamp: { now: () => 'server-time' },
    resolveRoleForEmail: async () => 'admin',
  });
  return {
    write: (
      expectedOccupants: unknown = [{ ...expected, target: crib ? 'clinicalCrib' : 'bed' }]
    ) =>
      api.updateSpecialistMedicalHandoff.run(
        {
          date: '2026-01-01',
          expectedOccupants,
          patch: {
            [`beds.R4.${crib ? 'clinicalCrib.' : ''}medicalHandoffNote`]: 'Nota de A sintético',
          },
        },
        context
      ),
    legacyWrite: () =>
      api.updateSpecialistMedicalHandoff.run(
        { date: '2026-01-01', patch: { 'beds.R4.medicalHandoffNote': 'Nota antigua sintética' } },
        context
      ),
    writes,
    occupant: () => occupant,
  };
};

describe('specialist handoff occupant binding', () => {
  it.each([false, true])(
    'rejects turnover between read and commit (crib=%s), leaving the new patient untouched',
    async crib => {
      const app = setup(() => ({ ...replacement }), crib);
      await expect(app.write()).rejects.toMatchObject({
        code: 'failed-precondition',
        message: expect.stringContaining('R4'),
      });
      expect(app.writes).toEqual([]);
      expect(app.occupant().medicalHandoffNote).toBe('');
    }
  );

  it('rejects a same-patient readmission with a different episode', async () => {
    const app = setup(() => ({ ...patient, clinicalEpisodeId: 'synthetic-readmission' }));
    await expect(app.write()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(app.writes).toEqual([]);
  });

  it('rejects a mother’s bed note when the newborn moves into that bed', async () => {
    const app = setup(() => ({
      ...patient,
      rut: '',
      patientName: 'RN Sintético',
      clinicalEpisodeId: 'synthetic-newborn',
    }));
    await expect(app.write()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(app.writes).toEqual([]);
  });

  it('rejects a different patient even when an episode id was reused', async () => {
    const app = setup(() => ({ ...replacement, clinicalEpisodeId: patient.clinicalEpisodeId }));
    await expect(app.write()).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(app.writes).toEqual([]);
  });

  it.each([null, [{ ...expected, clinicalEpisodeId: '' }]])(
    'rejects missing episode metadata and asks the old client to reload (%j)',
    async metadata => {
      const app = setup();
      await expect(app.write(metadata)).rejects.toMatchObject({
        code: 'failed-precondition',
        message: expect.stringMatching(/recarga/i),
      });
      expect(app.writes).toEqual([]);
    }
  );

  it('keeps a passport distinct from a RUT with the same stored text', async () => {
    const app = setup();
    await expect(app.write([{ ...expected, documentType: 'Pasaporte' }])).rejects.toMatchObject({
      code: 'failed-precondition',
    });
    expect(app.writes).toEqual([]);
  });

  it.each([false, true])(
    'accepts hydrated or raw legacy patients using the existing id policy (crib=%s)',
    async crib => {
      const legacy = {
        ...patient,
        clinicalEpisodeId: undefined,
        admissionDate: '2025-12-30',
        admissionTime: '09:10',
      };
      const app = setup(undefined, crib, legacy);
      const clinicalEpisodeId = buildLegacyClinicalEpisodeId(legacy);
      await expect(
        app.write([{ ...expected, target: crib ? 'clinicalCrib' : 'bed', clinicalEpisodeId }])
      ).resolves.toMatchObject({ success: true });
      expect(app.occupant().medicalHandoffNote).toBe('Nota de A sintético');
    }
  );

  it('accepts the pre-deploy payload atomically and emits removable compatibility telemetry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const app = setup();
      await expect(app.legacyWrite()).resolves.toMatchObject({ success: true });
      expect(app.occupant().medicalHandoffNote).toBe('Nota antigua sintética');
      expect(warn).toHaveBeenCalledWith(
        'specialist_handoff_legacy_client',
        expect.objectContaining({ bedId: 'R4' })
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('writes the note normally for the expected patient and episode', async () => {
    const app = setup();
    await expect(app.write()).resolves.toMatchObject({ success: true, bedId: 'R4' });
    expect(app.occupant().medicalHandoffNote).toBe('Nota de A sintético');
    expect(app.writes).toHaveLength(1);
  });
});
