import { describe, expect, it } from 'vitest';
import { resolveDailyRecordConflictWithTrace } from '@/services/repositories/conflictResolutionMatrix';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { Specialty } from '@/types/domain/patientClassification';

const makeRecord = (date: string, lastUpdated: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated,
    nurses: [],
    activeExtraBeds: [],
  }) as unknown as DailyRecord;

describe('clinical census field conflict policy', () => {
  it('prioritizes Firebase census fields over stale local diagnosis and specialty', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Censo Remoto',
        rut: '11.111.111-1',
        documentType: 'RUT',
        age: '67a',
        biologicalSex: 'Femenino',
        insurance: 'Fonasa',
        pathology: 'Neumonia adquirida en la comunidad',
        cie10Code: 'J18.9',
        cie10Description: 'Neumonia, no especificada',
        diagnosisComments: 'CURB-65 elevado',
        specialty: Specialty.MEDICINA,
        secondarySpecialty: Specialty.CIRUGIA,
        status: 'Estable',
        ginecobstetriciaType: 'Obstétrica',
        deliveryRoute: 'Cesárea',
        deliveryDate: '2026-02-17',
        deliveryCesareanLabor: 'Trabajo de parto',
        isUPC: true,
        upcChecklist: {
          uciCriteria: ['uci_vmi'],
          utiCriteria: [],
          classification: 'UPC_UCI',
          evaluatedAt: '2026-02-18T10:00:00.000Z',
        },
        handoffNote: 'Nota localizable no censal remota',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T09:55:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Censo Local Cache',
        rut: '22.222.222-2',
        documentType: 'Pasaporte',
        age: '66a',
        biologicalSex: 'Masculino',
        insurance: 'Isapre',
        pathology: 'Diagnostico cache antiguo',
        cie10Code: 'A09',
        cie10Description: 'Gastroenteritis cache',
        diagnosisComments: 'Comentario cache antiguo',
        specialty: Specialty.PEDIATRIA,
        secondarySpecialty: '',
        status: 'Grave',
        ginecobstetriciaType: undefined,
        deliveryRoute: undefined,
        deliveryDate: undefined,
        deliveryCesareanLabor: undefined,
        isUPC: false,
        upcChecklist: {
          uciCriteria: [],
          utiCriteria: [],
          classification: null,
          evaluatedAt: '2026-02-18T09:00:00.000Z',
        },
        handoffNote: 'Nota local de turno debe preservarse',
      } as unknown as DailyRecord['beds'][string],
    };

    const result = resolveDailyRecordConflictWithTrace(remote, local, { changedPaths: ['*'] });

    expect(result.record.beds.R1.patientName).toBe('Paciente Censo Remoto');
    expect(result.record.beds.R1.rut).toBe('11.111.111-1');
    expect(result.record.beds.R1.documentType).toBe('RUT');
    expect(result.record.beds.R1.age).toBe('67a');
    expect(result.record.beds.R1.biologicalSex).toBe('Femenino');
    expect(result.record.beds.R1.insurance).toBe('Fonasa');
    expect(result.record.beds.R1.pathology).toBe('Neumonia adquirida en la comunidad');
    expect(result.record.beds.R1.cie10Code).toBe('J18.9');
    expect(result.record.beds.R1.cie10Description).toBe('Neumonia, no especificada');
    expect(result.record.beds.R1.diagnosisComments).toBe('CURB-65 elevado');
    expect(result.record.beds.R1.specialty).toBe(Specialty.MEDICINA);
    expect(result.record.beds.R1.secondarySpecialty).toBe(Specialty.CIRUGIA);
    expect(result.record.beds.R1.status).toBe('Estable');
    expect(result.record.beds.R1.ginecobstetriciaType).toBe('Obstétrica');
    expect(result.record.beds.R1.deliveryRoute).toBe('Cesárea');
    expect(result.record.beds.R1.deliveryDate).toBe('2026-02-17');
    expect(result.record.beds.R1.isUPC).toBe(true);
    expect(result.record.beds.R1.upcChecklist).toMatchObject({
      classification: 'UPC_UCI',
      uciCriteria: ['uci_vmi'],
    });
    expect(result.record.beds.R1.handoffNote).toBe('Nota local de turno debe preservarse');
    expect(result.trace.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'beds.R1.pathology',
          winner: 'remote',
          reason: 'clinical_census_remote_priority',
        }),
        expect.objectContaining({
          path: 'beds.R1.handoffNote',
          winner: 'local',
          reason: 'handoff_local_priority',
        }),
      ])
    );
  });

  it('keeps local narrative notes without letting a newer local snapshot override remote canonical census fields', () => {
    const remote = makeRecord('2026-02-18', '2026-02-18T10:00:00.000Z');
    remote.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Remoto',
        rut: '11.111.111-1',
        pathology: 'Diagnostico Firebase vigente',
        specialty: Specialty.MEDICINA,
        handoffNote: 'Nota remota antigua',
      } as unknown as DailyRecord['beds'][string],
    };

    const local = makeRecord('2026-02-18', '2026-02-18T10:05:00.000Z');
    local.beds = {
      R1: {
        bedId: 'R1',
        patientName: 'Paciente Local Cache',
        rut: '22.222.222-2',
        pathology: 'Diagnostico local stale',
        specialty: Specialty.PEDIATRIA,
        handoffNote: 'Nota local nueva aun pendiente de sincronizar',
      } as unknown as DailyRecord['beds'][string],
    };

    const result = resolveDailyRecordConflictWithTrace(remote, local, { changedPaths: ['*'] });

    expect(result.record.beds.R1.patientName).toBe('Paciente Remoto');
    expect(result.record.beds.R1.rut).toBe('11.111.111-1');
    expect(result.record.beds.R1.pathology).toBe('Diagnostico Firebase vigente');
    expect(result.record.beds.R1.specialty).toBe(Specialty.MEDICINA);
    expect(result.record.beds.R1.handoffNote).toBe('Nota local nueva aun pendiente de sincronizar');
  });
});
