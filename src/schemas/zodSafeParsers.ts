import type { BedType } from '@/types/domain/beds';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { applyDailyRecordStaffingCompatibility } from '@/services/staff/dailyRecordStaffing';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { SafeParseReturnType } from 'zod';

import { normalizeLegacyNullsDeep } from './zod/legacyNormalization';
import { DailyRecordSchema, RayenBedCollisionResolutionReceiptSchema } from './zod/dailyRecord';
import { PatientDataSchema } from './zod/patient';
import { CMADataSchema, DischargeDataSchema, TransferDataSchema } from './zod/movements';
import { buildFallbackPatientData } from './zodFallbackBuilders';
import type { DailyRecordParseReport, PatientDataParseReport } from './zodParseReports';

export const safeParseDailyRecord = (data: unknown): DailyRecord | null => {
  const { normalized } = normalizeLegacyNullsDeep(data);
  const result = DailyRecordSchema.safeParse(normalized);
  if (result.success) return result.data as DailyRecord;

  recordOperationalTelemetry({
    category: 'sync',
    operation: 'safe_parse_daily_record',
    status: 'degraded',
    issues: result.error.issues
      .slice(0, 5)
      .map(issue => `${issue.path.join('.')}: ${issue.message}`),
  });
  return null;
};

export const parsePatientDataWithDefaultsReport = (
  data: unknown,
  bedId: string
): { patient: PatientData; report: PatientDataParseReport } => {
  const { normalized, report: nullNormalization } = normalizeLegacyNullsDeep(data);
  const parsed = PatientDataSchema.safeParse(normalized);
  if (parsed.success) {
    return {
      patient: parsed.data,
      report: {
        nullNormalization,
        usedFallback: false,
      },
    };
  }

  return {
    patient: buildFallbackPatientData(normalized, bedId),
    report: {
      nullNormalization,
      usedFallback: true,
    },
  };
};

export const parsePatientDataWithDefaults = (data: unknown, bedId: string): PatientData =>
  parsePatientDataWithDefaultsReport(data, bedId).patient;

export const parseDailyRecordWithDefaultsReport = (
  data: unknown,
  docId: string
): { record: DailyRecord; report: DailyRecordParseReport } => {
  const { normalized, report: nullNormalization } = normalizeLegacyNullsDeep(data);
  try {
    const result = DailyRecordSchema.safeParse(normalized);
    if (result.success) {
      return {
        record: result.data as DailyRecord,
        report: {
          nullNormalization,
          salvagedBeds: [],
          droppedDischargeItems: 0,
          droppedTransferItems: 0,
          droppedCmaItems: 0,
        },
      };
    }
  } catch {
    // Fall through to fallback normalization below.
  }

  const raw = (normalized && typeof normalized === 'object' ? normalized : {}) as Record<
    string,
    unknown
  >;
  const salvagedBeds: Record<string, PatientData> = {};
  const salvagedBedIds: string[] = [];

  if (raw.beds && typeof raw.beds === 'object' && !Array.isArray(raw.beds)) {
    Object.entries(raw.beds as Record<string, unknown>).forEach(([id, patient]) => {
      const parsed = PatientDataSchema.safeParse(patient);
      if (parsed.success) {
        salvagedBeds[id] = parsed.data;
        return;
      }

      salvagedBeds[id] = buildFallbackPatientData(patient, id);
      salvagedBedIds.push(id);
    });
  }

  const salvageArrayItems = <T>(
    items: unknown,
    schema: { safeParse: (value: unknown) => SafeParseReturnType<unknown, T> }
  ): { values: T[]; dropped: number } => {
    const values: T[] = [];
    let dropped = 0;
    if (Array.isArray(items)) {
      items.forEach(item => {
        const parsed = schema.safeParse(item);
        if (parsed.success) values.push(parsed.data);
        else dropped += 1;
      });
    }
    return { values, dropped };
  };

  const salvagedDischarges = salvageArrayItems<DischargeData>(raw.discharges, DischargeDataSchema);
  const salvagedTransfers = salvageArrayItems<TransferData>(raw.transfers, TransferDataSchema);
  const salvagedCma = salvageArrayItems<CMAData>(raw.cma, CMADataSchema);

  return {
    record: applyDailyRecordStaffingCompatibility({
      date: typeof raw.date === 'string' ? raw.date : docId,
      beds: salvagedBeds,
      discharges: salvagedDischarges.values,
      transfers: salvagedTransfers.values,
      cma: salvagedCma.values,
      lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : new Date().toISOString(),
      nurses: Array.isArray(raw.nurses) ? raw.nurses : ['', ''],
      nursesDayShift: Array.isArray(raw.nursesDayShift) ? raw.nursesDayShift : ['', ''],
      nursesNightShift: Array.isArray(raw.nursesNightShift) ? raw.nursesNightShift : ['', ''],
      nurseName: typeof raw.nurseName === 'string' ? raw.nurseName : undefined,
      tensDayShift: Array.isArray(raw.tensDayShift) ? raw.tensDayShift : ['', '', ''],
      tensNightShift: Array.isArray(raw.tensNightShift) ? raw.tensNightShift : ['', '', ''],
      activeExtraBeds: Array.isArray(raw.activeExtraBeds) ? raw.activeExtraBeds : [],
      rayenBedCollisionResolutions: Array.isArray(raw.rayenBedCollisionResolutions)
        ? raw.rayenBedCollisionResolutions.flatMap(value => {
            const parsed = RayenBedCollisionResolutionReceiptSchema.safeParse(value);
            return parsed.success ? [parsed.data] : [];
          })
        : undefined,
      handoffDayChecklist: (raw.handoffDayChecklist as DailyRecord['handoffDayChecklist']) || {},
      handoffNightChecklist:
        (raw.handoffNightChecklist as DailyRecord['handoffNightChecklist']) || {},
      handoffNovedadesDayShift:
        typeof raw.handoffNovedadesDayShift === 'string' ? raw.handoffNovedadesDayShift : '',
      handoffNovedadesNightShift:
        typeof raw.handoffNovedadesNightShift === 'string' ? raw.handoffNovedadesNightShift : '',
      medicalHandoffNovedades:
        typeof raw.medicalHandoffNovedades === 'string' ? raw.medicalHandoffNovedades : '',
      medicalHandoffBySpecialty:
        raw.medicalHandoffBySpecialty &&
        typeof raw.medicalHandoffBySpecialty === 'object' &&
        !Array.isArray(raw.medicalHandoffBySpecialty)
          ? (raw.medicalHandoffBySpecialty as DailyRecord['medicalHandoffBySpecialty'])
          : undefined,
      handoffNightReceives: Array.isArray(raw.handoffNightReceives) ? raw.handoffNightReceives : [],
      bedTypeOverrides: (raw.bedTypeOverrides as Record<string, BedType>) || {},
      schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1,
    } as DailyRecord),
    report: {
      nullNormalization,
      salvagedBeds: salvagedBedIds,
      droppedDischargeItems: salvagedDischarges.dropped,
      droppedTransferItems: salvagedTransfers.dropped,
      droppedCmaItems: salvagedCma.dropped,
    },
  };
};

export const parseDailyRecordWithDefaults = (data: unknown, docId: string): DailyRecord =>
  parseDailyRecordWithDefaultsReport(data, docId).record;
