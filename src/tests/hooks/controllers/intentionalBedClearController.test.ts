import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildConfirmedAssociatedCribIdentity,
  canRebaseIntentionalBedClear,
  isIntentionalBedClearAlreadyApplied,
  rebaseIntentionalBedClear,
} from '@/hooks/controllers/intentionalBedClearController';

describe('intentionalBedClearController', () => {
  const intent = {
    bedId: 'R1',
    confirmedLastUpdated: '2026-08-28T10:00:00.000Z',
    confirmedOccupant: {
      clinicalEpisodeId: 'ep-confirmed',
      rut: '11.111.111-1',
      patientName: 'Paciente confirmado',
      admissionDate: '2026-08-27',
    },
  };

  it('rebases the version when the same episode remains in the bed', () => {
    const refreshed = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'ep-confirmed',
          rut: '11.111.111-1',
          patientName: 'Nombre actualizado',
          admissionDate: '2026-08-27',
        }),
      },
    });

    expect(canRebaseIntentionalBedClear(intent, refreshed)).toBe(true);
    expect(rebaseIntentionalBedClear(intent, refreshed).confirmedLastUpdated).toBe(
      refreshed.lastUpdated
    );
  });

  it('blocks rebasing when another episode replaced the occupant', () => {
    const replacement = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'ep-replacement',
          rut: '22.222.222-2',
          patientName: 'Paciente reemplazante',
        }),
      },
    });

    expect(canRebaseIntentionalBedClear(intent, replacement)).toBe(false);
  });

  it('blocks rebasing when a crib was added after an absent crib was confirmed', () => {
    const refreshed = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: {
          ...DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'ep-confirmed',
            rut: '11.111.111-1',
            patientName: 'Paciente confirmado',
            admissionDate: '2026-08-27',
          }),
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            clinicalEpisodeId: 'new-crib-episode',
            patientName: 'RN Nuevo',
          }),
        },
      },
    });

    expect(
      canRebaseIntentionalBedClear({ ...intent, confirmedAssociatedCrib: null }, refreshed)
    ).toBe(false);
  });

  it('represents an unidentified crib but never rebases its confirmation to a new version', () => {
    const blankCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      clinicalEpisodeId: '   ',
      rut: ' ',
      patientName: '  ',
    });
    const confirmedVersion = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: intent.confirmedLastUpdated,
      beds: {
        R1: {
          ...DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'ep-confirmed',
            rut: '11.111.111-1',
            patientName: 'Paciente confirmado',
            admissionDate: '2026-08-27',
          }),
          clinicalCrib: blankCrib,
        },
      },
    });
    const presenceOnly = buildConfirmedAssociatedCribIdentity(blankCrib);

    expect(presenceOnly).toEqual({ presenceOnly: true });
    expect(
      canRebaseIntentionalBedClear(
        { ...intent, confirmedAssociatedCrib: presenceOnly },
        confirmedVersion
      )
    ).toBe(true);

    const refreshed = {
      ...confirmedVersion,
      lastUpdated: '2026-08-28T10:00:03.000Z',
    };
    expect(
      canRebaseIntentionalBedClear({ ...intent, confirmedAssociatedCrib: presenceOnly }, refreshed)
    ).toBe(false);

    confirmedVersion.beds.R1.clinicalCrib = {
      ...blankCrib,
      patientName: 'RN identificado después de confirmar',
    };
    expect(
      canRebaseIntentionalBedClear(
        { ...intent, confirmedAssociatedCrib: presenceOnly },
        confirmedVersion
      )
    ).toBe(false);
  });

  it('allows rebasing when the same parent and associated crib episodes remain', () => {
    const refreshed = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: {
          ...DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'ep-confirmed',
            rut: '11.111.111-1',
            patientName: 'Paciente confirmado',
            admissionDate: '2026-08-27',
          }),
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            clinicalEpisodeId: 'crib-confirmed',
            patientName: 'RN Uno',
            pathology: 'Dato actualizado',
          }),
        },
      },
    });

    expect(
      canRebaseIntentionalBedClear(
        {
          ...intent,
          confirmedAssociatedCrib: {
            clinicalEpisodeId: 'crib-confirmed',
            patientName: 'RN Uno',
          },
        },
        refreshed
      )
    ).toBe(true);
  });

  it('blocks rebasing when the associated crib episode was replaced', () => {
    const refreshed = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: {
          ...DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'ep-confirmed',
            rut: '11.111.111-1',
            patientName: 'Paciente confirmado',
            admissionDate: '2026-08-27',
          }),
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            clinicalEpisodeId: 'replacement-crib',
            patientName: 'RN Dos',
          }),
        },
      },
    });

    expect(
      canRebaseIntentionalBedClear(
        {
          ...intent,
          confirmedAssociatedCrib: {
            clinicalEpisodeId: 'crib-confirmed',
            patientName: 'RN Uno',
          },
        },
        refreshed
      )
    ).toBe(false);
  });

  it('blocks rebasing when the confirmed associated crib was removed', () => {
    const refreshed = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'ep-confirmed',
          rut: '11.111.111-1',
          patientName: 'Paciente confirmado',
          admissionDate: '2026-08-27',
        }),
      },
    });

    expect(
      canRebaseIntentionalBedClear(
        {
          ...intent,
          confirmedAssociatedCrib: {
            clinicalEpisodeId: 'crib-confirmed',
            patientName: 'RN Uno',
          },
        },
        refreshed
      )
    ).toBe(false);
  });

  it('rebases a crib clear against the crib occupant, not the parent bed', () => {
    const refreshed = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: {
          ...DataFactory.createMockPatient('R1', {
            clinicalEpisodeId: 'parent-ep',
            patientName: 'Paciente madre',
          }),
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            clinicalEpisodeId: 'crib-ep',
            rut: '22.222.222-2',
            patientName: 'RN Uno',
          }),
        },
      },
    });
    const cribIntent = {
      bedId: 'R1',
      target: 'clinicalCrib' as const,
      confirmedLastUpdated: intent.confirmedLastUpdated,
      confirmedOccupant: {
        clinicalEpisodeId: 'crib-ep',
        rut: '22.222.222-2',
        patientName: 'RN Uno',
      },
    };

    expect(canRebaseIntentionalBedClear(cribIntent, refreshed)).toBe(true);

    refreshed.beds.R1.clinicalCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      clinicalEpisodeId: 'replacement-crib-ep',
      patientName: 'RN Dos',
    });
    expect(canRebaseIntentionalBedClear(cribIntent, refreshed)).toBe(false);
  });

  it('treats any two different episode ids as different occupants', () => {
    const replacement = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'legacy-replacement',
          rut: '11.111.111-1',
          patientName: 'Paciente confirmado',
          admissionDate: '2026-08-27',
        }),
      },
    });

    expect(
      canRebaseIntentionalBedClear(
        {
          ...intent,
          confirmedOccupant: {
            ...intent.confirmedOccupant,
            clinicalEpisodeId: 'legacy-confirmed',
          },
        },
        replacement
      )
    ).toBe(false);
  });

  it('does not fall back to legacy fields when only one side has an episode id', () => {
    const replacement = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: undefined,
          rut: '11.111.111-1',
          patientName: 'Paciente confirmado',
          admissionDate: '2026-08-27',
        }),
      },
    });

    expect(canRebaseIntentionalBedClear(intent, replacement)).toBe(false);
  });

  it('rejects a same-name legacy occupant when admission time changed', () => {
    const replacement = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: '2026-08-28T10:00:03.000Z',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: undefined,
          rut: '',
          patientName: 'Paciente confirmado',
          admissionDate: '2026-08-27',
          admissionTime: '11:00',
        }),
      },
    });

    expect(
      canRebaseIntentionalBedClear(
        {
          ...intent,
          confirmedOccupant: {
            patientName: 'Paciente confirmado',
            admissionDate: '2026-08-27',
            admissionTime: '08:00',
          },
        },
        replacement
      )
    ).toBe(false);
  });

  it('allows a name-only legacy occupant only at the exact confirmed version', () => {
    const exactRecord = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: intent.confirmedLastUpdated,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: undefined,
          rut: '',
          patientName: 'Paciente confirmado',
          firstSeenDate: '',
          admissionDate: '',
        }),
      },
    });
    const changedRecord = { ...exactRecord, lastUpdated: '2026-08-28T10:00:03.000Z' };
    const nameOnlyIntent = {
      ...intent,
      confirmedOccupant: { patientName: 'Paciente confirmado' },
    };

    expect(canRebaseIntentionalBedClear(nameOnlyIntent, exactRecord)).toBe(true);
    expect(canRebaseIntentionalBedClear(nameOnlyIntent, changedRecord)).toBe(false);
  });

  it('allows a matching RUT without dates only at the exact confirmed version', () => {
    const exactRecord = DataFactory.createMockDailyRecord('2026-08-28', {
      lastUpdated: intent.confirmedLastUpdated,
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: undefined,
          rut: '11.111.111-1',
          firstSeenDate: '',
          admissionDate: '',
        }),
      },
    });
    const changedRecord = { ...exactRecord, lastUpdated: '2026-08-28T10:00:03.000Z' };
    const rutOnlyIntent = {
      ...intent,
      confirmedOccupant: { rut: '11.111.111-1', patientName: 'Paciente confirmado' },
    };

    expect(canRebaseIntentionalBedClear(rutOnlyIntent, exactRecord)).toBe(true);
    expect(canRebaseIntentionalBedClear(rutOnlyIntent, changedRecord)).toBe(false);
  });

  it('recognizes an already-cleared normal bed only when its associated crib is also absent', () => {
    const cleared = DataFactory.createMockDailyRecord('2026-08-28', {
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '',
          pathology: '',
          admissionDate: '',
        }),
      },
    });
    const clearedWithCrib = DataFactory.createMockDailyRecord('2026-08-28', {
      ...cleared,
      beds: {
        R1: {
          ...cleared.beds.R1,
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            patientName: 'RN nuevo',
          }),
        },
      },
    });

    const expectedPatch = { 'beds.R1': cleared.beds.R1 };

    expect(isIntentionalBedClearAlreadyApplied(intent, cleared, expectedPatch)).toBe(true);
    expect(isIntentionalBedClearAlreadyApplied(intent, clearedWithCrib, expectedPatch)).toBe(false);

    const residualClinicalState = {
      ...cleared,
      beds: {
        R1: {
          ...cleared.beds.R1,
          clinicalEpisodeId: 'episodio-aun-vigente',
          devices: ['CVC'],
        },
      },
    };
    expect(isIntentionalBedClearAlreadyApplied(intent, residualClinicalState, expectedPatch)).toBe(
      false
    );
  });

  it('recognizes an already-removed attached crib without treating an occupied crib as applied', () => {
    const withoutCrib = DataFactory.createMockDailyRecord('2026-08-28', {
      beds: { R1: DataFactory.createMockPatient('R1', { patientName: 'Paciente principal' }) },
    });
    const withCrib = DataFactory.createMockDailyRecord('2026-08-28', {
      ...withoutCrib,
      beds: {
        R1: {
          ...withoutCrib.beds.R1,
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            patientName: 'RN vigente',
          }),
        },
      },
    });
    const cribIntent = { ...intent, target: 'clinicalCrib' as const };

    const expectedPatch = { 'beds.R1.clinicalCrib': null };

    expect(isIntentionalBedClearAlreadyApplied(cribIntent, withoutCrib, expectedPatch)).toBe(true);
    expect(isIntentionalBedClearAlreadyApplied(cribIntent, withCrib, expectedPatch)).toBe(false);
  });
});
