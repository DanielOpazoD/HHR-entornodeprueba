import { vi } from 'vitest';

vi.mock('firebase-functions/v1', () => ({
  https: {
    onCall: (handler: (data: unknown, context: unknown) => unknown) => ({ run: handler }),
    HttpsError: class HttpsError extends Error {
      code: string;

      constructor(code: string, message: string) {
        super(message);
        this.code = code;
      }
    },
  },
}));

export const occupant = {
  clinicalEpisodeId: 'synthetic-episode',
  patientName: 'Paciente Sintético',
  rut: '99.999.999-9',
  documentType: 'RUT',
};
export const expectedOccupants = [{ bedId: 'R4', target: 'bed', ...occupant }];

export const createFirebaseServices = ({
  get = vi.fn(),
  update = vi.fn(),
}: {
  get?: () => unknown;
  update?: (patch: unknown) => unknown;
} = {}) => ({
  firestore: {
    runTransaction: async (fn: (transaction: unknown) => Promise<unknown>) =>
      fn({ get, update: (_ref: unknown, patch: unknown) => update(patch) }),
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get, update }),
        }),
      }),
    }),
  },
  Timestamp: {
    now: vi.fn(() => ({ seconds: 1, nanoseconds: 0 })),
  },
});
