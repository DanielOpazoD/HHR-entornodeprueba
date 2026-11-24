import { describe, expect, it } from 'vitest';
import { mapBradenRecordsToClinicalFormValues } from '@/features/clinical-library/domain/forms/clinicalFormBradenHistory';
import type { ChecklistRecord } from '@/services/clinical-checklists/checklistService';

const makeRecord = (overrides: Partial<ChecklistRecord> = {}): ChecklistRecord => ({
  code: 'PT-00000000-0000-4000-8000-000000000001',
  savedAt: '2026-11-24T15:30:00Z',
  authorName: 'EU Prueba',
  patient: { name: 'Paciente Sintético', document: '11.111.111-1', episode: '66001' },
  template: {
    id: 'hhr-lpp-braden-adulto',
    title: 'LPP · Braden adulto (≥15 años)',
    version: 2,
    scaleGroup: 'braden',
    fields: [],
  },
  rows: [
    {
      field: 'percepcion',
      shortCode: 'PS',
      label: 'PS · Percepción sensorial',
      value: '3 · Ligeramente limitada',
      points: 3,
    },
    { field: 'humedad', shortCode: 'H', label: 'H · Humedad', value: '2 · Muy húmeda', points: 2 },
    {
      field: 'actividad',
      shortCode: 'A',
      label: 'A · Actividad',
      value: '3 · Anda ocasionalmente',
      points: 3,
    },
    {
      field: 'movilidad',
      shortCode: 'M',
      label: 'M · Movilidad',
      value: '2 · Muy limitada',
      points: 2,
    },
    {
      field: 'nutricion',
      shortCode: 'N',
      label: 'N · Nutrición',
      value: '3 · Adecuada',
      points: 3,
    },
    {
      field: 'friccion',
      shortCode: 'F',
      label: 'F · Fricción y cizalla',
      value: '2 · Posibles problemas',
      points: 2,
    },
    { field: 'fecha', label: 'Fecha de valoración', value: '2026-11-24' },
    { field: 'hora', label: 'Hora de valoración (Rapa Nui)', value: '10:30' },
  ],
  score: {
    points: 15,
    maximum: 23,
    risk: 'moderado',
    reassess: 'Cada 72 h',
    subscores: { PS: 3, H: 2, A: 3, M: 2, N: 3, F: 2 },
  },
  evolution: 'Valoración de prueba',
  ...overrides,
});

describe('mapBradenRecordsToClinicalFormValues', () => {
  it('maps adult and pediatric Braden records into sequential PDF table rows', () => {
    const adult = makeRecord();
    const pediatric = makeRecord({
      code: 'PT-00000000-0000-4000-8000-000000000002',
      authorName: 'Dr. Pediatría',
      template: {
        id: 'hhr-lpp-braden-q',
        title: 'LPP · Braden Q pediátrico (30 días a <15 años)',
        version: 2,
        scaleGroup: 'braden',
        fields: [],
      },
      rows: [],
      score: {
        points: 14,
        maximum: 28,
        risk: 'alto',
        reassess: 'Cada 24 h',
        subscores: { PS: 2, H: 2, A: 2, M: 2, N: 2, F: 2, PO: 2 },
      },
    });

    const values = mapBradenRecordsToClinicalFormValues([adult, pediatric]);
    expect(values).toEqual({
      braden_reg_1_fecha: '2026-11-24',
      braden_reg_1_hora: '10:30',
      braden_reg_1_ps: '3',
      braden_reg_1_h: '2',
      braden_reg_1_a: '3',
      braden_reg_1_m: '2',
      braden_reg_1_n: '3',
      braden_reg_1_f: '2',
      braden_reg_1_total: '15',
      braden_reg_1_riesgo: 'M',
      braden_reg_1_evaluador: 'EU Prueba',
      // 2026-11-24T15:30:00Z in Pacific/Easter (UTC-5 DST in Nov) is 2026-11-24 10:30
      braden_reg_2_fecha: '2026-11-24',
      braden_reg_2_hora: '10:30',
      braden_reg_2_ps: '2',
      braden_reg_2_h: '2',
      braden_reg_2_a: '2',
      braden_reg_2_m: '2',
      braden_reg_2_n: '2',
      braden_reg_2_f: '2',
      braden_reg_2_po: '2',
      braden_reg_2_total: '14',
      braden_reg_2_riesgo: 'A',
      braden_reg_2_evaluador: 'Dr. Pediatría',
    });
  });

  it('keeps only the latest 14 records when more than 14 exist', () => {
    const many = Array.from({ length: 16 }, (_, index) =>
      makeRecord({
        code: `PT-00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        authorName: `Evaluador ${index + 1}`,
      })
    );
    const values = mapBradenRecordsToClinicalFormValues(many);
    expect(values.braden_reg_1_evaluador).toBe('Evaluador 3');
    expect(values.braden_reg_14_evaluador).toBe('Evaluador 16');
    expect(values.braden_reg_15_evaluador).toBeUndefined();
  });
});
