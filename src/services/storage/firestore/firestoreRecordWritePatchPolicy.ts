import type { DailyRecordPartialWriteOptions } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { flattenObject } from '@/services/storage/firestore/firestoreShared';
import { isClinicalAuthorityCallablePatchPath } from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { ConcurrencyError } from '@/services/storage/firestore/firestoreWriteSupport';
import type { SyncTaskContract } from '@/services/storage/syncQueueTypes';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';

const CLINICAL_CRIB_ROOT_PATH = /^beds\.([^.]+)\.clinicalCrib$/;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const collectCreatedClinicalCribPrefixes = (partialData: Record<string, unknown>): string[] => {
  const dottedPrefixes = Object.entries(partialData)
    .filter(([path, value]) => CLINICAL_CRIB_ROOT_PATH.test(path) && isPlainObject(value))
    .map(([path]) => path);
  const nestedBeds = isPlainObject(partialData.beds) ? partialData.beds : {};
  const nestedPrefixes = Object.entries(nestedBeds)
    .filter(([, bed]) => isPlainObject(bed) && isPlainObject(bed.clinicalCrib))
    .map(([bedId]) => `beds.${bedId}.clinicalCrib`);

  return Array.from(new Set([...dottedPrefixes, ...nestedPrefixes]));
};

const stripServerOwnedFieldsFromClinicalCribCreates = (
  partialData: Record<string, unknown>,
  flattenedData: Record<string, unknown>
): Record<string, unknown> => {
  const createdCribPrefixes = collectCreatedClinicalCribPrefixes(partialData);

  if (createdCribPrefixes.length === 0) return flattenedData;

  const nextData = { ...flattenedData };
  createdCribPrefixes.forEach(prefix => {
    RAYEN_OWNED_CLINICAL_FIELDS.forEach(field => {
      const fieldPath = `${prefix}.${field}`;
      Object.keys(nextData).forEach(path => {
        if (path === fieldPath || path.startsWith(`${fieldPath}.`)) {
          delete nextData[path];
        }
      });
    });
  });
  return nextData;
};

export const buildAuthorityPatchSyncContract = (
  syncContract: SyncTaskContract | undefined,
  authorityPatch: Record<string, unknown>
): SyncTaskContract | undefined => {
  if (!syncContract) return undefined;
  const authorityPaths = Object.keys(authorityPatch);
  const changedPaths = (syncContract.changedPaths ?? []).filter(path =>
    authorityPaths.includes(path)
  );
  return {
    ...syncContract,
    changedPaths: changedPaths.length > 0 ? changedPaths : authorityPaths,
  };
};

/**
 * Aplana el parche SIN expandir los objetos de autoridad clínica: aplanar
 * `beds.X.upcChecklist` en sub-rutas de 4 segmentos hacía que dejaran de
 * clasificar como clínicas y la separación de autoridades rechazaba el
 * guardado completo («mezcla campos clínicos y estructurales», verificado en
 * vivo 31-08 con la clasificación UPC). Los objetos clínicos viajan atómicos,
 * igual que el envelope guardado de Rayen y los parches de especialista.
 */
const flattenClinicalAwareDailyRecordPatch = (
  partialData: Record<string, unknown>
): Record<string, unknown> => {
  const flattened = flattenObject(partialData);
  const result: Record<string, unknown> = {};
  const atomicRoots: string[] = [];
  const walk = (value: unknown, parts: string[]): void => {
    if (isClinicalAuthorityCallablePatchPath(parts.join('.'))) {
      atomicRoots.push(parts.join('.'));
      result[parts.join('.')] = value;
      return;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && parts.length < 4) {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(nested, [...parts, ...key.split('.')]);
      }
    }
  };
  for (const [key, value] of Object.entries(partialData)) {
    walk(value, key.split('.'));
  }
  if (atomicRoots.length === 0) return flattened;
  for (const [path, value] of Object.entries(flattened)) {
    if (!atomicRoots.some(root => path === root || path.startsWith(`${root}.`))) {
      result[path] = value;
    }
  }
  return result;
};

export const prepareFirestorePartialData = ({
  partialData,
  specialistScopedPatch,
  intentionalBedClear,
  clinicalCribCreate = false,
}: {
  partialData: Record<string, unknown>;
  specialistScopedPatch: boolean;
  intentionalBedClear: DailyRecordPartialWriteOptions['intentionalBedClear'];
  clinicalCribCreate?: boolean;
}): Record<string, unknown> => {
  if (!intentionalBedClear) {
    if (specialistScopedPatch) return partialData;
    const flattenedData = flattenClinicalAwareDailyRecordPatch(partialData);
    return clinicalCribCreate
      ? stripServerOwnedFieldsFromClinicalCribCreates(partialData, flattenedData)
      : flattenedData;
  }

  const bedPath = `beds.${intentionalBedClear.bedId}`;
  const targetPath =
    intentionalBedClear.target === 'clinicalCrib' ? `${bedPath}.clinicalCrib` : bedPath;
  const allowedPaths = new Set(
    intentionalBedClear.target === 'clinicalCrib'
      ? [targetPath, 'dateTimestamp']
      : [bedPath, `${bedPath}.clinicalEpisodeId`, 'dateTimestamp']
  );
  const generatedEpisodePath = `${bedPath}.clinicalEpisodeId`;
  const unexpectedPath = Object.keys(partialData).find(path => !allowedPaths.has(path));
  if (
    !intentionalBedClear.bedId ||
    intentionalBedClear.bedId.includes('.') ||
    !Object.prototype.hasOwnProperty.call(partialData, targetPath) ||
    unexpectedPath ||
    (intentionalBedClear.target !== 'clinicalCrib' &&
      partialData[generatedEpisodePath] !== undefined &&
      partialData[generatedEpisodePath] !== '')
  ) {
    throw new ConcurrencyError(
      'La limpieza confirmada debe contener únicamente una cama completa y sus metadatos vacíos.'
    );
  }
  if (
    intentionalBedClear.target === 'clinicalCrib' &&
    partialData[targetPath] !== null &&
    partialData[targetPath] !== undefined
  ) {
    throw new ConcurrencyError('La limpieza confirmada de la cuna debe dejarla vacía.');
  }
  return { [targetPath]: partialData[targetPath] ?? null };
};
