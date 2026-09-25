import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  diffSyncablePatientFields,
  mergeSyncablePatient,
} from '@/features/rayen-import/domain/patientSyncPolicy';
import {
  dismissTreatingPhysician,
  isDismissedTreatingPhysician,
} from '@/shared/census/treatingPhysicianDismissal';

const patient = DataFactory.createMockPatient('R1', {
  clinicalEpisodeId: 'episode-a',
  treatingPhysicianId: 'physician-a',
  treatingPhysicianName: 'Médica A',
});
const dismissed = { ...patient, ...dismissTreatingPhysician(patient) };

describe('episode-scoped treating physician dismissal', () => {
  it('does not reintroduce the same Rayen physician on repeated sync', () => {
    expect(isDismissedTreatingPhysician(dismissed, patient)).toBe(true);
    expect(diffSyncablePatientFields(dismissed, patient)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'treatingPhysicianId' })])
    );
    expect(mergeSyncablePatient(dismissed, patient)).toMatchObject({
      treatingPhysicianId: undefined,
      treatingPhysicianName: undefined,
    });
  });

  it('accepts a different practitioner, even when the display name is unchanged', () => {
    const replacement = { ...patient, treatingPhysicianId: 'physician-b' };
    expect(isDismissedTreatingPhysician(dismissed, replacement)).toBe(false);
    expect(mergeSyncablePatient(dismissed, replacement).treatingPhysicianId).toBe('physician-b');
  });

  it('keeps a replacement physician if Rayen sends the dismissed physician again', () => {
    const manuallyReassigned = {
      ...dismissed,
      treatingPhysicianId: 'physician-b',
      treatingPhysicianName: 'Médico B',
    };
    expect(mergeSyncablePatient(manuallyReassigned, patient)).toMatchObject({
      treatingPhysicianId: 'physician-b',
      treatingPhysicianName: 'Médico B',
    });
  });

  it('does not hide a physician in a different clinical episode', () => {
    const nextEpisode = { ...patient, clinicalEpisodeId: 'episode-b' };
    expect(isDismissedTreatingPhysician(dismissed, nextEpisode)).toBe(false);
    expect(diffSyncablePatientFields(dismissed, nextEpisode)).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'treatingPhysicianId' })])
    );
  });

  it('uses the normalized name when Rayen has no stable practitioner id', () => {
    const nameOnly = { ...patient, treatingPhysicianId: undefined };
    const withoutId = { ...nameOnly, ...dismissTreatingPhysician(nameOnly) };
    expect(
      isDismissedTreatingPhysician(withoutId, {
        ...nameOnly,
        treatingPhysicianName: ' médica   a ',
      })
    ).toBe(true);
  });

  it('does not create a durable dismissal without a stable episode ID', () => {
    const withoutEpisode = { ...patient, clinicalEpisodeId: undefined };
    expect(dismissTreatingPhysician(withoutEpisode)).toEqual({
      treatingPhysicianId: undefined,
      treatingPhysicianName: undefined,
    });
    expect(isDismissedTreatingPhysician(dismissed, withoutEpisode)).toBe(false);
  });

  it('matches the same physician when Rayen changes between ID-only and name-only data', () => {
    const idOnly = { ...patient, treatingPhysicianName: undefined };
    const dismissedIdOnly = {
      ...idOnly,
      ...dismissTreatingPhysician(idOnly, { name: 'Médica A' }),
    };
    expect(
      isDismissedTreatingPhysician(dismissedIdOnly, {
        ...patient,
        treatingPhysicianId: undefined,
      })
    ).toBe(true);

    const nameOnly = { ...patient, treatingPhysicianId: undefined };
    const dismissedNameOnly = {
      ...nameOnly,
      ...dismissTreatingPhysician(nameOnly, { practitionerId: 'physician-a' }),
    };
    expect(
      isDismissedTreatingPhysician(dismissedNameOnly, {
        ...patient,
        treatingPhysicianName: undefined,
      })
    ).toBe(true);
  });

  it('keeps both source and catalog name aliases for temporary ID loss', () => {
    const withAliases = {
      ...patient,
      ...dismissTreatingPhysician(patient, { name: 'Dra. Médica A' }),
    };
    expect(
      isDismissedTreatingPhysician(withAliases, {
        ...patient,
        treatingPhysicianId: undefined,
      })
    ).toBe(true);
    expect(
      isDismissedTreatingPhysician(withAliases, {
        ...patient,
        treatingPhysicianId: undefined,
        treatingPhysicianName: 'Dra. Médica A',
      })
    ).toBe(true);
  });
});
