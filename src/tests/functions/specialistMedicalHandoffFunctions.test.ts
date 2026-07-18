import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const require = createRequire(import.meta.url);
const {
  createSpecialistMedicalHandoffFunctions,
} = require('../../../functions/lib/specialistMedicalHandoffFunctions.js');

const createFirebaseServices = ({
  get = vi.fn(),
  update = vi.fn(),
}: {
  get?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
} = {}) => ({
  firestore: {
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

describe('functions specialistMedicalHandoffFunctions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates a single specialist medical handoff bed via backend', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        beds: {
          R4: {
            bedId: 'R4',
            medicalHandoffNote: 'Previo',
          },
        },
      }),
    });

    const functionsApi = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });

    const result = await functionsApi.updateSpecialistMedicalHandoff.run(
      {
        date: '2026-04-11',
        patch: {
          'beds.R4.medicalHandoffEntries': [
            { id: 'entry-1', note: 'Evolución', specialty: 'medicina' },
          ],
          'beds.R4.medicalHandoffNote': 'Evolución',
          'beds.R4.medicalHandoffAudit': { currentStatus: 'updated_by_specialist' },
          lastUpdated: 'client-value-ignored',
        },
      },
      {
        auth: {
          token: {
            email: 'specialist@example.com',
          },
        },
      }
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        'beds.R4.medicalHandoffEntries': [
          { id: 'entry-1', note: 'Evolución', specialty: 'medicina' },
        ],
        'beds.R4.medicalHandoffNote': 'Evolución',
        'beds.R4.medicalHandoffAudit': { currentStatus: 'updated_by_specialist' },
        lastUpdated: expect.anything(),
      })
    );
    expect(result).toEqual({
      success: true,
      date: '2026-04-11',
      bedId: 'R4',
    });
  });

  it('rejects writes that target fields outside the specialist whitelist', async () => {
    const functionsApi = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices(),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });

    await expect(
      functionsApi.updateSpecialistMedicalHandoff.run(
        {
          date: '2026-04-11',
          patch: {
            'beds.R4.fhir_resource': { resourceType: 'Patient' },
          },
        },
        {
          auth: {
            token: {
              email: 'specialist@example.com',
            },
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('rejects writes for callers without specialist access', async () => {
    const get = vi.fn();
    const update = vi.fn();
    const functionsApi = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('viewer'),
    });

    await expect(
      functionsApi.updateSpecialistMedicalHandoff.run(
        {
          date: '2026-04-11',
          patch: {
            'beds.R4.medicalHandoffNote': 'No deberia pasar',
          },
        },
        {
          auth: {
            token: {
              email: 'viewer@example.com',
            },
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'permission-denied',
    });

    expect(get).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects writes that try to touch more than one bed', async () => {
    const functionsApi = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices(),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });

    await expect(
      functionsApi.updateSpecialistMedicalHandoff.run(
        {
          date: '2026-04-11',
          patch: {
            'beds.R4.medicalHandoffNote': 'R4',
            'beds.R3.medicalHandoffNote': 'R3',
          },
        },
        {
          auth: {
            token: {
              email: 'specialist@example.com',
            },
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects writes when the target bed is missing in the remote record', async () => {
    const update = vi.fn();
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        beds: {},
      }),
    });

    const functionsApi = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });

    await expect(
      functionsApi.updateSpecialistMedicalHandoff.run(
        {
          date: '2026-04-11',
          patch: {
            'beds.R4.medicalHandoffNote': 'Sin cama remota',
          },
        },
        {
          auth: {
            token: {
              email: 'specialist@example.com',
            },
          },
        }
      )
    ).rejects.toMatchObject({
      code: 'failed-precondition',
    });

    expect(update).not.toHaveBeenCalled();
  });
});
