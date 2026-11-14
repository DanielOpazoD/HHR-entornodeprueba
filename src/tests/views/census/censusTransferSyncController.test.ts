// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('uses the hospital day for a transfer without an explicit date at 23:30', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T04:30:00.000Z'));
    const getLatest = vi.fn().mockResolvedValue({ id: 'fake-transfer' });
    try {
      await syncCensusTransferRequest({
        bedId: 'R1',
        patient: DataFactory.createMockPatient('R1'),
        destinationHospital: 'Hospital Sintético',
        createdByEmail: 'fake@example.com',
        getLatestOpenTransferRequestByBedId: getLatest,
        createFinalizedTransferRequestWithResult: vi.fn(),
        completeTransferWithResult: vi.fn().mockResolvedValue({ status: 'success', data: null }),
      });
      expect(getLatest).toHaveBeenCalledWith('R1', { referenceDate: '2026-10-24' });
    } finally {
      vi.useRealTimers();
    }
  });

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

  describe('patient age sent with an autocreated transfer', () => {
    const sentAge = async (overrides: Parameters<typeof DataFactory.createMockPatient>[1]) => {
      const createFinalizedTransfer = vi.fn().mockResolvedValue({
        status: 'success',
        data: { id: 'TR-AGE', status: 'TRANSFERRED' },
      });
      await syncCensusTransferRequest({
        bedId: 'R1',
        patient: DataFactory.createMockPatient('R1', overrides),
        recordDate: '2026-11-14',
        destinationHospital: 'Hospital Sintético',
        createdByEmail: 'fake@example.com',
        getLatestOpenTransferRequestByBedId: vi.fn().mockResolvedValue(null),
        createFinalizedTransferRequestWithResult: createFinalizedTransfer,
        completeTransferWithResult: vi.fn(),
      });
      return createFinalizedTransfer.mock.calls[0][0].patientSnapshot.age;
    };

    it.each([
      ['29d', 0],
      ['11m', 0],
      ['3m 8d', 0],
      ['20m', 1],
      ['2a 4m', 2],
      ['45a', 45],
      ['45', 45],
      ['', 0],
    ])('sends completed years for the stored age text %j', async (age, years) => {
      expect(await sentAge({ age, birthDate: '' })).toBe(years);
    });

    it('counts completed years from a valid birth date on the census day', async () => {
      expect(await sentAge({ age: '29d', birthDate: '2026-10-16' })).toBe(0);
      expect(await sentAge({ age: '45', birthDate: '1980-11-15' })).toBe(45);
      // The birth date wins over a stale stored text.
      expect(await sentAge({ age: '99', birthDate: '1980-11-14' })).toBe(46);
    });

    it.each(['45 a.', '45a.', '45 años.'])(
      'keeps the years of the restored abbreviation %j',
      async age => {
        expect(await sentAge({ age, birthDate: '' })).toBe(45);
      }
    );

    it('falls back to the stored text when the birth date names a day that does not exist', async () => {
      expect(await sentAge({ age: '45', birthDate: '1980-02-30' })).toBe(45);
    });

    describe('a birth instant restored with its zone', () => {
      const deviceZone = process.env.TZ;
      afterEach(() => {
        if (deviceZone === undefined) delete process.env.TZ;
        else process.env.TZ = deviceZone;
      });

      it.each([
        'UTC',
        'America/Santiago',
        'Pacific/Easter',
        'Pacific/Auckland',
        'Pacific/Pago_Pago',
      ])('counts from its Rapa Nui day on a %s computer', async zone => {
        process.env.TZ = zone;
        // 01:00 UTC on 15 November is still 14 November in Rapa Nui: the birthday is today.
        expect(await sentAge({ age: '45a', birthDate: '1980-11-15T01:00:00Z' })).toBe(46);
      });
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
        customFields: {
          source: 'census_transfer_autocreate',
          executedDate: '2026-03-12',
        },
      }),
      'test@example.com'
    );
    expect(completeTransfer).not.toHaveBeenCalled();
  });
});
