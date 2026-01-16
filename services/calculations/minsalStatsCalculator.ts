/**
 * MINSAL/DEIS Statistics Calculator
 * Calculates hospital statistics according to Chilean Ministry of Health standards
 *
 * Key MINSAL Indicators:
 * - Días Cama Disponibles/Ocupados
 * - Tasa de Ocupación (Índice Ocupacional)
 * - Promedio Días Estada
 * - Mortalidad Hospitalaria
 * - Índice de Rotación
 */

import { DailyRecord, PatientData, Specialty } from '@/types';
import { BEDS, HOSPITAL_CAPACITY } from '@/constants';
import {
    MinsalStatistics,
    SpecialtyStats,
    DailyStatsSnapshot,
    DateRangePreset,
} from '@/types/minsalTypes';

/**
 * Calculate date range from preset
 * Note: Ranges are calculated based on calendar periods, not rolling days
 */
export function getDateRangeFromPreset(
    preset: DateRangePreset,
    customStart?: string,
    customEnd?: string
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
            // First day of current month to today
            const start = new Date(today.getFullYear(), today.getMonth(), 1);
            return { startDate: formatDate(start), endDate: formatDate(today) };
        }

        case 'last3Months': {
            // First day of 3 months ago to today
            const start = new Date(today.getFullYear(), today.getMonth() - 2, 1);
            return { startDate: formatDate(start), endDate: formatDate(today) };
        }

        case 'last6Months': {
            // First day of 6 months ago to today
            const start = new Date(today.getFullYear(), today.getMonth() - 5, 1);
            return { startDate: formatDate(start), endDate: formatDate(today) };
        }

        case 'last12Months': {
            // First day of 12 months ago to today
            const start = new Date(today.getFullYear() - 1, today.getMonth(), 1);
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
    return records.filter((r) => r.date >= startDate && r.date <= endDate);
}

/**
 * Count occupied beds in a record
 */
