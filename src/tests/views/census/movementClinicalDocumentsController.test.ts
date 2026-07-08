import { describe, expect, it } from 'vitest';

import {
  buildCmaClinicalDocumentsPatientSnapshot,
  buildDischargeClinicalDocumentsPatientSnapshot,
} from '@/features/census/controllers/movementClinicalDocumentsController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('movementClinicalDocumentsController', () => {
  it('builds discharge document context from the historical movement snapshot', () => {
    const snapshot = buildDischargeClinicalDocumentsPatientSnapshot(
      DataFactory.createMockDischarge({
        id: 'd-docs',
        bedId: 'R2',
        patientName: 'Current row label',
        rut: '22.222.222-2',
        clinicalEpisodeId: 'ep_discharge_case',
        originalData: DataFactory.createMockPatient('R2', {
          patientName: 'Historical Discharge Patient',
          rut: '22.222.222-2',
          clinicalEpisodeId: 'ep_stale_original',
          admissionDate: '2026-02-12',
          admissionTime: '08:15',
        }),
      }),
      '2026-02-14'
    );

    expect(snapshot.patientName).toBe('Historical Discharge Patient');
    expect(snapshot.rut).toBe('22.222.222-2');
    expect(snapshot.bedId).toBe('R2');
    expect(snapshot.admissionDate).toBe('2026-02-12');
    expect(snapshot.admissionTime).toBe('08:15');
    expect(snapshot.clinicalEpisodeId).toBe('ep_discharge_case');
  });

  it('builds CMA document context from the historical movement snapshot after bed reuse', () => {
    const snapshot = buildCmaClinicalDocumentsPatientSnapshot(
      DataFactory.createMockCMA({
        id: 'cma-docs',
        originalBedId: 'R3',
        patientName: 'Current CMA row label',
        rut: '33.333.333-3',
        clinicalEpisodeId: 'ep_cma_case',
        originalData: DataFactory.createMockPatient('R3', {
          patientName: 'Historical CMA Patient',
          rut: '33.333.333-3',
          clinicalEpisodeId: 'ep_old_original',
          admissionDate: '2026-04-28',
          admissionTime: '10:30',
        }),
      }),
      '2026-04-30'
    );

    expect(snapshot.patientName).toBe('Historical CMA Patient');
    expect(snapshot.rut).toBe('33.333.333-3');
    expect(snapshot.bedId).toBe('R3');
    expect(snapshot.admissionDate).toBe('2026-04-28');
    expect(snapshot.admissionTime).toBe('10:30');
    expect(snapshot.clinicalEpisodeId).toBe('ep_cma_case');
  });

  it('falls back to explicit movement fields for legacy records without originalData', () => {
    const snapshot = buildDischargeClinicalDocumentsPatientSnapshot(
      DataFactory.createMockDischarge({
        id: 'd-legacy',
        bedId: 'R4',
        bedName: 'Cama R4',
        patientName: 'Legacy Discharge',
        rut: '44.444.444-4',
        diagnosis: 'Diagnostico legacy',
        specialty: 'Cirugia',
        clinicalEpisodeId: 'ep_legacy_discharge',
        admissionDate: '2026-05-01',
        originalData: undefined,
      }),
      '2026-05-03'
    );

    expect(snapshot.patientName).toBe('Legacy Discharge');
    expect(snapshot.rut).toBe('44.444.444-4');
    expect(snapshot.bedId).toBe('R4');
    expect(snapshot.bedName).toBe('Cama R4');
    expect(snapshot.pathology).toBe('Diagnostico legacy');
    expect(snapshot.specialty).toBe('Cirugia');
    expect(snapshot.admissionDate).toBe('2026-05-01');
    expect(snapshot.clinicalEpisodeId).toBe('ep_legacy_discharge');
  });
});
