import { createRequire } from 'node:module';
import { expect } from 'vitest';

const require = createRequire(import.meta.url);
const functionsRequire = createRequire(require.resolve('../../../functions/package.json'));
const { Timestamp } = functionsRequire('firebase-admin/firestore');

export const copies = (count: number) =>
  new Map(
    Array.from({ length: count }, (_, index) => [
      `copy-${index}`,
      { snapshotTimestamp: new Timestamp(1_700_000_000 + index, 0) },
    ])
  );

// A stateful Firestore double: missing parent documents still appear in listDocuments.
// Any access outside history or any attempt to fetch a whole snapshot fails the test.
export const store = (days: Map<string, ReturnType<typeof copies>>, afterCommit = () => {}) => {
  const deletedPaths: string[] = [];
  const batches: number[] = [];
  const readDays: string[] = [];
  const history = (dayId: string) => ({
    doc: (id: string) => ({
      id,
      dayId,
      path: `hospitals/hanga_roa/dailyRecords/${dayId}/history/${id}`,
    }),
    select: (field: string) => {
      expect(field).toBe('snapshotTimestamp');
      return {
        get: async () => {
          readDays.push(dayId);
          return {
            docs: [...(days.get(dayId) || [])].map(([id, data]) => ({
              id,
              get: (field: string) => {
                expect(field).toBe('snapshotTimestamp');
                return data.snapshotTimestamp;
              },
            })),
          };
        },
      };
    },
  });
  const firestore = {
    collection: (name: string) => {
      expect(name).toBe('hospitals');
      return {
        doc: (hospitalId: string) => {
          expect(hospitalId).toBe('hanga_roa');
          return {
            collection: (name: string) => {
              expect(name).toBe('dailyRecords');
              return {
                listDocuments: async () =>
                  [...days.keys()].map(id => ({
                    id,
                    collection: (name: string) => {
                      expect(name).toBe('history');
                      return history(id);
                    },
                  })),
              };
            },
          };
        },
      };
    },
    batch: () => {
      const pending: ReturnType<ReturnType<typeof history>['doc']>[] = [];
      return {
        delete: (ref: ReturnType<ReturnType<typeof history>['doc']>) => pending.push(ref),
        commit: async () => {
          expect(pending.length).toBeLessThanOrEqual(400);
          for (const ref of pending) {
            days.get(ref.dayId)?.delete(ref.id);
            deletedPaths.push(ref.path);
          }
          batches.push(pending.length);
          afterCommit();
        },
      };
    },
  };
  return { firestore, deletedPaths, batches, readDays };
};
