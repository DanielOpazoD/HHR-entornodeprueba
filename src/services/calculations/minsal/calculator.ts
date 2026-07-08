import { Specialty } from '@/types/domain/patientClassification';
import { HOSPITAL_CAPACITY } from '@/constants/beds';
import { EVACUATION_METHOD_AEROCARDAL } from '@/constants/clinicalMovementConstants';
import {
  MinsalCalculationOptions,
  MinsalStatistics,
  PatientTraceability,
  SpecialtyStats,
} from '@/types/minsalTypes';
import { isFachEvacuationMethod } from './normalization';
import { countOccupiedBeds, countBlockedBeds, calculateDailySnapshot } from './snapshot';
import { getPatientsBySpecialty } from './specialty';
import { calculateDischargeStayDays } from '@/utils/clinicalDayUtils';
import { createEpisodeAdmissionTracker } from './episodeTracker';
import type { MinsalDailyRecord } from './minsalRecordContracts';
import { normalizeMovementReportingSnapshot } from './movementCompatibility';
import {
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';
import {
  buildReportingSpecialtyTraceFields,
  resolveReportingSpecialty,
} from './specialtyReporting';
import { buildCmaStatistics, collectCmaStats, createCmaStatsAccumulator } from './cmaStats';

const resolveTraceabilityDiagnosis = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const diagnosis = value.trim();
  return diagnosis || undefined;
};

const resolveMovementAdmissionDate = (
  movement: {
    clinicalEpisodeId?: string;
    rut?: string;
    admissionDate?: string;
  },
  episodeTracker: ReturnType<typeof createEpisodeAdmissionTracker>
): string | undefined => episodeTracker.resolveAdmissionDate(movement, movement.admissionDate);

const resolveMovementDiagnosis = (movement: { diagnosis?: string }): string | undefined =>
  resolveTraceabilityDiagnosis(movement.diagnosis);

type StaySummary = {
  minimum: number;
  maximum: number;
};

const buildStaySummary = (durations: number[]): StaySummary => {
  if (durations.length === 0) {
    return { minimum: 0, maximum: 0 };
  }

  return {
    minimum: Math.min(...durations),
    maximum: Math.max(...durations),
  };
};

const sumStayDurations = (durations: number[]): number =>
  durations.reduce((total, duration) => total + duration, 0);

/**
 * Filter records by date range
 */
export function filterRecordsByDateRange(
  records: MinsalDailyRecord[],
  startDate: string,
  endDate: string
): MinsalDailyRecord[] {
  return records.filter(r => r.date >= startDate && r.date <= endDate);
}

/**
 * Main MINSAL statistics calculator
 */
