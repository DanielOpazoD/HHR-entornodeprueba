// @vitest-environment node
import { buildTestCensusRows } from '../censusBedRows.testSupport';
import { describe, expect, it } from 'vitest';
import {
  canExploreClinicalPatient,
  clinicalExplorerPatientIdentity,
  filterClinicalExplorerPatients,
  listClinicalExplorerExamCandidates,
  listClinicalExplorerPatients,
  resolveClinicalExplorerNeighbour,
} from '@/features/census/controllers/clinicalExplorerController';
import { DataFactory } from '@/tests/factories/DataFactory';

const patient = (bedId: string, overrides = {}) =>
  DataFactory.createMockPatient(bedId, {
    patientName: `Paciente ${bedId}`,
    rut: '12.345.678-5',
    clinicalEpisodeId: `ep-${bedId}`,
    ...overrides,
  });

describe('clinicalExplorerController', () => {
  it('lists the census patients in bed order and leaves out those without RUT or episode', () => {
    const beds = {
      H1C1: patient('H1C1'),
      R1: patient('R1'),
      R2: patient('R2', { documentType: 'Pasaporte' }),
      R3: patient('R3', { clinicalEpisodeId: '' }),
      R4: patient('R4', { rut: '12.345.678-9' }),
      H2C1: patient('H2C1', {
        clinicalCrib: patient('H2C1', { patientName: 'RN sintético', clinicalEpisodeId: 'ep-rn' }),
      }),
    };
    const listed = listClinicalExplorerPatients(buildTestCensusRows(beds));
    expect(listed.map(entry => entry.bedId)).toEqual(['R1', 'H1C1', 'H2C1']);
    expect(listed[0].episodeId).toBe('ep-R1');
  });

  it('names request candidates by patient and episode, once each, in census order', () => {
    const listed = listClinicalExplorerPatients(
      buildTestCensusRows({
        R1: patient('R1', { clinicalEpisodeId: 'ep-same', patientName: 'Primera fila' }),
        R2: patient('R2', { clinicalEpisodeId: 'ep-same', patientName: 'Fila repetida' }),
        R3: patient('R3', { rut: '1.000.105-6' }),
      })
    );
    expect(clinicalExplorerPatientIdentity(listed[0])).toBe('123456785:ep-same');
    // The same patient and episode in two beds is one person: the first bed stands for it.
    expect(
      listClinicalExplorerExamCandidates(listed).map(candidate => [
        candidate.key,
        candidate.label,
        candidate.data.patientName,
      ])
    ).toEqual([
      ['123456785:ep-same', 'R1', 'Primera fila'],
      ['10001056:ep-R3', 'R3', 'Paciente R3'],
    ]);
  });

  it('treats a blocked bed and a passport holder as not explorable', () => {
    expect(canExploreClinicalPatient(patient('R1', { documentType: 'Pasaporte' }))).toBe(false);
    expect(canExploreClinicalPatient(patient('R1', { rut: '-' }))).toBe(false);
    expect(canExploreClinicalPatient(patient('R1'))).toBe(true);
  });

  it('filters by name without accents, by RUT and by bed', () => {
    const patients = listClinicalExplorerPatients(
      buildTestCensusRows({
        R1: patient('R1', { patientName: 'MOPÉF SINTÉTICA' }),
        H1C1: patient('H1C1', { patientName: 'PEDRO SINTÉTICO', rut: '1.000.105-6' }),
      })
    );
    expect(filterClinicalExplorerPatients(patients, 'mopef').map(p => p.bedId)).toEqual(['R1']);
    expect(filterClinicalExplorerPatients(patients, '1.000').map(p => p.bedId)).toEqual(['H1C1']);
    expect(filterClinicalExplorerPatients(patients, 'h1c1').map(p => p.bedId)).toEqual(['H1C1']);
    expect(filterClinicalExplorerPatients(patients, '  ')).toHaveLength(2);
  });

  it('moves to the neighbouring bed and stops at both ends', () => {
    const patients = listClinicalExplorerPatients(
      buildTestCensusRows({ R1: patient('R1'), R2: patient('R2'), H1C1: patient('H1C1') })
    );
    expect(resolveClinicalExplorerNeighbour(patients, 'R2', -1)).toBe('R1');
    expect(resolveClinicalExplorerNeighbour(patients, 'R2', 1)).toBe('H1C1');
    expect(resolveClinicalExplorerNeighbour(patients, 'R1', -1)).toBeNull();
    expect(resolveClinicalExplorerNeighbour(patients, 'H1C1', 1)).toBeNull();
    expect(resolveClinicalExplorerNeighbour(patients, 'NEO 1', 1)).toBeNull();
  });
});
