import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BedType, type BedDefinition } from '@/features/census/contracts/censusBedContracts';
import { listCensusExamRequestCandidates } from '@/features/census/controllers/censusExamRequestController';

const bed = (id: string): BedDefinition => ({ id, name: id, type: BedType.UTI, isCuna: false });

describe('listCensusExamRequestCandidates', () => {
  it('lists the census patients once each, newborns apart from their mother', () => {
    const mother = DataFactory.createMockPatient('R1', {
      patientName: 'MADRE SINTETICA',
      rut: '11.111.111-1',
      clinicalEpisodeId: 'ep-madre',
    });
    const candidates = listCensusExamRequestCandidates({
      visibleBeds: [bed('R1'), bed('R2'), bed('R3')],
      beds: {
        R1: {
          ...mother,
          clinicalCrib: DataFactory.createMockPatient('R1', {
            patientName: 'RN SINTETICO',
            rut: '33.333.333-3',
            clinicalEpisodeId: 'ep-rn',
            bedMode: 'Cuna',
          }),
        },
        // The same patient and episode in a second bed is still one person.
        R2: { ...mother, bedId: 'R2' },
        R3: DataFactory.createMockPatient('R3', { patientName: '', rut: '' }),
      },
    });

    expect(candidates.map(({ key, label }) => [key, label])).toEqual([
      ['episode:ep-madre', 'R1'],
      ['episode:ep-rn', 'R1 RN'],
    ]);
  });

  it('never reads a passport as a RUT', () => {
    const candidates = listCensusExamRequestCandidates({
      visibleBeds: [bed('R1'), bed('R2')],
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          patientName: 'CON RUT',
          rut: '11.111.111-1',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-11-08',
          admissionTime: '08:15',
        }),
        R2: DataFactory.createMockPatient('R2', {
          patientName: 'CON PASAPORTE',
          rut: '11111111-1',
          documentType: 'Pasaporte',
          clinicalEpisodeId: undefined,
          admissionDate: '2026-11-08',
          admissionTime: '08:15',
        }),
      },
    });

    expect(candidates.map(candidate => candidate.patient.patientName)).toEqual([
      'CON RUT',
      'CON PASAPORTE',
    ]);
  });

  it('leaves out patients only a name tells apart, such as two same-named newborns', () => {
    const twin = (bedId: string) =>
      DataFactory.createMockPatient(bedId, {
        patientName: 'RN DE SINTETICA',
        rut: '',
        clinicalEpisodeId: undefined,
        admissionDate: '2026-11-08',
      });
    const candidates = listCensusExamRequestCandidates({
      visibleBeds: [bed('NEO1'), bed('NEO2')],
      beds: { NEO1: twin('NEO1'), NEO2: twin('NEO2') },
    });

    expect(candidates).toEqual([]);
  });

  it('tells apart two stays of one person on the same day, and leaves out an unproven stay', () => {
    const stay = (bedId: string, admissionTime?: string) =>
      DataFactory.createMockPatient(bedId, {
        patientName: 'MISMA PERSONA',
        rut: '11.111.111-1',
        clinicalEpisodeId: undefined,
        admissionDate: '2026-11-08',
        admissionTime,
      });
    const candidates = listCensusExamRequestCandidates({
      visibleBeds: [bed('R1'), bed('R2'), bed('R3')],
      beds: { R1: stay('R1', '07:00'), R2: stay('R2', '19:40'), R3: stay('R3') },
    });

    expect(candidates.map(candidate => candidate.label)).toEqual(['R1', 'R2']);
    expect(new Set(candidates.map(candidate => candidate.key)).size).toBe(2);
  });
});
