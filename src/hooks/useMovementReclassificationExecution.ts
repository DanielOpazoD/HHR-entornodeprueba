import { useCallback, useRef } from 'react';

interface MovementReclassificationExecution {
  recordDate: string;
  sourceMovementId: string;
  persist: () => Promise<void> | void;
  onPersisted: () => void;
  onPersistenceError: (error: unknown) => void;
}

/**
 * Claims a source movement before persistence so rapid retries or competing target actions cannot
 * persist or audit the same reclassification twice. Failed persistence releases the claim; a
 * successful claim remains until the source tombstone reaches state (or the hook unmounts).
 */
export const useMovementReclassificationExecution = () => {
  const claimedSourcesRef = useRef(new Set<string>());

  return useCallback((execution: MovementReclassificationExecution): boolean => {
    const key = `${execution.recordDate}:${execution.sourceMovementId}`;
    if (claimedSourcesRef.current.has(key)) return false;
    claimedSourcesRef.current.add(key);

    let persistence: Promise<void>;
    try {
      persistence = Promise.resolve(execution.persist());
    } catch (error) {
      claimedSourcesRef.current.delete(key);
      execution.onPersistenceError(error);
      return false;
    }

    void persistence.then(
      () => {
        try {
          execution.onPersisted();
        } catch (error) {
          execution.onPersistenceError(error);
        }
      },
      error => {
        claimedSourcesRef.current.delete(key);
        execution.onPersistenceError(error);
      }
    );
    return true;
  }, []);
};
