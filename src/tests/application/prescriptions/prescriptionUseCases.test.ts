import { describe, expect, it, vi } from 'vitest';

import type { PrescriptionPort } from '@/application/ports/prescriptionPort';
import { executeListPrescriptions } from '@/application/prescriptions/listPrescriptionsUseCase';
import { executeReassignPrescriptionPatient } from '@/application/prescriptions/reassignPrescriptionPatientUseCase';
import { executeDeletePrescription } from '@/application/prescriptions/deletePrescriptionUseCase';
import { executeUpdatePrescriptionType } from '@/application/prescriptions/updatePrescriptionTypeUseCase';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';

const buildPort = (overrides: Partial<PrescriptionPort> = {}): PrescriptionPort => ({
  list: vi.fn(async () => []),
  listByDateRange: vi.fn(async () => []),
  get: vi.fn(async () => null),
  reassignPatient: vi.fn(async () => ({}) as PrescriptionRecord),
  updateType: vi.fn(async () => ({}) as PrescriptionRecord),
  delete: vi.fn(async () => undefined),
  subscribeToList: vi.fn(() => () => undefined),
  ...overrides,
});

describe('executeListPrescriptions', () => {
  it('falls back to list() when no date range is provided', async () => {
    const port = buildPort({
      list: vi.fn(async () => [{ id: 'rx-1' } as PrescriptionRecord]),
    });

    const result = await executeListPrescriptions(
      { hospitalId: 'hhr' },
      { prescriptionPort: port }
    );

    expect(result).toHaveLength(1);
    expect(port.list).toHaveBeenCalledWith('hhr');
    expect(port.listByDateRange).not.toHaveBeenCalled();
  });

  it('calls listByDateRange when both from and to are provided', async () => {
    const port = buildPort({
      listByDateRange: vi.fn(async () => [{ id: 'rx-2' } as PrescriptionRecord]),
    });

    const result = await executeListPrescriptions(
      { hospitalId: 'hhr', from: '2026-05-04T00:00:00Z', to: '2026-05-04T23:59:59Z' },
      { prescriptionPort: port }
    );

    expect(result).toHaveLength(1);
    expect(port.listByDateRange).toHaveBeenCalledWith(
      '2026-05-04T00:00:00Z',
      '2026-05-04T23:59:59Z',
      'hhr'
    );
    expect(port.list).not.toHaveBeenCalled();
  });
});

