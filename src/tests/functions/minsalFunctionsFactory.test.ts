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
const { createMinsalFunctions } = require('../../../functions/lib/minsalFunctions.js');

type FakeFirestoreDoc = Record<string, unknown>;

const createHospitalFirestore = ({
  dailyRecords = {},
  reclassifications = {},
}: {
  dailyRecords?: Record<string, FakeFirestoreDoc>;
  reclassifications?: Record<string, FakeFirestoreDoc>;
}) => {
  const state = {
    dailyRecords: { ...dailyRecords },
    analyticsSpecialtyReclassifications: { ...reclassifications },
    auditLogs: {} as Record<string, FakeFirestoreDoc>,
  };
  const writes: Array<{ path: string; data: FakeFirestoreDoc }> = [];

  const buildCollection = (collectionPath: string, collectionName: keyof typeof state) => {
    const applyFilters = (filters: Array<[string, string, string]>) =>
      Object.entries(state[collectionName]).filter(([, value]) =>
        filters.every(([field, operator, expected]) => {
          const actual = String(value[field] || '');
          if (operator === '>=') return actual >= expected;
          if (operator === '<=') return actual <= expected;
          if (operator === '==') return actual === expected;
          return false;
        })
      );

    const buildQuery = (filters: Array<[string, string, string]>) => ({
      where: (field: string, operator: string, value: string) =>
        buildQuery([...filters, [field, operator, value]]),
      get: vi.fn().mockResolvedValue({
        forEach: (callback: (doc: { id: string; data: () => FakeFirestoreDoc }) => void) => {
          applyFilters(filters).forEach(([id, value]) => callback({ id, data: () => value }));
        },
      }),
    });

    return {
      doc: (docId?: string) => {
        const resolvedId = docId || `auto-${Object.keys(state[collectionName]).length + 1}`;
        return {
          get: vi.fn().mockResolvedValue({
            exists: Boolean(state[collectionName][resolvedId]),
            id: resolvedId,
            data: () => state[collectionName][resolvedId],
          }),
          set: vi.fn().mockImplementation(async (data: FakeFirestoreDoc) => {
            state[collectionName][resolvedId] = data;
            writes.push({
              path: `${collectionPath}/${resolvedId}`,
              data,
            });
          }),
        };
      },
      where: (field: string, operator: string, value: string) =>
        buildQuery([[field, operator, value]]),
    };
  };

  const firestore = {
    collection: (_rootName: string) => ({
      doc: (hospitalId: string) => ({
        collection: (collectionName: keyof typeof state) =>
          buildCollection(`hospitals/${hospitalId}/${collectionName}`, collectionName),
      }),
    }),
  };

  return { firestore, state, writes };
};

