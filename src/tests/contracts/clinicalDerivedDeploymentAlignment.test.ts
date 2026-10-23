/**
 * The rules, the index exemptions, the storage-policy operator and the critical access matrix spell
 * the clinicalDerived contract names as literals. Renaming a constant or moving another field must
 * fail here instead of silently leaving the rules guard or an exemption behind.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CLINICAL_DERIVED_COLLECTION,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_MOVED_FIELDS,
} from '@/services/storage/clinicalDerivedContract';
import { CRITICAL_FIRESTORE_ACCESS_MATRIX } from '../../../scripts/firestoreRulesCriticalAccessMatrixSupport.mjs';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('clinicalDerived contract · deployment artifacts', () => {
  const matchPath = `/hospitals/{hospitalId}/dailyRecords/{date}/${CLINICAL_DERIVED_COLLECTION}/{clinicalEpisodeId}`;

  it('the rules guard the episode collection and the day marker by their contract names', () => {
    const rules = read('firestore.rules');
    expect(rules).toContain(`match ${matchPath} {`);
    expect(rules).toContain(`['${CLINICAL_DERIVED_LAYOUT_FIELD}']`);
    expect(rules).toContain(`('${CLINICAL_DERIVED_LAYOUT_FIELD}' in resource.data)`);
    expect(
      CRITICAL_FIRESTORE_ACCESS_MATRIX.find(entry => entry.path === CLINICAL_DERIVED_COLLECTION)
    ).toMatchObject({ matchPath, create: 'false', update: 'false', delete: 'false' });
  });

  it('every moved field is exempt from indexing in the episode collection group', () => {
    const { fieldOverrides } = JSON.parse(read('firestore.indexes.json')) as {
      fieldOverrides: Array<{ collectionGroup: string; fieldPath: string; indexes: unknown[] }>;
    };
    const policy = read('scripts/apply-firestore-storage-policy.mjs');
    for (const field of CLINICAL_DERIVED_MOVED_FIELDS) {
      expect(
        fieldOverrides.find(
          entry =>
            entry.collectionGroup === CLINICAL_DERIVED_COLLECTION && entry.fieldPath === field
        )
      ).toEqual({ collectionGroup: CLINICAL_DERIVED_COLLECTION, fieldPath: field, indexes: [] });
      expect(policy).toContain(`'${CLINICAL_DERIVED_COLLECTION}/${field}'`);
    }
  });
});
