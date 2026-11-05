import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BEDS } from '@/constants/beds';
import { buildCensusMasterBinary } from '@/services/exporters/censusMasterWorkbook';
import {
  reserveCensusEmailDiagnoses,
  RESERVED_DIAGNOSIS,
} from '@/services/exporters/censusEmailDiagnosisPrivacy';
import PizZip from 'pizzip';

const syntheticRecord = () => {
  const psychiatric = DataFactory.createMockPatient(BEDS[0].id, {
    patientName: 'Paciente Sintético',
    specialty: 'Psiquiatría adulto',
    pathology: 'RESERVADO_SINTETICO',
    cie10Code: 'F99',
    cie10Description: 'RESERVADO_SINTETICO',
    isUPC: true,
    clinicalCrib: DataFactory.createMockPatient('crib', {
      specialty: 'Pediatría',
      pathology: 'VISIBLE_PEDIATRIA',
    }),
  });
  return DataFactory.createMockDailyRecord('2026-04-03', {
    beds: {
      [BEDS[0].id]: psychiatric,
      [BEDS[1].id]: DataFactory.createMockPatient(BEDS[1].id, {
        specialty: 'Medicina',
        secondarySpecialty: 'PSIQUIATRIA',
        pathology: 'RESERVADO_SECUNDARIO',
      }),
    },
    discharges: [
      DataFactory.createMockDischarge({ diagnosis: 'RESERVADO_ALTA', specialty: 'Psiquiatría' }),
    ],
    transfers: [
      DataFactory.createMockTransfer({
        diagnosis: 'RESERVADO_TRASLADO',
        originalData: psychiatric,
      }),
    ],
    cma: [
      {
        id: 'cma',
        bedName: 'R1',
        patientName: 'Paciente CMA',
        rut: '',
        age: '30',
        diagnosis: 'RESERVADO_CMA',
        specialty: 'Psiquiatría',
        interventionType: 'Procedimiento Médico Ambulatorio',
      },
    ],
  });
};

describe('diagnoses in the emailed census', () => {
  it('redacts psychiatry across all sections without changing the clinical record or the crib', () => {
    const source = syntheticRecord();
    const before = structuredClone(source);
    const result = reserveCensusEmailDiagnoses(source);
    expect(result.beds[BEDS[0].id].pathology).toBe(RESERVED_DIAGNOSIS);
    expect(result.beds[BEDS[1].id].pathology).toBe(RESERVED_DIAGNOSIS);
    expect(result.beds[BEDS[0].id].clinicalCrib?.pathology).toBe('VISIBLE_PEDIATRIA');
    expect(result.discharges[0].diagnosis).toBe(RESERVED_DIAGNOSIS);
    expect(result.transfers[0].diagnosis).toBe(RESERVED_DIAGNOSIS);
    expect(result.cma[0].diagnosis).toBe(RESERVED_DIAGNOSIS);
    expect(source).toEqual(before);
  });

  it('does not leak the diagnoses in any XML part, including hidden sheets', async () => {
    const binary = await buildCensusMasterBinary([reserveCensusEmailDiagnoses(syntheticRecord())]);
    const zip = new PizZip(binary);
    const xml = zip
      .file(/\.xml$/)
      .map(file => file.asText())
      .join('\n');
    for (const secret of [
      'RESERVADO_SINTETICO',
      'RESERVADO_SECUNDARIO',
      'RESERVADO_ALTA',
      'RESERVADO_TRASLADO',
      'RESERVADO_CMA',
    ]) {
      expect(xml).not.toContain(secret);
    }
    expect(xml).toContain(RESERVED_DIAGNOSIS);
    expect(xml).toContain('VISIBLE_PEDIATRIA');
  });
});
