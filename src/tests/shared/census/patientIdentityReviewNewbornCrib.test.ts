// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import { preparePatchedRecordPersistence } from '@/services/repositories/dailyRecordPatchPersistenceController';
import { resolveDailyRecordConflict } from '@/services/repositories/conflictResolutionMatrix';
import { findDetachedReviewEdits } from '@/services/repositories/conflictResolutionDetachedEdits';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import {
  IDENTITY_REVIEW_DATE as DATE,
  storedDay,
  syntheticPatient,
} from '@/tests/fixtures/identityReviewDayFixture';

type Json = Record<string, unknown>;

const EDITED_AT = `${DATE}T09:00:00.000Z`;
const PENDING = 'DIAGNOSTICO PENDIENTE SINTETICO';
// Every way a queued edit can name the newborn: its field, its whole crib, the whole bed.
const PATHS = ['beds.R1.clinicalCrib.pathology', 'beds.R1.clinicalCrib', 'beds.R1'];

const newborn = (name: string, episode: string, extra: Json = {}) =>
  syntheticPatient('R1', name, `FAKE-${name.replace(/\s/g, '-')}`, {
    bedMode: 'Cuna',
    clinicalEpisodeId: episode,
    ...extra,
  });

/** A day read from storage: R1 holds a readable mother with `crib` as her newborn. */
const readDay = (crib: Json, lastUpdated?: string): DailyRecord =>
  docToRecord(storedDay({ documentType: 'Pasaporte', clinicalCrib: crib }, { lastUpdated }), DATE);

/** This device's day: the newborn under review, with a diagnosis edited offline. */
const localDay = () => {
  const day = readDay(newborn('RN SINTETICO A', 'ep_synthetic_rn_a', { documentType: 'Cedula' }));
  day.beds.R1.clinicalCrib!.pathology = PENDING;
  return day;
};

const merge = (remote: DailyRecord, local: DailyRecord, path: string) => {
  const merged = resolveDailyRecordConflict(remote, local, { changedPaths: [path] });
  return { merged, detached: findDetachedReviewEdits(remote, local, merged, [path]) };
};

/** The same edit on a bed: R1 itself under review, with a diagnosis edited offline. */
const bedOutcome = (path: string) => {
  const local = docToRecord(storedDay({ documentType: 'Cedula' }), DATE);
  local.beds.R1.pathology = PENDING;
  const remote = docToRecord(
    storedDay({ documentType: 'Pasaporte' }, { lastUpdated: EDITED_AT }),
    DATE
  );
  return resolveDailyRecordConflict(remote, local, { changedPaths: [path] }).beds.R1.pathology;
};

describe('pending work on a newborn crib, which follows the rules of a bed', () => {
  it('writes the diagnosis of the same newborn, edited on its own field', () => {
    // Another session chose the type of that very newborn and episode.
    const remote = readDay(
      newborn('RN SINTETICO A', 'ep_synthetic_rn_a', { documentType: 'Pasaporte' }),
      EDITED_AT
    );

    const { merged, detached } = merge(remote, localDay(), 'beds.R1.clinicalCrib.pathology');

    expect(merged.beds.R1.clinicalCrib).toMatchObject({
      pathology: PENDING,
      documentType: 'Pasaporte',
    });
    expect(detached).toEqual([]);
  });

  it.each([
    ['beds.R1.clinicalCrib', 'beds.R1'],
    ['beds.R1', 'beds.R1'],
  ])('merges the same newborn queued as %s exactly as a bed queued as %s', (path, bedPath) => {
    const remote = readDay(
      newborn('RN SINTETICO A', 'ep_synthetic_rn_a', { documentType: 'Pasaporte' }),
      EDITED_AT
    );

    const { merged, detached } = merge(remote, localDay(), path);

    expect(merged.beds.R1.clinicalCrib).toMatchObject({
      clinicalEpisodeId: 'ep_synthetic_rn_a',
      documentType: 'Pasaporte',
      pathology: bedOutcome(bedPath),
    });
    expect(detached).toEqual([]);
  });

  it.each(PATHS)(
    'keeps the diagnosis queued as %s detached when another newborn holds the crib',
    path => {
      const remote = readDay(
        newborn('RN SINTETICO B', 'ep_synthetic_rn_b', { documentType: 'Pasaporte' }),
        EDITED_AT
      );

      const { merged, detached } = merge(remote, localDay(), path);

      expect(merged.beds.R1.clinicalCrib).toMatchObject({ clinicalEpisodeId: 'ep_synthetic_rn_b' });
      expect(merged.beds.R1.clinicalCrib?.pathology).not.toBe(PENDING);
      // The mother is another patient: her bed is not part of the conflict.
      expect(merged.beds.R1.patientName).toBe('PACIENTE UNO');
      expect(detached).toEqual([path === 'beds.R1' ? 'beds.R1.clinicalCrib' : path]);
    }
  );

  it('never lets an old repair of the newborn RUT replace a newer one', () => {
    const stored = newborn('RN SINTETICO A', 'ep_synthetic_rn_a', {
      documentType: 'Pasaporte',
      rut: 12345678,
    });
    const { record: local } = preparePatchedRecordPersistence(readDay(stored), DATE, {
      'beds.R1.clinicalCrib.rut': 'FAKE-RN-LOCAL-OLD',
    } as DailyRecordPatch);
    const remote = readDay({ ...stored, rut: 'FAKE-RN-REMOTE-NEW' }, EDITED_AT);

    const merged = resolveDailyRecordConflict(remote, local, {
      changedPaths: ['beds.R1.clinicalCrib.rut'],
    });

    expect(merged.beds.R1.clinicalCrib?.rut).toBe('FAKE-RN-REMOTE-NEW');
  });

  it.each(['beds.R1.clinicalCrib', 'beds.R1'])(
    'keeps the edit queued as %s detached when the stored day no longer has the newborn',
    path => {
      const remote = docToRecord(
        storedDay({ documentType: 'Pasaporte' }, { lastUpdated: EDITED_AT }),
        DATE
      );

      const { merged, detached } = merge(remote, localDay(), path);

      expect(merged.beds.R1.clinicalCrib).toBeUndefined();
      expect(merged.beds.R1.patientName).toBe('PACIENTE UNO');
      expect(detached).toEqual(['beds.R1.clinicalCrib']);
    }
  );
});
