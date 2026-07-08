import { describe, expect, it } from 'vitest';

import { BEDS } from '@/constants/beds';
import { calculateMinsalStats } from '@/services/calculations/minsalStatsCalculator';
import { Specialty } from '@/types/domain/patientClassification';

import { createMockRecord } from './minsalStatsCalculatorTestSupport';

describe('minsalStatsCalculator CMA and specialty reporting', () => {
  it('keeps CMA outside hospital bed-day and discharge indicators while exposing a separate CMA summary', () => {
    const record = createMockRecord('2026-01-01', 4);
    record.cma = [
      {
        id: 'cma-1',
        bedName: 'CMA 1',
        patientName: 'Paciente CMA',
        rut: '33.333.333-3',
        age: '45',
        diagnosis: 'Colelitiasis',
        specialty: Specialty.CIRUGIA,
        interventionType: 'Cirugía Mayor Ambulatoria',
        dischargeTime: '14:30',
        originalData: {
          admissionDate: '2025-12-20',
        } as never,
      },
    ];

    const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01');

    expect(stats.diasCamaOcupados).toBe(4);
    expect(stats.egresosTotal).toBe(0);
    expect(stats.promedioDiasEstada).toBe(0);
    expect(stats.indiceRotacion).toBe(0);
    expect(stats.cma?.total).toBe(1);
    expect(stats.cma?.cirugiaMayorAmbulatoria).toBe(1);
    expect(stats.cma?.procedimientoMedicoAmbulatorio).toBe(0);
    expect(stats.cma?.porEspecialidad).toEqual([
      expect.objectContaining({
        specialty: Specialty.CIRUGIA,
        total: 1,
        cirugiaMayorAmbulatoria: 1,
        procedimientoMedicoAmbulatorio: 0,
      }),
    ]);
  });

  it('groups free-text specialties under Otro without losing original specialty traceability', () => {
    const record = createMockRecord('2026-01-01', 1);
    const bedId = BEDS[0].id;
    record.beds[bedId].specialty = 'Cardiología';
    record.discharges = [
      {
        id: 'd-1',
        patientName: 'Alta Especialidad Libre',
        status: 'Vivo',
        bedName: 'Cama 1',
        bedId: 'bed-1',
        bedType: 'Cama',
        rut: '11.111.111-1',
        diagnosis: 'Diagnóstico alta',
        specialty: 'Oftalmología',
        time: '10:00',
      },
    ];
    record.transfers = [
      {
        id: 't-1',
        patientName: 'Traslado Especialidad Libre',
        receivingCenter: 'Hospital X',
        bedName: 'Cama 2',
        bedId: 'bed-2',
        bedType: 'Cama',
        rut: '22.222.222-2',
        diagnosis: 'Diagnóstico traslado',
        specialty: 'Broncopulmonar',
        time: '11:00',
        evacuationMethod: '',
      },
    ];
    record.cma = [
      {
        id: 'cma-1',
        bedName: 'CMA 1',
        patientName: 'CMA Especialidad Libre',
        rut: '33.333.333-3',
        age: '50',
        diagnosis: 'Diagnóstico CMA',
        specialty: 'Dermatología',
        interventionType: 'Procedimiento Médico Ambulatorio',
      },
    ];

    const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01', {
      specialtyGroupingMode: 'group-other',
    });

    expect(stats.porEspecialidad.find(item => item.specialty === 'Cardiología')).toBeUndefined();
    expect(stats.porEspecialidad.find(item => item.specialty === 'Oftalmología')).toBeUndefined();
    expect(stats.porEspecialidad.find(item => item.specialty === 'Broncopulmonar')).toBeUndefined();

    const otro = stats.porEspecialidad.find(item => item.specialty === Specialty.OTRO);
    expect(otro).toEqual(
      expect.objectContaining({
        diasOcupados: 1,
        egresos: 1,
        traslados: 1,
      })
    );
    expect(otro?.diasOcupadosList?.[0]).toEqual(
      expect.objectContaining({
        originalSpecialty: 'Cardiología',
        reportingSpecialty: Specialty.OTRO,
        reportingSpecialtySource: 'grouped',
      })
    );

    const cmaOtro = stats.cma?.porEspecialidad.find(item => item.specialty === Specialty.OTRO);
    expect(cmaOtro).toEqual(
      expect.objectContaining({
        total: 1,
        procedimientoMedicoAmbulatorio: 1,
      })
    );
    expect(cmaOtro?.pacientesList?.[0]).toEqual(
      expect.objectContaining({
        originalSpecialty: 'Dermatología',
        reportingSpecialty: Specialty.OTRO,
        reportingSpecialtySource: 'grouped',
      })
    );
  });

  it('applies statistical specialty reclassifications to discharges, transfers and CMA without mutating the clinical original', () => {
    const record = createMockRecord('2026-01-01', 0);
    record.discharges = [
      {
        id: 'd-1',
        patientName: 'Alta Reclasificada',
        status: 'Vivo',
        bedName: 'Cama 1',
        bedId: 'bed-1',
        bedType: 'Cama',
        rut: '11.111.111-1',
        diagnosis: 'Diagnóstico alta',
        specialty: 'Oftalmología',
        time: '10:00',
      },
    ];
    record.transfers = [
      {
        id: 't-1',
        patientName: 'Traslado Reclasificado',
        receivingCenter: 'Hospital X',
        bedName: 'Cama 2',
        bedId: 'bed-2',
        bedType: 'Cama',
        rut: '22.222.222-2',
        diagnosis: 'Diagnóstico traslado',
        specialty: 'Broncopulmonar',
        time: '11:00',
        evacuationMethod: '',
      },
    ];
    record.cma = [
      {
        id: 'cma-1',
        bedName: 'CMA 1',
        patientName: 'CMA Reclasificada',
        rut: '33.333.333-3',
        age: '50',
        diagnosis: 'Diagnóstico CMA',
        specialty: 'Dermatología',
        interventionType: 'Cirugía Mayor Ambulatoria',
      },
    ];

    const stats = calculateMinsalStats([record], '2026-01-01', '2026-01-01', {
      specialtyReclassifications: [
        {
          date: '2026-01-01',
          movementKind: 'discharge',
          movementId: 'd-1',
          specialty: Specialty.CIRUGIA,
        },
        {
          date: '2026-01-01',
          movementKind: 'transfer',
          movementId: 't-1',
          specialty: Specialty.MEDICINA,
        },
        {
          date: '2026-01-01',
          movementKind: 'cma',
          movementId: 'cma-1',
          specialty: Specialty.TRAUMATOLOGIA,
        },
      ],
    });

    const cirugia = stats.porEspecialidad.find(item => item.specialty === Specialty.CIRUGIA);
    const medicina = stats.porEspecialidad.find(item => item.specialty === Specialty.MEDICINA);
    const cmaTraumatologia = stats.cma?.porEspecialidad.find(
      item => item.specialty === Specialty.TRAUMATOLOGIA
    );

    expect(cirugia?.egresos).toBe(1);
    expect(cirugia?.egresosList?.[0]).toEqual(
      expect.objectContaining({
        originalSpecialty: 'Oftalmología',
        reportingSpecialty: Specialty.CIRUGIA,
        reportingSpecialtySource: 'manual',
      })
    );
    expect(medicina?.traslados).toBe(1);
    expect(medicina?.trasladosList?.[0]).toEqual(
      expect.objectContaining({
        originalSpecialty: 'Broncopulmonar',
        reportingSpecialty: Specialty.MEDICINA,
        reportingSpecialtySource: 'manual',
      })
    );
    expect(cmaTraumatologia?.total).toBe(1);
    expect(cmaTraumatologia?.pacientesList?.[0]).toEqual(
      expect.objectContaining({
        originalSpecialty: 'Dermatología',
        reportingSpecialty: Specialty.TRAUMATOLOGIA,
        reportingSpecialtySource: 'manual',
      })
    );
    expect(record.discharges[0]?.specialty).toBe('Oftalmología');
    expect(record.transfers[0]?.specialty).toBe('Broncopulmonar');
    expect(record.cma[0]?.specialty).toBe('Dermatología');
  });
});
