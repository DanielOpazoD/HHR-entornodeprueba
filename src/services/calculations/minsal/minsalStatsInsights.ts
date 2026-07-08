import type {
  AnalyticsDataQualityIssue,
  MinsalCalculationOptions,
  MinsalComparisonSummary,
  MinsalStatistics,
} from '@/types/minsalTypes';
import type { MinsalDailyRecord } from './minsalRecordContracts';
import { Specialty } from '@/types/domain/patientClassification';
import { calculateDischargeStayDays } from '@/utils/clinicalDayUtils';
import { normalizeSpecialty } from '@/services/calculations/minsal/normalization';

export const resolvePreviousMinsalPeriod = (
  startDate: string,
  endDate: string
): Pick<MinsalComparisonSummary, 'previousPeriodStart' | 'previousPeriodEnd'> => {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);

  return {
    previousPeriodStart: previousStart.toISOString().slice(0, 10),
    previousPeriodEnd: previousEnd.toISOString().slice(0, 10),
  };
};

const roundMetric = (value: number): number => Math.round(value * 10) / 10;

const buildMetric = (current: number, previous?: number | null) => {
  if (previous === undefined || previous === null) {
    return {
      current,
      previous: null,
      absoluteDelta: null,
      relativeDelta: null,
      direction: 'unavailable' as const,
    };
  }

  const absoluteDelta = roundMetric(current - previous);
  return {
    current,
    previous,
    absoluteDelta,
    relativeDelta: previous !== 0 ? roundMetric((absoluteDelta / previous) * 100) : null,
    direction:
      absoluteDelta > 0
        ? ('up' as const)
        : absoluteDelta < 0
          ? ('down' as const)
          : ('flat' as const),
  };
};

export const buildMinsalComparisonSummary = (
  current: MinsalStatistics,
  previous: MinsalStatistics | null
): MinsalComparisonSummary => ({
  periodStart: current.periodStart,
  periodEnd: current.periodEnd,
  previousPeriodStart: previous?.periodStart ?? current.periodStart,
  previousPeriodEnd: previous?.periodEnd ?? current.periodEnd,
  tasaOcupacion: buildMetric(current.tasaOcupacion, previous?.tasaOcupacion),
  egresosTotal: buildMetric(current.egresosTotal, previous?.egresosTotal),
  promedioDiasEstada: buildMetric(current.promedioDiasEstada, previous?.promedioDiasEstada),
  cmaTotal: buildMetric(current.cma?.total ?? 0, previous?.cma?.total),
  mortalidadHospitalaria: buildMetric(
    current.mortalidadHospitalaria,
    previous?.mortalidadHospitalaria
  ),
});

const KNOWN_SPECIALTIES = new Set<string>(Object.values(Specialty).map(value => String(value)));

const isActiveMovement = (movement: { deletedAt?: unknown }): boolean =>
  !String(movement.deletedAt || '').trim();

const hasText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const createIssue = (
  title: string,
  description: string,
  issue: Omit<AnalyticsDataQualityIssue, 'id' | 'title' | 'description'>
): AnalyticsDataQualityIssue => ({
  id: [
    title,
    issue.date || 'sin-fecha',
    issue.movementKind || 'registro',
    issue.movementId || issue.rut || issue.patientName || 'item',
  ].join('|'),
  title,
  description,
  ...issue,
});

const pushSpecialtyIssues = ({
  issues,
  specialty,
  date,
  patientName,
  rut,
  movementKind,
  movementId,
  options,
}: {
  issues: AnalyticsDataQualityIssue[];
  specialty: unknown;
  date: string;
  patientName?: string;
  rut?: string;
  movementKind?: AnalyticsDataQualityIssue['movementKind'];
  movementId?: string;
  options: MinsalCalculationOptions;
}) => {
  const normalized = normalizeSpecialty(hasText(specialty) ? specialty : undefined);
  if (normalized === 'Sin Especialidad') {
    issues.push(
      createIssue('Paciente sin especialidad', 'Registro clínico sin especialidad informada.', {
        severity: 'advertencia',
        date,
        patientName,
        rut,
        movementKind,
        movementId,
      })
    );
    return;
  }

  if (options.specialtyGroupingMode === 'group-other' && !KNOWN_SPECIALTIES.has(normalized)) {
    issues.push(
      createIssue(
        'Especialidad libre agrupada como Otro',
        `La especialidad "${normalized}" se agrupa como Otro para estadística.`,
        {
          severity: 'info',
          date,
          patientName,
          rut,
          movementKind,
          movementId,
        }
      )
    );
  }
};

