import { describe, expect, it, vi } from 'vitest';

import {
  buildTransferPatientSnapshot,
  resolveTransferCurrentDiagnosis,
  resolveTransferDestinationHospital,
  syncCensusTransferRequest,
} from '@/features/census/controllers/censusTransferSyncController';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  RECEIVING_CENTER_EXTRASYSTEM,
  RECEIVING_CENTER_OTHER,
} from '@/constants/clinicalMovementConstants';

describe('censusTransferSyncController', () => {
  it('resolves destination hospital using custom text for other/extrasystem centers', () => {
    expect(resolveTransferDestinationHospital('Hospital Base', '')).toBe('Hospital Base');
    expect(resolveTransferDestinationHospital(RECEIVING_CENTER_OTHER, 'Clinica X')).toBe(
      'Clinica X'
    );
    expect(resolveTransferDestinationHospital(RECEIVING_CENTER_EXTRASYSTEM, 'Centro Externo')).toBe(
      'Centro Externo'
    );
  });

  it('resolves diagnosis with the expected fallback order', () => {
    const patient = DataFactory.createMockPatient('R1', {
      pathology: '',
      cie10Description: '',
      cie10Code: 'A01',
      diagnosisComments: 'Comentario',
    });

    expect(resolveTransferCurrentDiagnosis(patient)).toBe('A01');
    expect(
      resolveTransferCurrentDiagnosis(
        DataFactory.createMockPatient('R1', {
          pathology: '',
          cie10Description: '',
          cie10Code: '',
          diagnosisComments: '',
        })
      )
    ).toBe('Sin diagnóstico');
  });

  it('builds transfer patient snapshot with fallback admission date', () => {
    const patient = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente A',
      rut: '11-1',
      age: '57',
      pathology: 'Dx',
      admissionDate: '',
    });

    expect(buildTransferPatientSnapshot(patient, '2026-03-11')).toMatchObject({
      name: 'Paciente A',
      rut: '11-1',
      age: 57,
      diagnosis: 'Dx',
      admissionDate: '2026-03-11',
    });
  });

  it('skips request creation when there is already an open linked transfer', async () => {
    const getLatest = vi.fn().mockResolvedValue({ id: 'TR-1' });
    const createFinalizedTransfer = vi.fn();
    const completeTransfer = vi.fn().mockResolvedValue({ status: 'success', data: null });

    await syncCensusTransferRequest({
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1'),
      recordDate: '2026-03-11',
      destinationHospital: 'Hospital Base',
      createdByEmail: 'test@example.com',
      getLatestOpenTransferRequestByBedId: getLatest,
      createFinalizedTransferRequestWithResult: createFinalizedTransfer,
      completeTransferWithResult: completeTransfer,
    });

    expect(createFinalizedTransfer).not.toHaveBeenCalled();
    expect(completeTransfer).toHaveBeenCalledWith('TR-1', 'test@example.com');
  });

  it('fails loudly when a linked transfer cannot be finalized', async () => {
    const getLatest = vi.fn().mockResolvedValue({ id: 'TR-1' });
    const createFinalizedTransfer = vi.fn();
    const completeTransfer = vi.fn().mockResolvedValue({
      status: 'permission_denied',
      data: null,
      userSafeMessage: 'No se pudo completar el traslado.',
      error: new Error('Missing or insufficient permissions.'),
    });

    await expect(
      syncCensusTransferRequest({
        bedId: 'R1',
        patient: DataFactory.createMockPatient('R1'),
        recordDate: '2026-03-11',
        destinationHospital: 'Hospital Base',
        createdByEmail: 'test@example.com',
        getLatestOpenTransferRequestByBedId: getLatest,
        createFinalizedTransferRequestWithResult: createFinalizedTransfer,
        completeTransferWithResult: completeTransfer,
      })
    ).rejects.toThrow('No se pudo completar el traslado.');

    expect(createFinalizedTransfer).not.toHaveBeenCalled();
  });

  it('creates a finalized transfer request when there is no linked open transfer', async () => {
    const getLatest = vi.fn().mockResolvedValue(null);
    const createFinalizedTransfer = vi.fn().mockResolvedValue({
      status: 'success',
      data: { id: 'TR-2', status: 'TRANSFERRED' },
    });
    const completeTransfer = vi.fn();

    await syncCensusTransferRequest({
      bedId: 'R1',
      patient: DataFactory.createMockPatient('R1', {
        patientName: 'Paciente A',
        rut: '11-1',
        pathology: 'Dx',
      }),
      recordDate: '2026-03-11',
      data: { movementDate: '2026-03-12' },
      destinationHospital: 'Hospital Base',
      createdByEmail: 'test@example.com',
      getLatestOpenTransferRequestByBedId: getLatest,
      createFinalizedTransferRequestWithResult: createFinalizedTransfer,
      completeTransferWithResult: completeTransfer,
    });

    expect(createFinalizedTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'R1',
        bedId: 'R1',
        destinationHospital: 'Hospital Base',
        requestDate: '2026-03-12',
        createdBy: 'test@example.com',
        status: 'TRANSFERRED',
      }),
      'test@example.com'
    );
    expect(completeTransfer).not.toHaveBeenCalled();
  });
});