describe('functions minsalFunctions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated calls', async () => {
    const functionsApi = createMinsalFunctions({
      admin: { firestore: vi.fn() },
      hospitalCapacity: 12,
      hasCallableClinicalAccess: vi.fn(),
    });

    await expect(functionsApi.calculateMinsalStats.run({}, { auth: null })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('returns computed statistics for a valid request', async () => {
    const get = vi.fn().mockResolvedValue({
      forEach: (
        callback: (doc: {
          data: () => {
            beds: Record<string, unknown>;
            discharges: unknown[];
            transfers: unknown[];
          };
        }) => void
      ) => {
        callback({ data: () => ({ beds: {}, discharges: [], transfers: [] }) });
      },
    });
    const whereEnd = vi.fn(() => ({ get }));
    const whereStart = vi.fn(() => ({ where: whereEnd }));

    const admin = {
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              where: whereStart,
            }),
          }),
        }),
      }),
    };

    const functionsApi = createMinsalFunctions({
      admin,
      hospitalCapacity: 12,
      hasCallableClinicalAccess: vi.fn().mockResolvedValue(true),
    });

    const result = await functionsApi.calculateMinsalStats.run(
      {
        hospitalId: 'hanga_roa',
        startDate: '2026-03-01',
        endDate: '2026-03-02',
      },
      { auth: { token: { email: 'user@example.com' } } }
    );

    expect(result.totalDays).toBe(1);
    expect(get).toHaveBeenCalled();
  });

  it('allows admins to persist a statistical specialty reclassification with audit metadata', async () => {
    const fake = createHospitalFirestore({
      dailyRecords: {
        '2026-03-05': {
          date: '2026-03-05',
          beds: {},
          discharges: [
            {
              id: 'd-1',
              patientName: 'Alta Reclasificada',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico',
              status: 'Vivo',
              specialty: 'Oftalmología',
              time: '10:00',
            },
          ],
        },
      },
    });

    const functionsApi = createMinsalFunctions({
      admin: { firestore: () => fake.firestore },
      hospitalCapacity: 12,
      hasCallableClinicalAccess: vi.fn().mockResolvedValue(true),
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });

    const result = await functionsApi.setMinsalSpecialtyReclassification.run(
      {
        hospitalId: 'hanga_roa',
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        reportingSpecialty: 'Cirugía',
      },
      {
        auth: {
          uid: 'admin-uid',
          token: {
            email: 'admin@example.com',
            name: 'Admin HHR',
          },
        },
        rawRequest: {
          ip: '203.0.113.9',
          get: (header: string) => (header.toLowerCase() === 'user-agent' ? 'TestAgent' : ''),
        },
      }
    );

    const saved = fake.state.analyticsSpecialtyReclassifications['2026-03-05_discharge_d-1'];
    expect(result).toEqual({ ok: true, active: true });
    expect(saved).toMatchObject({
      date: '2026-03-05',
      movementKind: 'discharge',
      movementId: 'd-1',
      originalSpecialty: 'Oftalmología',
      reportingSpecialty: 'Cirugía',
      active: true,
      updatedByUid: 'admin-uid',
      updatedByEmail: 'admin@example.com',
      updatedByName: 'Admin HHR',
      clientIp: '203.0.113.9',
      userAgent: 'TestAgent',
    });
    expect(Object.values(fake.state.auditLogs)[0]).toMatchObject({
      action: 'STATISTICAL_SPECIALTY_RECLASSIFIED',
      entityType: 'statistics',
      entityId: '2026-03-05_discharge_d-1',
      recordDate: '2026-03-05',
    });
  });

  it('deactivates a persisted statistical specialty reclassification without deleting audit history', async () => {
    const fake = createHospitalFirestore({
      dailyRecords: {
        '2026-03-05': {
          date: '2026-03-05',
          beds: {},
          discharges: [
            {
              id: 'd-1',
              patientName: 'Alta Reclasificada',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico',
              status: 'Vivo',
              specialty: 'Oftalmología',
              time: '10:00',
            },
          ],
        },
      },
      reclassifications: {
        '2026-03-05_discharge_d-1': {
          date: '2026-03-05',
          movementKind: 'discharge',
          movementId: 'd-1',
          originalSpecialty: 'Oftalmología',
          reportingSpecialty: 'Cirugía',
          active: true,
        },
      },
    });

    const functionsApi = createMinsalFunctions({
      admin: { firestore: () => fake.firestore },
      hospitalCapacity: 12,
      hasCallableClinicalAccess: vi.fn().mockResolvedValue(true),
      resolveRoleForEmail: vi.fn().mockResolvedValue('admin'),
    });

    const result = await functionsApi.setMinsalSpecialtyReclassification.run(
      {
        hospitalId: 'hanga_roa',
        date: '2026-03-05',
        movementKind: 'discharge',
        movementId: 'd-1',
        reportingSpecialty: null,
      },
      {
        auth: {
          uid: 'admin-uid',
          token: {
            email: 'admin@example.com',
            name: 'Admin HHR',
          },
        },
        rawRequest: {
          headers: {
            'x-forwarded-for': '198.51.100.11, 10.0.0.1',
            'user-agent': 'DeactivateAgent',
          },
        },
      }
    );

    const saved = fake.state.analyticsSpecialtyReclassifications['2026-03-05_discharge_d-1'];
    expect(result).toEqual({ ok: true, active: false });
    expect(saved).toMatchObject({
      date: '2026-03-05',
      movementKind: 'discharge',
      movementId: 'd-1',
      originalSpecialty: 'Oftalmología',
      reportingSpecialty: null,
      active: false,
      clientIp: '198.51.100.11',
      userAgent: 'DeactivateAgent',
    });
    expect(Object.values(fake.state.auditLogs)[0]).toMatchObject({
      action: 'STATISTICAL_SPECIALTY_RECLASSIFIED',
      entityType: 'statistics',
      entityId: '2026-03-05_discharge_d-1',
      details: expect.objectContaining({
        reportingSpecialty: null,
        active: false,
        clientIp: '198.51.100.11',
      }),
    });
  });

  it('rejects non-admin attempts to persist statistical specialty reclassifications', async () => {
    const fake = createHospitalFirestore({
      dailyRecords: {
        '2026-03-05': {
          date: '2026-03-05',
          beds: {},
          discharges: [{ id: 'd-1', specialty: 'Oftalmología' }],
        },
      },
    });

    const functionsApi = createMinsalFunctions({
      admin: { firestore: () => fake.firestore },
      hospitalCapacity: 12,
      hasCallableClinicalAccess: vi.fn().mockResolvedValue(true),
      resolveRoleForEmail: vi.fn().mockResolvedValue('doctor_specialist'),
    });

    await expect(
      functionsApi.setMinsalSpecialtyReclassification.run(
        {
          hospitalId: 'hanga_roa',
          date: '2026-03-05',
          movementKind: 'discharge',
          movementId: 'd-1',
          reportingSpecialty: 'Cirugía',
        },
        { auth: { uid: 'doctor-uid', token: { email: 'doctor@example.com' } } }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('loads active reclassifications from Firestore for remote statistics instead of trusting client payload', async () => {
    const fake = createHospitalFirestore({
      dailyRecords: {
        '2026-03-05': {
          date: '2026-03-05',
          beds: {},
          discharges: [
            {
              id: 'd-1',
              patientName: 'Alta Reclasificada',
              rut: '11.111.111-1',
              diagnosis: 'Diagnóstico',
              status: 'Vivo',
              specialty: 'Oftalmología',
              time: '10:00',
            },
          ],
        },
      },
      reclassifications: {
        '2026-03-05_discharge_d-1': {
          date: '2026-03-05',
          movementKind: 'discharge',
          movementId: 'd-1',
          originalSpecialty: 'Oftalmología',
          reportingSpecialty: 'Cirugía',
          active: true,
        },
        '2026-03-05_discharge_inactive': {
          date: '2026-03-05',
          movementKind: 'discharge',
          movementId: 'inactive',
          originalSpecialty: 'Oftalmología',
          reportingSpecialty: 'Med Interna',
          active: false,
        },
      },
    });

    const functionsApi = createMinsalFunctions({
      admin: { firestore: () => fake.firestore },
      hospitalCapacity: 12,
      hasCallableClinicalAccess: vi.fn().mockResolvedValue(true),
    });

    const result = await functionsApi.calculateMinsalStats.run(
      {
        hospitalId: 'hanga_roa',
        startDate: '2026-03-05',
        endDate: '2026-03-05',
        options: {
          specialtyReclassifications: [
            {
              date: '2026-03-05',
              movementKind: 'discharge',
              movementId: 'd-1',
              specialty: 'Traumatología',
            },
          ],
        },
      },
      { auth: { token: { email: 'user@example.com' } } }
    );

    expect(
      result.porEspecialidad.find(
        (item: { specialty: string }) => item.specialty === 'Traumatología'
      )
    ).toBeUndefined();
    expect(
      result.porEspecialidad.find((item: { specialty: string }) => item.specialty === 'Cirugía')
        ?.egresos
    ).toBe(1);
  });
});