export const buildAnalyticsDataQualityIssues = (
  records: MinsalDailyRecord[],
  options: MinsalCalculationOptions = {}
): AnalyticsDataQualityIssue[] => {
  const issues: AnalyticsDataQualityIssue[] = [];
  const rutDateCounts = new Map<string, { count: number; date: string; rut: string }>();

  const registerPatientDate = (date: string, rut?: string) => {
    if (!hasText(rut)) return;
    const key = `${rut}|${date}`;
    const existing = rutDateCounts.get(key);
    rutDateCounts.set(key, { count: (existing?.count ?? 0) + 1, date, rut });
  };

  records.forEach(record => {
    Object.values(record.beds || {}).forEach(bed => {
      if (!hasText(bed?.patientName)) return;
      registerPatientDate(record.date, bed.rut);
      pushSpecialtyIssues({
        issues,
        specialty: bed.specialty,
        date: record.date,
        patientName: bed.patientName,
        rut: bed.rut,
        movementKind: 'bed',
        movementId: bed.bedId || bed.bedName,
        options,
      });
    });

    (record.discharges || []).filter(isActiveMovement).forEach(discharge => {
      registerPatientDate(record.date, discharge.rut);
      pushSpecialtyIssues({
        issues,
        specialty: discharge.specialty,
        date: record.date,
        patientName: discharge.patientName,
        rut: discharge.rut,
        movementKind: 'discharge',
        movementId: discharge.id,
        options,
      });
      if (!hasText(discharge.movementDate)) {
        issues.push(
          createIssue(
            'Egreso sin fecha explícita',
            'El cálculo usa la fecha del censo como fecha de egreso.',
            {
              severity: 'advertencia',
              date: record.date,
              patientName: discharge.patientName,
              rut: discharge.rut,
              movementKind: 'discharge',
              movementId: discharge.id,
            }
          )
        );
      }
      if (
        hasText(discharge.admissionDate) &&
        calculateDischargeStayDays(
          discharge.admissionDate,
          discharge.movementDate || record.date
        ) === null
      ) {
        issues.push(
          createIssue('Estadía imposible', 'La fecha de ingreso ocurre después del egreso.', {
            severity: 'critico',
            date: record.date,
            patientName: discharge.patientName,
            rut: discharge.rut,
            movementKind: 'discharge',
            movementId: discharge.id,
          })
        );
      }
    });

    (record.transfers || []).filter(isActiveMovement).forEach(transfer => {
      registerPatientDate(record.date, transfer.rut);
      pushSpecialtyIssues({
        issues,
        specialty: transfer.specialty,
        date: record.date,
        patientName: transfer.patientName,
        rut: transfer.rut,
        movementKind: 'transfer',
        movementId: transfer.id,
        options,
      });
      if (!hasText(transfer.movementDate)) {
        issues.push(
          createIssue(
            'Traslado sin fecha explícita',
            'El cálculo usa la fecha del censo como fecha de traslado.',
            {
              severity: 'advertencia',
              date: record.date,
              patientName: transfer.patientName,
              rut: transfer.rut,
              movementKind: 'transfer',
              movementId: transfer.id,
            }
          )
        );
      }
      if (
        hasText(transfer.admissionDate) &&
        calculateDischargeStayDays(transfer.admissionDate, transfer.movementDate || record.date) ===
          null
      ) {
        issues.push(
          createIssue('Estadía imposible', 'La fecha de ingreso ocurre después del traslado.', {
            severity: 'critico',
            date: record.date,
            patientName: transfer.patientName,
            rut: transfer.rut,
            movementKind: 'transfer',
            movementId: transfer.id,
          })
        );
      }
    });

    (record.cma || []).filter(isActiveMovement).forEach(item => {
      registerPatientDate(record.date, item.rut);
      pushSpecialtyIssues({
        issues,
        specialty: item.specialty,
        date: record.date,
        patientName: item.patientName,
        rut: item.rut,
        movementKind: 'cma',
        movementId: item.id,
        options,
      });
      if (!hasText(item.interventionType)) {
        issues.push(
          createIssue(
            'CMA/PMA sin tipo de intervención',
            'El evento no distingue Cirugía Mayor Ambulatoria de Procedimiento Médico Ambulatorio.',
            {
              severity: 'critico',
              date: record.date,
              patientName: item.patientName,
              rut: item.rut,
              movementKind: 'cma',
              movementId: item.id,
            }
          )
        );
      }
    });
  });

  rutDateCounts.forEach(({ count, date, rut }) => {
    if (count > 1) {
      issues.push(
        createIssue('Duplicado por RUT y fecha', 'Hay más de un evento para el mismo RUT y día.', {
          severity: 'advertencia',
          date,
          rut,
        })
      );
    }
  });

  return issues;
};