describe('executeReassignPrescriptionPatient', () => {
  it('forwards the patch verbatim and stamps reassignedAt with provided value', async () => {
    const port = buildPort({
      reassignPatient: vi.fn(async () => ({ id: 'rx-1' }) as PrescriptionRecord),
    });

    await executeReassignPrescriptionPatient(
      {
        prescriptionId: 'rx-1',
        bedId: 'H5C1',
        patientName: 'Paciente',
        patientRut: '11.111.111-1',
        reassignedBy: 'admin@h.cl',
        reassignedAt: '2026-05-05T08:00:00.000Z',
      },
      { prescriptionPort: port }
    );

    expect(port.reassignPatient).toHaveBeenCalledWith(
      'rx-1',
      expect.objectContaining({
        bedId: 'H5C1',
        patientName: 'Paciente',
        patientRut: '11.111.111-1',
        reassignedBy: 'admin@h.cl',
        reassignedAt: '2026-05-05T08:00:00.000Z',
      }),
      undefined
    );
  });

  it('forwards an explicit hospitalized stock assignment scope', async () => {
    const port = buildPort({
      reassignPatient: vi.fn(async () => ({ id: 'rx-1' }) as PrescriptionRecord),
    });

    await executeReassignPrescriptionPatient(
      {
        prescriptionId: 'rx-1',
        assignmentScope: 'hospitalized_stock',
        reassignedBy: 'admin@h.cl',
        reassignedAt: '2026-05-05T08:00:00.000Z',
      },
      { prescriptionPort: port }
    );

    expect(port.reassignPatient).toHaveBeenCalledWith(
      'rx-1',
      expect.objectContaining({
        assignmentScope: 'hospitalized_stock',
        bedId: undefined,
        patientName: undefined,
        patientRut: undefined,
      }),
      undefined
    );
  });

  it('defaults reassignedAt to now when omitted', async () => {
    const port = buildPort({
      reassignPatient: vi.fn(async () => ({ id: 'rx-1' }) as PrescriptionRecord),
    });

    await executeReassignPrescriptionPatient(
      { prescriptionId: 'rx-1', reassignedBy: 'admin@h.cl' },
      { prescriptionPort: port }
    );

    const stamped = vi.mocked(port.reassignPatient).mock.calls[0][1].reassignedAt;
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('executeUpdatePrescriptionType', () => {
  it('forwards the new type and stamps updatedAt with provided value', async () => {
    const port = buildPort({
      updateType: vi.fn(async () => ({ id: 'rx-1' }) as PrescriptionRecord),
    });

    await executeUpdatePrescriptionType(
      {
        prescriptionId: 'rx-1',
        prescriptionType: 'psicotropicos',
        updatedBy: 'admin@h.cl',
        updatedAt: '2026-05-05T08:00:00.000Z',
      },
      { prescriptionPort: port }
    );

    expect(port.updateType).toHaveBeenCalledWith(
      'rx-1',
      {
        prescriptionType: 'psicotropicos',
        updatedBy: 'admin@h.cl',
        updatedAt: '2026-05-05T08:00:00.000Z',
      },
      undefined
    );
  });

  it('defaults updatedAt to now when omitted', async () => {
    const port = buildPort({
      updateType: vi.fn(async () => ({ id: 'rx-1' }) as PrescriptionRecord),
    });

    await executeUpdatePrescriptionType(
      { prescriptionId: 'rx-1', prescriptionType: 'comun', updatedBy: 'admin@h.cl' },
      { prescriptionPort: port }
    );

    const stamped = vi.mocked(port.updateType).mock.calls[0][1].updatedAt;
    expect(stamped).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('executeDeletePrescription', () => {
  it('delegates straight through to the port', async () => {
    const port = buildPort();
    await executeDeletePrescription(
      { prescriptionId: 'rx-1', hospitalId: 'hhr', deletedBy: 'admin@h.cl' },
      {
        prescriptionPort: port,
        writeAuditEvent: vi.fn(async () => ({
          status: 'success' as const,
          data: null,
          issues: [],
        })),
      }
    );
    expect(port.delete).toHaveBeenCalledWith('rx-1', 'hhr');
  });

  it('fails closed: a failed audit was attempted and aborts before deleting', async () => {
    const port = buildPort();
    const writeAuditEvent = vi.fn(async () => ({
      status: 'failed' as const,
      data: null,
      issues: [],
    }));
    await expect(
      executeDeletePrescription(
        { prescriptionId: 'rx-1', hospitalId: 'hhr', deletedBy: 'admin@h.cl' },
        { prescriptionPort: port, writeAuditEvent }
      )
    ).rejects.toThrow();
    expect(writeAuditEvent).toHaveBeenCalledTimes(1); // the audit WAS attempted (first)
    expect(port.delete).not.toHaveBeenCalled();
  });

  it('writes an attributable audit event before manual deletion', async () => {
    const port = buildPort({
      get: vi.fn(
        async () =>
          ({
            id: 'rx-1',
            hospitalId: 'hhr',
            prescriptionType: 'psicotropicos',
            bedId: 'H5C1',
            patientName: 'Paciente',
            patientRut: '11.111.111-1',
            image: {
              storagePath: 'prescriptions/hhr/rx-1/full.jpg',
              thumbnailStoragePath: 'prescriptions/hhr/rx-1/thumb.jpg',
              byteSize: 200_000,
              width: 1200,
              height: 900,
              contentType: 'image/jpeg',
            },
            uploader: { source: 'qr_pin' },
            createdAt: '2026-05-05T10:00:00.000Z',
            expiresAt: '2026-06-04T10:00:00.000Z',
          }) as PrescriptionRecord
      ),
    });
    const writeAuditEvent = vi.fn(async () => ({
      status: 'success' as const,
      data: null,
      issues: [],
    }));

    await executeDeletePrescription(
      {
        prescriptionId: 'rx-1',
        hospitalId: 'hhr',
        deletedBy: 'admin@h.cl',
        deletedAt: '2026-05-05T12:00:00.000Z',
      },
      { prescriptionPort: port, writeAuditEvent }
    );

    expect(writeAuditEvent).toHaveBeenCalledWith({
      userId: 'admin@h.cl',
      action: 'PRESCRIPTION_MANUAL_DELETED',
      entityType: 'prescription',
      entityId: 'rx-1',
      patientRut: '11.111.111-1',
      recordDate: '2026-05-05',
      details: expect.objectContaining({
        prescriptionId: 'rx-1',
        prescriptionType: 'psicotropicos',
        bedId: 'H5C1',
        patientName: 'Paciente',
        patientRut: '11.111.111-1',
        createdAt: '2026-05-05T10:00:00.000Z',
        expiresAt: '2026-06-04T10:00:00.000Z',
        deletedAt: '2026-05-05T12:00:00.000Z',
        deletionMode: 'manual',
        deletedBy: 'admin@h.cl',
      }),
    });
    expect(port.delete).toHaveBeenCalledWith('rx-1', 'hhr');
    expect(writeAuditEvent.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(port.delete).mock.invocationCallOrder[0]
    );
  });

  it('does not delete when the manual delete audit cannot be persisted', async () => {
    const port = buildPort();
    const writeAuditEvent = vi.fn(async () => ({
      status: 'failed' as const,
      data: null,
      issues: [{ kind: 'permission' as const, message: 'actor missing' }],
    }));

    await expect(
      executeDeletePrescription(
        { prescriptionId: 'rx-1', deletedBy: 'anon' },
        { prescriptionPort: port, writeAuditEvent }
      )
    ).rejects.toThrow(/auditoría/i);

    expect(port.delete).not.toHaveBeenCalled();
  });
});
