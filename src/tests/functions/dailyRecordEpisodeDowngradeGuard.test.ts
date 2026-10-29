import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { PatientData } from '@/types/domain/patient';

type Evidence = Pick<
  PatientData,
  | 'patientName'
  | 'rut'
  | 'documentType'
  | 'clinicalEpisodeId'
  | 'admissionDate'
  | 'firstSeenDate'
  | 'admissionTime'
  | 'isBlocked'
>;
type Movement = {
  clinicalEpisodeId?: Evidence['clinicalEpisodeId'];
  originalData?: Pick<Evidence, 'clinicalEpisodeId'>;
  deletedAt?: string;
};
type RecordEvidence = {
  beds: Record<string, Evidence & { clinicalCrib?: Evidence }>;
  discharges?: Movement[];
  transfers?: Movement[];
  cma?: Movement[];
};
type Downgrade = {
  bedId: string;
  remotePatientName: string;
  remoteEpisodeId: string;
  localEpisodeId: string;
};
const require = createRequire(import.meta.url);
const findPersistedEpisodeDowngrades: (
  remote: RecordEvidence,
  local: RecordEvidence
) => Downgrade[] =
  require('../../../functions/lib/dailyRecordErasureGuard.js').findPersistedEpisodeDowngrades;

const patient = (changes: Partial<Evidence> = {}): Evidence => ({
  patientName: 'Persona Sintética',
  rut: '22.222.222-2',
  documentType: 'RUT',
  admissionDate: '2026-05-13',
  admissionTime: '08:00',
  isBlocked: false,
  clinicalEpisodeId: 'ep_saved',
  ...changes,
});
const record = (occupant: Evidence, crib = false): RecordEvidence => ({
  beds: {
    R1: crib
      ? { ...patient({ patientName: '', clinicalEpisodeId: '' }), clinicalCrib: occupant }
      : occupant,
  },
});

describe.each([false, true])('persisted episode downgrade, crib=%s', crib => {
  it.each(['legacy_ep_generated', '', undefined, '   '])('detects replacement by %s', id => {
    expect(
      findPersistedEpisodeDowngrades(
        record(patient(), crib),
        record(patient({ clinicalEpisodeId: id }), crib)
      )
    ).toEqual([
      {
        bedId: crib ? 'R1 (cuna RN)' : 'R1',
        remotePatientName: 'Persona Sintética',
        remoteEpisodeId: 'ep_saved',
        localEpisodeId: id?.trim() ?? '',
      },
    ]);
  });

  it.each([
    { label: 'legacy promotion', previous: 'legacy_ep_old', next: 'ep_saved' },
    { label: 'first hydration', previous: undefined, next: 'legacy_ep_generated' },
    { label: 'strong source adoption including RN', previous: 'ep_saved', next: 'EloisaNewborn' },
    { label: 'same explicit ID', previous: 'ep_saved', next: 'ep_saved' },
    { label: 'legacy replacement', previous: 'legacy_ep_old', next: 'legacy_ep_new' },
  ])('permits $label', ({ previous, next }) => {
    expect(
      findPersistedEpisodeDowngrades(
        record(patient({ clinicalEpisodeId: previous }), crib),
        record(patient({ clinicalEpisodeId: next }), crib)
      )
    ).toEqual([]);
  });

  it.each([
    { patientName: 'Otra Persona' },
    { rut: '33.333.333-3' },
    { documentType: 'Pasaporte' },
    { admissionDate: '2026-05-14' },
    { admissionTime: '12:00' },
    { admissionDate: undefined },
    { isBlocked: true },
    { patientName: '' },
  ] satisfies Partial<Evidence>[])(
    'does not infer a downgrade with different evidence %j',
    changes => {
      expect(
        findPersistedEpisodeDowngrades(
          record(patient(), crib),
          record(
            patient({
              clinicalEpisodeId: 'legacy_ep_new',
              ...changes,
            }),
            crib
          )
        )
      ).toEqual([]);
    }
  );

  it('requires a nonempty admission anchor even when both copies lack one', () => {
    const remote = patient({ admissionDate: '', firstSeenDate: undefined });
    expect(
      findPersistedEpisodeDowngrades(
        record(remote, crib),
        record(
          {
            ...remote,
            clinicalEpisodeId: '',
          },
          crib
        )
      )
    ).toEqual([]);
  });

  it('uses firstSeenDate as an admission anchor and normalizes RUT and name evidence', () => {
    const remote = patient({ firstSeenDate: '2026-05-12' });
    expect(
      findPersistedEpisodeDowngrades(
        record(remote, crib),
        record(
          {
            ...remote,
            clinicalEpisodeId: '',
            admissionDate: '2026-05-14',
            rut: '22222222-2',
            patientName: ' PERSONA  SINTETICA ',
          },
          crib
        )
      )
    ).toHaveLength(1);
  });

  it('ignores inactive or unnamed stored occupants', () => {
    const local = record(patient({ clinicalEpisodeId: '' }), crib);
    expect(
      findPersistedEpisodeDowngrades(record(patient({ isBlocked: true }), crib), local)
    ).toEqual([]);
    expect(
      findPersistedEpisodeDowngrades(record(patient({ patientName: '' }), crib), local)
    ).toEqual([]);
  });

  it.each(['SYNTHETIC-P123', 'SYNTHETICP123', 'synthetic-p123', 'SYNTHETIC-P124'])(
    'compares passport text exactly for %s',
    passport => {
      const remote = patient({ rut: 'SYNTHETIC-P123', documentType: 'Pasaporte' });
      const result = findPersistedEpisodeDowngrades(
        record(remote, crib),
        record(
          {
            ...remote,
            rut: passport,
            clinicalEpisodeId: 'legacy_ep_passport',
          },
          crib
        )
      );
      expect(result).toHaveLength(passport === 'SYNTHETIC-P123' ? 1 : 0);
    }
  );
});