function countOccupiedBeds(beds: Record<string, PatientData>): number {
    let count = 0;
    BEDS.forEach((bed) => {
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

/**
 * Count blocked beds in a record
 */
function countBlockedBeds(beds: Record<string, PatientData>): number {
    let count = 0;
    BEDS.forEach((bed) => {
        const data = beds[bed.id];
        if (data?.isBlocked) {
            count++;
        }
    });
    return count;
}

/**
 * Normalize specialty names to handle legacy data
 * Combines similar specialties (e.g., 'Obstetricia', 'Ginecología' -> 'Ginecobstetricia')
 */
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

    if (gynObstetricNames.some(name =>
        normalized.toLowerCase() === name.toLowerCase()
    )) {
        return 'Ginecobstetricia';
    }

    return normalized || 'Sin Especialidad';
}

/**
 * Get patients by specialty from a record
 */
function getPatientsBySpecialty(
    beds: Record<string, PatientData>
): Map<string, PatientData[]> {
    const bySpecialty = new Map<string, PatientData[]>();

    BEDS.forEach((bed) => {
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

/**
 * Calculate daily statistics snapshot
 */
export function calculateDailySnapshot(record: DailyRecord): DailyStatsSnapshot {
    const ocupadas = countOccupiedBeds(record.beds);
    const bloqueadas = countBlockedBeds(record.beds);
    const disponibles = HOSPITAL_CAPACITY - bloqueadas;

    const fallecidos =
        record.discharges?.filter((d) => d.status === 'Fallecido').length || 0;
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
    const calendarDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    // Use actual days with data for calculations
    const totalDays = filteredRecords.length;

    // Aggregate statistics
    let totalDiasCamaDisponibles = 0;
    let totalDiasCamaOcupados = 0;
    let totalEgresosVivos = 0;
    let totalEgresosFallecidos = 0;
    let totalEgresosTraslados = 0;

    // Specialty aggregation
    const specialtyData = new Map<
        string,
        {
            pacientes: number;
            egresos: number;
            fallecidos: number;
            traslados: number;
            diasOcupados: number;
        }
    >();

    filteredRecords.forEach((record) => {
        const bloqueadas = countBlockedBeds(record.beds);
        const disponibles = HOSPITAL_CAPACITY - bloqueadas;
        const ocupadas = countOccupiedBeds(record.beds);

        totalDiasCamaDisponibles += disponibles;
        totalDiasCamaOcupados += ocupadas;

        // Count discharges
        record.discharges?.forEach((d) => {
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
            const existing = specialtyData.get(specialty) || {
                pacientes: 0,
                egresos: 0,
                fallecidos: 0,
                traslados: 0,
                diasOcupados: 0,
            };
            existing.diasOcupados += patients.length;
            specialtyData.set(specialty, existing);
        });

        // Count specialty-specific discharges
        record.discharges?.forEach((d) => {
            // Get specialty from originalData snapshot and normalize
            const specialty = normalizeSpecialty(d.originalData?.specialty);
            const existing = specialtyData.get(specialty) || {
                pacientes: 0,
                egresos: 0,
                fallecidos: 0,
                traslados: 0,
                diasOcupados: 0,
            };
            existing.egresos++;
            if (d.status === 'Fallecido') {
                existing.fallecidos++;
            }
            specialtyData.set(specialty, existing);
        });

        // Count specialty-specific transfers
        record.transfers?.forEach((t) => {
            // Get specialty from originalData snapshot and normalize
            const specialty = normalizeSpecialty(t.originalData?.specialty);
            const existing = specialtyData.get(specialty) || {
                pacientes: 0,
                egresos: 0,
                fallecidos: 0,
                traslados: 0,
                diasOcupados: 0,
            };
            existing.traslados++;
            specialtyData.set(specialty, existing);
        });
    });

    // Calculate derived indicators
    const egresosTotal = totalEgresosVivos + totalEgresosFallecidos + totalEgresosTraslados;

    const tasaOcupacion =
        totalDiasCamaDisponibles > 0
            ? (totalDiasCamaOcupados / totalDiasCamaDisponibles) * 100
            : 0;

    const promedioDiasEstada =
        egresosTotal > 0 ? totalDiasCamaOcupados / egresosTotal : 0;

    const mortalidadHospitalaria =
        egresosTotal > 0 ? (totalEgresosFallecidos / egresosTotal) * 100 : 0;

    const indiceRotacion =
        totalDiasCamaDisponibles > 0 && totalDays > 0
            ? (egresosTotal / (totalDiasCamaDisponibles / totalDays)) * (totalDays / 30)
            : 0;

    // Get current snapshot from most recent record
    const latestRecord = filteredRecords.sort((a, b) =>
        b.date.localeCompare(a.date)
    )[0];

    const currentSnapshot = latestRecord
        ? calculateDailySnapshot(latestRecord)
        : { ocupadas: 0, disponibles: HOSPITAL_CAPACITY, bloqueadas: 0 };

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
                    ? (getPatientsBySpecialty(latestRecord.beds).get(specialty)?.length || 0)
                    : 0,
                egresos: data.egresos,
                fallecidos: data.fallecidos,
                diasOcupados: data.diasOcupados,
                contribucionRelativa:
                    totalPacientes > 0 ? (data.diasOcupados / totalPacientes) * 100 : 0,
                tasaMortalidad:
                    egresosEspecialidad > 0
                        ? (data.fallecidos / egresosEspecialidad) * 100
                        : 0,
                traslados: data.traslados || 0,
                promedioDiasEstada:
                    data.egresos > 0 ? data.diasOcupados / data.egresos : 0,
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

        // Current snapshot
        pacientesActuales: currentSnapshot.ocupadas,
        camasOcupadas: currentSnapshot.ocupadas,
        camasBloqueadas: currentSnapshot.bloqueadas,
        camasDisponibles: currentSnapshot.disponibles,

        // Specialty breakdown
        porEspecialidad,
    };
}

/**
 * Generate daily trend data for charts
 */
export function generateDailyTrend(records: DailyRecord[]): DailyStatsSnapshot[] {
    return records
        .map(calculateDailySnapshot)
        .sort((a, b) => a.date.localeCompare(b.date));
}
