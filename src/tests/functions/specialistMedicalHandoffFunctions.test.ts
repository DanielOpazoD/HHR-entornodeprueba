import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-04-11T18:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

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

  it.each(['2001-01-01', '2026-04-10', '2026-04-12'])(
    'rejects specialist writes for %s before reading the record',
    async date => {
      const get = vi.fn();
      const update = vi.fn();
      const api = createSpecialistMedicalHandoffFunctions({
        ...createFirebaseServices({ get, update }),
        resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
      });
      await expect(
        api.updateSpecialistMedicalHandoff.run(
          { date, patch: { 'beds.R4.medicalHandoffNote': 'SYNTHETIC', dateTimestamp: Date.now() } },
          { auth: { token: { email: 'specialist@example.invalid' } } }
        )
      ).rejects.toMatchObject({ code: 'permission-denied' });
      expect(get).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    }
  );

  it.each(['2026-02-31', '../2001-01-01', '2026-4-11'])(
    'rejects malformed date %s even for admins',
    async date => {
      const get = vi.fn();
      const api = createSpecialistMedicalHandoffFunctions({
        ...createFirebaseServices({ get }),
        resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
      });
      await expect(
        api.updateSpecialistMedicalHandoff.run(
          { date, patch: { 'beds.R4.medicalHandoffNote': 'SYNTHETIC' } },
          { auth: { token: { email: 'admin@example.invalid' } } }
        )
      ).rejects.toMatchObject({ code: 'invalid-argument' });
      expect(get).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['2026-04-12T05:59:59Z', '2026-04-11', true],
    ['2026-04-12T06:00:00Z', '2026-04-11', false],
    ['2026-10-12T04:59:59Z', '2026-10-11', true],
    ['2026-10-12T05:00:00Z', '2026-10-11', false],
  ])('uses Pacific/Easter midnight at %s', async (now, date, allowed) => {
    vi.setSystemTime(new Date(now as string));
    const update = vi.fn().mockResolvedValue(undefined);
    const get = vi
      .fn()
      .mockResolvedValue({ exists: true, data: () => ({ date, beds: { R4: {} } }) });
    const api = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });
    const result = api.updateSpecialistMedicalHandoff.run(
      { date, patch: { 'beds.R4.medicalHandoffNote': 'SYNTHETIC' } },
      { auth: { token: { email: 'specialist@example.invalid' } } }
    );
    if (allowed) await expect(result).resolves.toMatchObject({ success: true });
    else await expect(result).rejects.toMatchObject({ code: 'permission-denied' });
    expect(update).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });

  it('rejects a specialist write if midnight passes while fetching the record', async () => {
    const update = vi.fn();
    const get = vi.fn().mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-04-12T06:00:00Z'));
      return { exists: true, data: () => ({ date: '2026-04-11', beds: { R4: {} } }) };
    });
    const api = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });
    await expect(
      api.updateSpecialistMedicalHandoff.run(
        { date: '2026-04-11', patch: { 'beds.R4.medicalHandoffNote': 'SYNTHETIC' } },
        { auth: { token: { email: 'specialist@example.invalid' } } }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 1775926800000])(
    'does not write client timestamp when persisted value is %s',
    async dateTimestamp => {
      const update = vi.fn().mockResolvedValue(undefined);
      const get = vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ date: '2026-04-11', dateTimestamp, beds: { R4: {} } }),
      });
      const api = createSpecialistMedicalHandoffFunctions({
        ...createFirebaseServices({ get, update }),
        resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
      });
      await expect(
        api.updateSpecialistMedicalHandoff.run(
          {
            date: '2026-04-11',
            patch: {
              'beds.R4.medicalHandoffNote': 'SYNTHETIC',
              dateTimestamp: dateTimestamp ?? Date.now(),
            },
          },
          { auth: { token: { email: 'specialist@example.invalid' } } }
        )
      ).resolves.toMatchObject({ success: true });
      expect(update.mock.calls[0][0]).not.toHaveProperty('dateTimestamp');
    }
  );

  it('rejects replacement of a persisted timestamp', async () => {
    const update = vi.fn();
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ date: '2026-04-11', dateTimestamp: 1, beds: { R4: {} } }),
    });
    const api = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });
    await expect(
      api.updateSpecialistMedicalHandoff.run(
        {
          date: '2026-04-11',
          patch: { 'beds.R4.medicalHandoffNote': 'SYNTHETIC', dateTimestamp: Date.now() },
        },
        { auth: { token: { email: 'specialist@example.invalid' } } }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(update).not.toHaveBeenCalled();
  });

  it('rejects inconsistent persisted record dates', async () => {
    const update = vi.fn();
    const get = vi
      .fn()
      .mockResolvedValue({ exists: true, data: () => ({ date: '2001-01-01', beds: { R4: {} } }) });
    const api = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });
    await expect(
      api.updateSpecialistMedicalHandoff.run(
        { date: '2026-04-11', patch: { 'beds.R4.medicalHandoffNote': 'SYNTHETIC' } },
        { auth: { token: { email: 'specialist@example.invalid' } } }
      )
    ).rejects.toMatchObject({ code: 'failed-precondition' });
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves the configured admin historical-edit override', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const get = vi
      .fn()
      .mockResolvedValue({ exists: true, data: () => ({ date: '2001-01-01', beds: { R4: {} } }) });
    const api = createSpecialistMedicalHandoffFunctions({
      ...createFirebaseServices({ get, update }),
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });
    await expect(
      api.updateSpecialistMedicalHandoff.run(
        { date: '2001-01-01', patch: { 'beds.R4.medicalHandoffNote': 'SYNTHETIC' } },
        { auth: { token: { email: 'admin@example.invalid' } } }
      )
    ).resolves.toMatchObject({ success: true });
  });
});
