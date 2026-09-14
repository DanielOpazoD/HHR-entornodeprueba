import { isE2EDailyRecordAuthorityCallableForced } from '@/shared/runtime/e2eRuntime';

const MOVEMENT_PATHS = new Set(['discharges', 'transfers', 'cma']);

export const isE2EForcedMovementAuthorityPatch = (patch: Record<string, unknown>): boolean => {
  const paths = Object.keys(patch).filter(path => path !== 'dateTimestamp');
  return (
    isE2EDailyRecordAuthorityCallableForced() &&
    paths.length > 0 &&
    paths.every(path => MOVEMENT_PATHS.has(path))
  );
};

export const extractE2EForcedMovementAuthorityPatch = (
  patch: Record<string, unknown>
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(patch).filter(([path]) => path !== 'dateTimestamp'));