describe('episode survival across locations and closures', () => {
  it.each([false, true])('detects a downgrade in a different location, crib=%s', crib => {
    const local = record(patient({ clinicalEpisodeId: '' }), crib);
    local.beds.R2 = local.beds.R1;
    delete local.beds.R1;
    expect(findPersistedEpisodeDowngrades(record(patient()), local)).toHaveLength(1);
  });

  it.each([false, true])(
    'permits the same ID surviving in another active occupant, crib=%s',
    crib => {
      const local = record(patient({ clinicalEpisodeId: '' }));
      local.beds.R2 = record(patient({ patientName: 'Nombre Corregido' }), crib).beds.R1;
      expect(findPersistedEpisodeDowngrades(record(patient()), local)).toEqual([]);
    }
  );

  it('does not count an ID in a blocked occupant as active survival', () => {
    const local = record(patient({ clinicalEpisodeId: '' }));
    local.beds.R2 = patient({ isBlocked: true });
    expect(findPersistedEpisodeDowngrades(record(patient()), local)).toHaveLength(1);
  });

  it('does not count an ID in an empty slot as a surviving occupant', () => {
    const local = record(patient({ clinicalEpisodeId: '' }));
    local.beds.R2 = patient({ patientName: '' });
    expect(findPersistedEpisodeDowngrades(record(patient()), local)).toHaveLength(1);
  });

  describe.each(['discharges', 'transfers', 'cma'] satisfies (keyof Omit<
    RecordEvidence,
    'beds'
  >)[])('%s closure accounting', collection => {
    it.each([false, true])('accounts for either ID field, originalData=%s', nested => {
      const local = record(patient({ clinicalEpisodeId: 'legacy_ep_readmission' }));
      local[collection] = [
        nested
          ? { clinicalEpisodeId: 'other_id', originalData: { clinicalEpisodeId: 'ep_saved' } }
          : { clinicalEpisodeId: 'ep_saved', originalData: { clinicalEpisodeId: 'other_id' } },
      ];
      expect(findPersistedEpisodeDowngrades(record(patient()), local)).toEqual([]);
      local[collection][0].deletedAt = '2026-05-13T15:00:00.000Z';
      expect(findPersistedEpisodeDowngrades(record(patient()), local)).toHaveLength(1);
    });

    it('does not account for an unrelated closure', () => {
      const local = record(patient({ clinicalEpisodeId: '' }));
      local[collection] = [{ clinicalEpisodeId: 'ep_other' }];
      expect(findPersistedEpisodeDowngrades(record(patient()), local)).toHaveLength(1);
    });
  });

  it('does not change either input on rejection or acceptance', () => {
    const remote = record(patient(), true);
    const local = record(patient({ clinicalEpisodeId: '' }), true);
    const before = structuredClone({ remote, local });
    expect(findPersistedEpisodeDowngrades(remote, local)).toHaveLength(1);
    expect({ remote, local }).toEqual(before);
    local.discharges = [{ originalData: { clinicalEpisodeId: 'ep_saved' } }];
    const acceptedBefore = structuredClone(local);
    expect(findPersistedEpisodeDowngrades(remote, local)).toEqual([]);
    expect(remote).toEqual(before.remote);
    expect(local).toEqual(acceptedBefore);
  });
});
