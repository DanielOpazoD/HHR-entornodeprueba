/** MINSAL/DEIS statistics calculator. */

import { DailyRecord, PatientData, Specialty } from '@/types';
import { BEDS, HOSPITAL_CAPACITY, EVACUATION_METHOD_AEROCARDAL } from '@/constants';
import {
  MinsalStatistics,
  SpecialtyStats,
  DailyStatsSnapshot,
  DateRangePreset,
} from '@/types/minsalTypes';

/** Calculate date range from preset. */
export function getDateRangeFromPreset(
  preset: DateRangePreset,
  customStart?: string,
  customEnd?: string,
  currentYearMonth?: number
): { startDate: string; endDate: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const formatDate = (d: Date): string => d.toISOString().split('T')[0];

  switch (preset) {
    case 'today':
      return { startDate: formatDate(today), endDate: formatDate(today) };

    case 'last7days': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'lastMonth': {
      // Rolling 30 days including today
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'currentMonth': {
      // Configurable month in current year.
      // If selected month is current, end date is today; otherwise end of selected month.
      const normalizedMonth = Math.min(12, Math.max(1, currentYearMonth ?? today.getMonth() + 1));
      const monthIndex = normalizedMonth - 1;
      const year = today.getFullYear();
      const start = new Date(year, monthIndex, 1);
      const end = monthIndex === today.getMonth() ? today : new Date(year, monthIndex + 1, 0);
      return { startDate: formatDate(start), endDate: formatDate(end) };
    }

    case 'yearToDate': {
      // Calendar year from Jan 1 to today
      const start = new Date(today.getFullYear(), 0, 1);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'last3Months': {
      // Rolling 90 days including today
      const start = new Date(today);
      start.setDate(start.getDate() - 89);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'last6Months': {
      // Rolling 180 days including today
      const start = new Date(today);
      start.setDate(start.getDate() - 179);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'last12Months': {
      // Rolling 365 days including today
      const start = new Date(today);
      start.setDate(start.getDate() - 364);
      return { startDate: formatDate(start), endDate: formatDate(today) };
    }

    case 'custom':
      if (!customStart || !customEnd) {
        throw new Error('Custom date range requires start and end dates');
      }
      return { startDate: customStart, endDate: customEnd };

    default:
      return { startDate: formatDate(today), endDate: formatDate(today) };
  }
}

/**
 * Filter records by date range
 */
export function filterRecordsByDateRange(
  records: DailyRecord[],
  startDate: string,
  endDate: string
): DailyRecord[] {
  return records.filter(r => r.date >= startDate && r.date <= endDate);
}

/**
 * Count occupied beds in a record
 */
function countOccupiedBeds(beds: Record<string, PatientData>): number {
  let count = 0;
  BEDS.forEach(bed => {
    const data = beds[bed.id];
    if (data && !data.isBlocked && data.patientName?.trim()) {
      count++;
      // Also count nested clinical crib patients
      if (data.clinicalCrib?.patientName?.trim()) {
        count++;
      }
    }
  });
  return count;
}

function countBlockedBeds(beds: Record<string, PatientData>): number {
  let count = 0;
  BEDS.forEach(bed => {
    const data = beds[bed.id];
    if (data?.isBlocked) {
      count++;
    }
  });
  return count;
}

function normalizeSpecialty(specialty: string | undefined): string {
  if (!specialty) return 'Sin Especialidad';

  const normalized = specialty.trim();

  // Combine legacy gynecology/obstetrics names into unified specialty
  const gynObstetricNames = [
    'Obstetricia',
    'Ginecología',
    'Ginecologia',
    'Obstetricia y Ginecología',
    'Ginecología y Obstetricia',
  ];

  if (gynObstetricNames.some(name => normalized.toLowerCase() === name.toLowerCase())) {
    return 'Ginecobstetricia';
  }

  return normalized || 'Sin Especialidad';
}

const normalizeEvacuationMethodLabel = (value?: string): string =>
  (value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const isFachEvacuationMethod = (value?: string): boolean => {
  const normalized = normalizeEvacuationMethodLabel(value);
  return normalized === 'fach' || normalized === 'avion fach';
};

function getPatientsBySpecialty(beds: Record<string, PatientData>): Map<string, PatientData[]> {
  const bySpecialty = new Map<string, PatientData[]>();

  BEDS.forEach(bed => {
    const data = beds[bed.id];
    if (data && !data.isBlocked && data.patientName?.trim()) {
      const specialty = normalizeSpecialty(data.specialty);
      const existing = bySpecialty.get(specialty) || [];
      existing.push(data);
      bySpecialty.set(specialty, existing);

      // Also count nested crib patients
      if (data.clinicalCrib?.patientName?.trim()) {
        const cribSpecialty = normalizeSpecialty(data.clinicalCrib.specialty);
        const cribExisting = bySpecialty.get(cribSpecialty) || [];
        cribExisting.push(data.clinicalCrib);
        bySpecialty.set(cribSpecialty, cribExisting);
      }
    }
  });

  return bySpecialty;
}

export function calculateDailySnapshot(record: DailyRecord): DailyStatsSnapshot {
  const ocupadas = countOccupiedBeds(record.beds);
  const bloqueadas = countBlockedBeds(record.beds);
  const disponibles = HOSPITAL_CAPACITY - bloqueadas;

  const fallecidos = record.discharges?.filter(d => d.status === 'Fallecido').length || 0;
  const egresos = (record.discharges?.length || 0) + (record.transfers?.length || 0);

  const tasaOcupacion = disponibles > 0 ? (ocupadas / disponibles) * 100 : 0;

  return {
    date: record.date,
    ocupadas,
    disponibles,
    bloqueadas,
    egresos,
    fallecidos,
    tasaOcupacion: Math.round(tasaOcupacion * 10) / 10,
  };
}

/**
 * Main MINSAL statistics calculator
 */
export function calculateMinsalStats(
  records: DailyRecord[],
  startDate: string,
  endDate: string
): MinsalStatistics {
  // Filter records in range
  const filteredRecords = filterRecordsByDateRange(records, startDate, endDate);

  // Calculate period days (calendar days vs days with data)
  const start = new Date(startDate);
  const end = new Date(endDate);
  const calendarDays = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1
  );
  // Use actual days with data for calculations
  const totalDays = filteredRecords.length;

  // Aggregate statistics
  let totalDiasCamaDisponibles = 0;
  let totalDiasCamaOcupados = 0;
  let totalEgresosVivos = 0;
  let totalEgresosFallecidos = 0;
  let totalEgresosTraslados = 0;

  type SpecialtyBucket = {
    pacientes: number;
    egresos: number;
    fallecidos: number;
    traslados: number;
    aerocardal: number;
    fach: number;
    diasOcupados: number;
    diasOcupadosList: import('@/types/minsalTypes').PatientTraceability[];
    egresosList: import('@/types/minsalTypes').PatientTraceability[];
    trasladosList: import('@/types/minsalTypes').PatientTraceability[];
    aerocardalList: import('@/types/minsalTypes').PatientTraceability[];
    fachList: import('@/types/minsalTypes').PatientTraceability[];
    fallecidosList: import('@/types/minsalTypes').PatientTraceability[];
  };
  const createSpecialtyBucket = (): SpecialtyBucket => ({
    pacientes: 0,
    egresos: 0,
    fallecidos: 0,
    traslados: 0,
    aerocardal: 0,
    fach: 0,
    diasOcupados: 0,
    diasOcupadosList: [],
    egresosList: [],
    trasladosList: [],
    aerocardalList: [],
    fachList: [],
    fallecidosList: [],
  });
  // Specialty aggregation
  const specialtyData = new Map<string, SpecialtyBucket>();

  // Pre-calculate discharge/transfer dates for the period [RUT -> Date]
  const dischargeDates = new Map<string, string>();
  filteredRecords.forEach(r => {
    r.discharges?.forEach(d => dischargeDates.set(d.rut, r.date));
    r.transfers?.forEach(t => dischargeDates.set(t.rut, r.date));
  });

  filteredRecords.forEach(record => {
    const bloqueadas = countBlockedBeds(record.beds);
    const disponibles = HOSPITAL_CAPACITY - bloqueadas;
    const ocupadas = countOccupiedBeds(record.beds);

    totalDiasCamaDisponibles += disponibles;
    totalDiasCamaOcupados += ocupadas;

    // Count discharges
    record.discharges?.forEach(d => {
      if (d.status === 'Fallecido') {
        totalEgresosFallecidos++;
      } else {
        totalEgresosVivos++;
      }
    });

    // Count transfers
    totalEgresosTraslados += record.transfers?.length || 0;

    // Aggregate by specialty
    const patientsBySpecialty = getPatientsBySpecialty(record.beds);
    patientsBySpecialty.forEach((patients, specialty) => {
      const existing = specialtyData.get(specialty) || createSpecialtyBucket();
      existing.diasOcupados += patients.length;

      // Traceability: Add patients from this day
      patients.forEach(p => {
        existing.diasOcupadosList.push({
          name: p.patientName,
          rut: p.rut,
          date: record.date,
          bedName: p.bedName,
          admissionDate: p.admissionDate,
          dischargeDate: dischargeDates.get(p.rut),
        });
      });

      specialtyData.set(specialty, existing);
    });

    // Count specialty-specific discharges
    record.discharges?.forEach(d => {
      // Get specialty from originalData snapshot and normalize
      const specialty = normalizeSpecialty(d.originalData?.specialty);
      const existing = specialtyData.get(specialty) || createSpecialtyBucket();
      existing.egresos++;

      // Traceability: Add discharge
      const traceData = {
        name: d.patientName,
        rut: d.rut,
        date: record.date,
        bedName: d.bedName,
      };

      existing.egresosList.push(traceData);

      if (d.status === 'Fallecido') {
        existing.fallecidos++;
        existing.fallecidosList.push(traceData);
      }
      specialtyData.set(specialty, existing);
    });

    // Count specialty-specific transfers
    record.transfers?.forEach(t => {
      // Get specialty from originalData snapshot and normalize
      const specialty = normalizeSpecialty(t.originalData?.specialty);
      const existing = specialtyData.get(specialty) || createSpecialtyBucket();
      existing.traslados++;

      // Traceability: Also count transfers as discharges for list
      const traceData = {
        name: t.patientName,
        rut: t.rut,
        date: record.date,
        bedName: t.bedName,
      };

      existing.egresosList.push(traceData);
      // And specifically for transfers list
      existing.trasladosList.push(traceData);
      if (t.evacuationMethod === EVACUATION_METHOD_AEROCARDAL) {
        existing.aerocardal++;
        existing.aerocardalList.push(traceData);
      }
      if (isFachEvacuationMethod(t.evacuationMethod)) {
        existing.fach++;
        existing.fachList.push(traceData);
      }

      specialtyData.set(specialty, existing);
    });
  });

  // Calculate derived indicators
  const egresosTotal = totalEgresosVivos + totalEgresosFallecidos + totalEgresosTraslados;

  const tasaOcupacion =
    totalDiasCamaDisponibles > 0 ? (totalDiasCamaOcupados / totalDiasCamaDisponibles) * 100 : 0;

  const promedioDiasEstada = egresosTotal > 0 ? totalDiasCamaOcupados / egresosTotal : 0;

  const mortalidadHospitalaria =
    egresosTotal > 0 ? (totalEgresosFallecidos / egresosTotal) * 100 : 0;

  // Fixed Rotation Index: (Egresos / AvgBeds) scaled to 30 days
  const avgAvailableBeds = totalDays > 0 ? totalDiasCamaDisponibles / totalDays : 0;
  const indiceRotacion =
    avgAvailableBeds > 0 && totalDays > 0
      ? (egresosTotal / avgAvailableBeds) * (30 / totalDays)
      : 0;

  // Get current snapshot (Last day with actual hospitalized patients)
  // This prevents showing 0s if today's record was just created but not filled
  const recordsWithData = filteredRecords.filter(r => countOccupiedBeds(r.beds) > 0);
  const latestRecord = (recordsWithData.length > 0 ? recordsWithData : filteredRecords).sort(
    (a, b) => b.date.localeCompare(a.date)
  )[0];

  // Important: Use today's snapshot for situational indicators
  const currentSnapshot = latestRecord
    ? calculateDailySnapshot(latestRecord)
    : { ocupadas: 0, disponibles: HOSPITAL_CAPACITY, bloqueadas: 0, tasaOcupacion: 0 };

  // Build specialty breakdown
  const totalPacientes = Array.from(specialtyData.values()).reduce(
    (sum, s) => sum + s.diasOcupados,
    0
  );

  const porEspecialidad: SpecialtyStats[] = Array.from(specialtyData.entries())
    .map(([specialty, data]) => {
      const egresosEspecialidad = data.egresos || 1;
      return {
        specialty: specialty as Specialty,
        pacientesActuales: latestRecord
          ? getPatientsBySpecialty(latestRecord.beds).get(specialty)?.length || 0
          : 0,
        egresos: data.egresos,
        fallecidos: data.fallecidos,
        diasOcupados: data.diasOcupados,
        contribucionRelativa: totalPacientes > 0 ? (data.diasOcupados / totalPacientes) * 100 : 0,
        tasaMortalidad: egresosEspecialidad > 0 ? (data.fallecidos / egresosEspecialidad) * 100 : 0,
        traslados: data.traslados || 0,
        aerocardal: data.aerocardal || 0,
        fach: data.fach || 0,
        promedioDiasEstada: data.egresos > 0 ? data.diasOcupados / data.egresos : 0,
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
    // Period
    periodStart: startDate,
    periodEnd: endDate,
    totalDays,
    calendarDays,

    // Core MINSAL indicators
    diasCamaDisponibles: totalDiasCamaDisponibles,
    diasCamaOcupados: totalDiasCamaOcupados,
    tasaOcupacion: Math.round(tasaOcupacion * 10) / 10,
    promedioDiasEstada: Math.round(promedioDiasEstada * 10) / 10,

    // Discharges
    egresosTotal,
    egresosVivos: totalEgresosVivos,
    egresosFallecidos: totalEgresosFallecidos,
    egresosTraslados: totalEgresosTraslados,

    // Derived
    mortalidadHospitalaria: Math.round(mortalidadHospitalaria * 10) / 10,
    indiceRotacion: Math.round(indiceRotacion * 10) / 10,

    // Current snapshot (Hoy)
    pacientesActuales: currentSnapshot.ocupadas,
    camasOcupadas: currentSnapshot.ocupadas,
    camasBloqueadas: currentSnapshot.bloqueadas,
    camasDisponibles: currentSnapshot.disponibles, // Habilitadas
    camasLibres: Math.max(0, currentSnapshot.disponibles - currentSnapshot.ocupadas),
    tasaOcupacionActual: 'tasaOcupacion' in currentSnapshot ? currentSnapshot.tasaOcupacion : 0,

    // Specialty breakdown
    porEspecialidad,
  };
}

/**
 * Generate daily trend data for charts
 */
export function generateDailyTrend(records: DailyRecord[]): DailyStatsSnapshot[] {
  return records.map(calculateDailySnapshot).sort((a, b) => a.date.localeCompare(b.date));
}