export function calculateMinsalStats(
  records: MinsalDailyRecord[],
  startDate: string,
  endDate: string,
  options: MinsalCalculationOptions = {}
): MinsalStatistics {
  // Filter records in range
  const filteredRecords = filterRecordsByDateRange(records, startDate, endDate);
  const orderedRecords = [...filteredRecords].sort((a, b) => a.date.localeCompare(b.date));
  const episodeTracker = createEpisodeAdmissionTracker();

  // Calculate period days
  const start = new Date(startDate);
  const end = new Date(endDate);
  const calendarDays = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
  const totalDays = filteredRecords.length;

  // Aggregate statistics
  let totalDiasCamaDisponibles = 0;
  let totalDiasCamaOcupados = 0;
  let totalEgresosVivos = 0;
  let totalEgresosFallecidos = 0;
  let totalEgresosTraslados = 0;
  const totalStayDurations: number[] = [];

  type SpecialtyBucket = {
    pacientes: number;
    egresos: number;
    fallecidos: number;
    traslados: number;
    aerocardal: number;
    fach: number;
    diasOcupados: number;
    stayDurations: number[];
    diasOcupadosList: PatientTraceability[];
    egresosList: PatientTraceability[];
    trasladosList: PatientTraceability[];
    aerocardalList: PatientTraceability[];
    fachList: PatientTraceability[];
    fallecidosList: PatientTraceability[];
  };

  const createSpecialtyBucket = (): SpecialtyBucket => ({
    pacientes: 0,
    egresos: 0,
    fallecidos: 0,
    traslados: 0,
    aerocardal: 0,
    fach: 0,
    diasOcupados: 0,
    stayDurations: [],
    diasOcupadosList: [],
    egresosList: [],
    trasladosList: [],
    aerocardalList: [],
    fachList: [],
    fallecidosList: [],
  });

  const specialtyData = new Map<string, SpecialtyBucket>();
  const cmaAccumulator = createCmaStatsAccumulator();

  // Pre-calculate discharge/transfer dates
  const dischargeDates = new Map<string, string>();
  orderedRecords.forEach(r => {
    getActiveDischarges(r.discharges).forEach(d => dischargeDates.set(d.rut, r.date));
    getActiveTransfers(r.transfers).forEach(t => dischargeDates.set(t.rut, r.date));
  });

  orderedRecords.forEach(record => {
    Object.values(record.beds || {}).forEach(bed => {
      episodeTracker.observeBed(bed, record.date);
    });
    const closedEpisodes: Array<{
      clinicalEpisodeId?: string;
      rut?: string;
      admissionDate?: string;
    }> = [];

    const bloqueadas = countBlockedBeds(record.beds);
    const disponibles = HOSPITAL_CAPACITY - bloqueadas;
    const ocupadas = countOccupiedBeds(record.beds);

    totalDiasCamaDisponibles += disponibles;
    totalDiasCamaOcupados += ocupadas;

    const activeDischarges = getActiveDischarges(record.discharges);
    const activeTransfers = getActiveTransfers(record.transfers);

    activeDischarges.forEach(d => {
      if (d.status === 'Fallecido') totalEgresosFallecidos++;
      else totalEgresosVivos++;
    });

    totalEgresosTraslados += activeTransfers.length;

    const patientsBySpecialty = getPatientsBySpecialty(record.beds, options);
    patientsBySpecialty.forEach((patients, specialty) => {
      const existing = specialtyData.get(specialty) || createSpecialtyBucket();
      existing.diasOcupados += patients.length;

      patients.forEach(p => {
        const specialtyResolution = resolveReportingSpecialty({
          specialty: p.specialty,
          options,
        });
        existing.diasOcupadosList.push({
          name: p.patientName,
          rut: p.rut,
          diagnosis: resolveTraceabilityDiagnosis(p.pathology),
          date: record.date,
          bedName: p.bedName,
          admissionDate: episodeTracker.resolveAdmissionDate(p, p.admissionDate),
          dischargeDate: dischargeDates.get(p.rut),
          ...buildReportingSpecialtyTraceFields(specialtyResolution),
        });
      });
      specialtyData.set(specialty, existing);
    });

    activeDischarges.forEach(d => {
      const discharge = normalizeMovementReportingSnapshot(d);
      const specialtyResolution = resolveReportingSpecialty({
        specialty: discharge.specialty,
        movementKind: 'discharge',
        movementId: d.id,
        date: record.date,
        options,
      });
      const specialty = specialtyResolution.reportingSpecialty;
      const existing = specialtyData.get(specialty) || createSpecialtyBucket();
      existing.egresos++;

      const resolvedAdmissionDate = resolveMovementAdmissionDate(discharge, episodeTracker);
      const stayDays = calculateDischargeStayDays(resolvedAdmissionDate, record.date);
      if (stayDays !== null) {
        existing.stayDurations.push(stayDays);
        totalStayDurations.push(stayDays);
      }

      const traceData = {
        name: d.patientName,
        rut: d.rut,
        diagnosis: resolveMovementDiagnosis(discharge),
        date: record.date,
        bedName: d.bedName,
        admissionDate: resolvedAdmissionDate,
        dischargeDate: record.date,
        movementKind: 'discharge' as const,
        movementId: d.id,
        eventTime: d.time,
        ...buildReportingSpecialtyTraceFields(specialtyResolution),
      };

      existing.egresosList.push(traceData);
      if (d.status === 'Fallecido') {
        existing.fallecidos++;
        existing.fallecidosList.push(traceData);
      }
      if (d.rut) {
        closedEpisodes.push(d);
      }
      specialtyData.set(specialty, existing);
    });

    activeTransfers.forEach(t => {
      const transfer = normalizeMovementReportingSnapshot(t);
      const specialtyResolution = resolveReportingSpecialty({
        specialty: transfer.specialty,
        movementKind: 'transfer',
        movementId: t.id,
        date: record.date,
        options,
      });
      const specialty = specialtyResolution.reportingSpecialty;
      const existing = specialtyData.get(specialty) || createSpecialtyBucket();
      existing.traslados++;

      const resolvedAdmissionDate = resolveMovementAdmissionDate(transfer, episodeTracker);
      const stayDays = calculateDischargeStayDays(resolvedAdmissionDate, record.date);
      if (stayDays !== null) {
        existing.stayDurations.push(stayDays);
        totalStayDurations.push(stayDays);
      }

      const traceData = {
        name: t.patientName,
        rut: t.rut,
        diagnosis: resolveMovementDiagnosis(transfer),
        date: record.date,
        bedName: t.bedName,
        admissionDate: resolvedAdmissionDate,
        dischargeDate: record.date,
        movementKind: 'transfer' as const,
        movementId: t.id,
        eventTime: t.time,
        ...buildReportingSpecialtyTraceFields(specialtyResolution),
      };

      existing.egresosList.push(traceData);
      existing.trasladosList.push(traceData);
      if (t.evacuationMethod === EVACUATION_METHOD_AEROCARDAL) {
        existing.aerocardal++;
        existing.aerocardalList.push(traceData);
      }
      if (isFachEvacuationMethod(t.evacuationMethod)) {
        existing.fach++;
        existing.fachList.push(traceData);
      }
      if (t.rut) {
        closedEpisodes.push(t);
      }
      specialtyData.set(specialty, existing);
    });

    collectCmaStats(record, options, cmaAccumulator);

    closedEpisodes.forEach(episode => episodeTracker.closeEpisode(episode));
  });

  const egresosTotal = totalEgresosVivos + totalEgresosFallecidos + totalEgresosTraslados;
  const tasaOcupacion =
    totalDiasCamaDisponibles > 0 ? (totalDiasCamaOcupados / totalDiasCamaDisponibles) * 100 : 0;
  const totalStayDays = sumStayDurations(totalStayDurations);
  const promedioDiasEstada =
    totalStayDurations.length > 0 ? totalStayDays / totalStayDurations.length : 0;
  const mortalidadHospitalaria =
    egresosTotal > 0 ? (totalEgresosFallecidos / egresosTotal) * 100 : 0;

  const indiceRotacion =
    totalDiasCamaDisponibles > 0 ? (egresosTotal * 30) / totalDiasCamaDisponibles : 0;

  const recordsWithData = filteredRecords.filter(r => countOccupiedBeds(r.beds) > 0);
  const latestRecord = (recordsWithData.length > 0 ? recordsWithData : filteredRecords).sort(
    (a, b) => b.date.localeCompare(a.date)
  )[0];

  const currentSnapshot = latestRecord
    ? calculateDailySnapshot(latestRecord)
    : { ocupadas: 0, disponibles: HOSPITAL_CAPACITY, bloqueadas: 0, tasaOcupacion: 0 };

  const totalPacientes = Array.from(specialtyData.values()).reduce(
    (sum, s) => sum + s.diasOcupados,
    0
  );
  const totalStaySummary = buildStaySummary(totalStayDurations);

  const cma = buildCmaStatistics(cmaAccumulator);

  const porEspecialidad: SpecialtyStats[] = Array.from(specialtyData.entries())
    .map(([specialty, data]) => {
      const egresosEspecialidad = data.egresos + data.traslados;
      const specialtyStayDays = sumStayDurations(data.stayDurations);
      const staySummary = buildStaySummary(data.stayDurations);
      return {
        specialty: specialty as Specialty,
        pacientesActuales: latestRecord
          ? getPatientsBySpecialty(latestRecord.beds, options).get(specialty)?.length || 0
          : 0,
        egresos: data.egresos,
        fallecidos: data.fallecidos,
        diasOcupados: data.diasOcupados,
        contribucionRelativa: totalPacientes > 0 ? (data.diasOcupados / totalPacientes) * 100 : 0,
        tasaMortalidad: egresosEspecialidad > 0 ? (data.fallecidos / egresosEspecialidad) * 100 : 0,
        traslados: data.traslados || 0,
        aerocardal: data.aerocardal || 0,
        fach: data.fach || 0,
        promedioDiasEstada:
          data.stayDurations.length > 0 ? specialtyStayDays / data.stayDurations.length : 0,
        promedioDiasEstadaMinima: staySummary.minimum,
        promedioDiasEstadaMaxima: staySummary.maximum,
        diasOcupadosList: data.diasOcupadosList,
        egresosList: data.egresosList,
        trasladosList: data.trasladosList,
        aerocardalList: data.aerocardalList,
        fachList: data.fachList,
        fallecidosList: data.fallecidosList,
      };
    })
    .sort((a, b) => b.contribucionRelativa - a.contribucionRelativa);

  return {
    periodStart: startDate,
    periodEnd: endDate,
    totalDays,
    calendarDays,
    diasCamaDisponibles: totalDiasCamaDisponibles,
    diasCamaOcupados: totalDiasCamaOcupados,
    tasaOcupacion: Math.round(tasaOcupacion * 10) / 10,
    promedioDiasEstada,
    promedioDiasEstadaMinima: totalStaySummary.minimum,
    promedioDiasEstadaMaxima: totalStaySummary.maximum,
    egresosTotal,
    egresosVivos: totalEgresosVivos,
    egresosFallecidos: totalEgresosFallecidos,
    egresosTraslados: totalEgresosTraslados,
    mortalidadHospitalaria: Math.round(mortalidadHospitalaria * 10) / 10,
    indiceRotacion: Math.round(indiceRotacion * 10) / 10,
    pacientesActuales: currentSnapshot.ocupadas,
    camasOcupadas: currentSnapshot.ocupadas,
    camasBloqueadas: currentSnapshot.bloqueadas,
    camasDisponibles: currentSnapshot.disponibles,
    camasLibres: Math.max(0, currentSnapshot.disponibles - currentSnapshot.ocupadas),
    tasaOcupacionActual: currentSnapshot.tasaOcupacion,
    porEspecialidad,
    cma,
  };
}
