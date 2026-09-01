import {
  extractClinicalAuthorityPatch,
  isDailyRecordBedTreePath,
} from '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting';
import { firestoreWriteLogger } from '@/services/storage/storageLoggers';

/**
 * La escritura parcial hereda a propósito los campos de reparación de la
 * divergencia local (`mergedPatches`): así una edición nueva también sana lo
 * que quedó sin confirmar. Pero cuando esa divergencia contiene campos de la
 * OTRA autoridad (p. ej. un `pathology` envenenado por un parche mixto
 * antiguo), la separación clínico/estructural rechazaba TODA escritura del
 * registro — y como la reparación misma era rechazada, la divergencia no
 * sanaba nunca (verificado en vivo 31-08: ni demografía ni diagnóstico podían
 * volver a guardarse).
 *
 * Esta función poda del parche saliente los campos HEREDADOS de la autoridad
 * contraria a la intención semántica del usuario (`syncContract.changedPaths`).
 * Nunca poda una ruta pedida explícitamente, y no toca nada cuando la
 * intención es mixta o desconocida — ahí siguen mandando los rechazos
 * fail-closed de la separación.
 */
export const stripInheritedAuthorityRepair = (
  patch: Record<string, unknown>,
  semanticChangedPaths: readonly string[] | undefined
): Record<string, unknown> => {
  const semantic = (semanticChangedPaths ?? []).filter(path => path !== 'dateTimestamp');
  if (semantic.length === 0) return patch;

  const clinicalPaths = new Set(Object.keys(extractClinicalAuthorityPatch(patch)));
  const paths = Object.keys(patch).filter(path => path !== 'dateTimestamp');
  const hasClinical = clinicalPaths.size > 0;
  const hasNonClinical = paths.some(path => !clinicalPaths.has(path));
  if (!hasClinical || !hasNonClinical) return patch;

  const semanticSet = new Set(semantic);
  const semanticIsClinical = semantic.every(path => clinicalPaths.has(path));
  const semanticIsStructural = semantic.every(
    path => !clinicalPaths.has(path) && isDailyRecordBedTreePath(path)
  );
  if (semanticIsClinical === semanticIsStructural) return patch;

  const keeps = (path: string): boolean => {
    if (path === 'dateTimestamp' || semanticSet.has(path)) return true;
    return semanticIsClinical ? clinicalPaths.has(path) : !clinicalPaths.has(path);
  };
  const deferred = paths.filter(path => !keeps(path));
  if (deferred.length === 0) return patch;

  firestoreWriteLogger.warn(
    `Reparación heredada de la autoridad ${semanticIsClinical ? 'estructural' : 'clínica'} ` +
      `pospuesta para no mezclar autoridades (${deferred.length} ruta(s)): ${deferred.join(', ')}. ` +
      'Se reintentará con una escritura de su propia autoridad.'
  );
  return Object.fromEntries(Object.entries(patch).filter(([path]) => keeps(path)));
};
