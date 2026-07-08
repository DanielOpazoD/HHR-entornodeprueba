import { Specialty } from '@/types/domain/patientClassification';
import type {
  CmaStatistics,
  MinsalCalculationOptions,
  PatientTraceability,
} from '@/types/minsalTypes';
import type { MinsalDailyRecord } from './minsalRecordContracts';
import { getActiveCma } from '@/application/census/movementTombstonePolicy';
import {
  buildReportingSpecialtyTraceFields,
  resolveReportingSpecialty,
} from './specialtyReporting';

type CmaBucket = {
  total: number;
  cirugiaMayorAmbulatoria: number;
  procedimientoMedicoAmbulatorio: number;
  pacientesList: PatientTraceability[];
};

export type CmaStatsAccumulator = {
  cmaData: Map<string, CmaBucket>;
  cmaPatientsList: PatientTraceability[];
};

const createCmaBucket = (): CmaBucket => ({
  total: 0,
  cirugiaMayorAmbulatoria: 0,
  procedimientoMedicoAmbulatorio: 0,
  pacientesList: [],
});

export const createCmaStatsAccumulator = (): CmaStatsAccumulator => ({
  cmaData: new Map<string, CmaBucket>(),
  cmaPatientsList: [],
});

export const collectCmaStats = (
  record: MinsalDailyRecord,
  options: MinsalCalculationOptions,
  accumulator: CmaStatsAccumulator
): void => {
  getActiveCma(record.cma).forEach(item => {
    const specialtyResolution = resolveReportingSpecialty({
      specialty: item.specialty,
      movementKind: 'cma',
      movementId: item.id,
      date: record.date,
      options,
    });
    const specialty = specialtyResolution.reportingSpecialty;
    const existing = accumulator.cmaData.get(specialty) || createCmaBucket();
    const isCma = item.interventionType === 'Cirugía Mayor Ambulatoria';
    const traceData: PatientTraceability = {
      name: item.patientName,
      rut: item.rut,
      diagnosis: item.diagnosis?.trim() || undefined,
      date: record.date,
      bedName: item.bedName,
      dischargeDate: record.date,
      movementKind: 'cma',
      movementId: item.id,
      interventionType: item.interventionType,
      eventTime: item.dischargeTime,
      ...buildReportingSpecialtyTraceFields(specialtyResolution),
    };

    existing.total++;
    if (isCma) {
      existing.cirugiaMayorAmbulatoria++;
    } else {
      existing.procedimientoMedicoAmbulatorio++;
    }
    existing.pacientesList.push(traceData);
    accumulator.cmaPatientsList.push(traceData);
    accumulator.cmaData.set(specialty, existing);
  });
};

export const buildCmaStatistics = (accumulator: CmaStatsAccumulator): CmaStatistics => {
  if (accumulator.cmaData.size === 0) {
    return {
      total: 0,
      cirugiaMayorAmbulatoria: 0,
      procedimientoMedicoAmbulatorio: 0,
      porEspecialidad: [],
      pacientesList: [],
    };
  }

  const buckets = Array.from(accumulator.cmaData.values());
  return {
    total: buckets.reduce((sum, item) => sum + item.total, 0),
    cirugiaMayorAmbulatoria: buckets.reduce((sum, item) => sum + item.cirugiaMayorAmbulatoria, 0),
    procedimientoMedicoAmbulatorio: buckets.reduce(
      (sum, item) => sum + item.procedimientoMedicoAmbulatorio,
      0
    ),
    porEspecialidad: Array.from(accumulator.cmaData.entries())
      .map(([specialty, data]) => ({
        specialty: specialty as Specialty,
        total: data.total,
        cirugiaMayorAmbulatoria: data.cirugiaMayorAmbulatoria,
        procedimientoMedicoAmbulatorio: data.procedimientoMedicoAmbulatorio,
        pacientesList: data.pacientesList,
      }))
      .sort((a, b) => b.total - a.total || String(a.specialty).localeCompare(String(b.specialty))),
    pacientesList: accumulator.cmaPatientsList,
  };
};
