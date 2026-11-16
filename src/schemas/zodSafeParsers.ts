import type { BedType } from '@/types/domain/beds';
import type { CMAData, DischargeData, TransferData } from '@/types/domain/movements';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { applyDailyRecordStaffingCompatibility } from '@/services/staff/dailyRecordStaffing';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { ZodSafeParseResult } from 'zod';

import { normalizeLegacyNullsDeep } from './zod/legacyNormalization';
import {
  DailyRecordFieldsSchema,
  DailyRecordSchema,
  RayenBedCollisionResolutionReceiptSchema,
  RayenSyncEventSchema,
} from './zod/dailyRecord';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import { PatientDataSchema } from './zod/patient';
import { CMADataSchema, DischargeDataSchema, TransferDataSchema } from './zod/movements';
import { buildFallbackPatientDataReport } from './zodFallbackBuilders';
import { carriesClinicalDerivedLayout } from '@/services/storage/clinicalDerivedWriteHygiene';
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
      .map(issue => `${issue.path.map(String).join('.')}: ${issue.message}`),
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
        droppedListItems: 0,
      },
    };
  }

  const fallback = buildFallbackPatientDataReport(normalized, bedId);
  return {
    patient: fallback.patient,
    report: {
      nullNormalization,
      usedFallback: true,
      droppedListItems: fallback.droppedListItems,
    },
  };
};

export const parsePatientDataWithDefaults = (data: unknown, bedId: string): PatientData =>
  parsePatientDataWithDefaultsReport(data, bedId).patient;

const dailyRecordFieldSchemas = new Map(Object.entries(DailyRecordFieldsSchema.shape));

// Every top-level value that passes its own schema survives the salvage, and fields this client
// does not know stay as stored, as the strict schema passes them through. Only the invalid value
// goes: a signed or CUDYR-locked day keeps its signature and lock (CUD-01), and a split day keeps
// its layout and `meta` revision, so strict readers never see it as ahead of itself.
const keepValidTopLevelFields = (
  raw: Record<string, unknown>
): { kept: Record<string, unknown>; rejected: [string, unknown][] } => {
  const rejected: [string, unknown][] = [];
  const kept = Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) => {
      const fieldSchema = dailyRecordFieldSchemas.get(key);
      if (!fieldSchema) return [[key, value]];
      const parsed = fieldSchema.safeParse(value);
      if (parsed.success) return [[key, parsed.data]];
      rejected.push([key, value]);
      return [];
    })
  );
  return { kept, rejected };
};

// The bed map and the movement lists are salvaged item by item, and the report counts their
// lost items; only a value that is not such a container at all is lost whole.
const isSalvagedItemByItem = (key: string, value: unknown): boolean =>
  key === 'beds'
    ? Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    : ['discharges', 'transfers', 'cma', 'rayenSyncHistory'].includes(key) && Array.isArray(value);

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
          droppedPatientListItems: 0,
          droppedDischargeItems: 0,
          droppedTransferItems: 0,
          droppedCmaItems: 0,
          droppedRayenSyncEvents: 0,
          discardedTopLevelFields: [],
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
  let droppedPatientListItems = 0;
  const keepClinicalEpisodeId = carriesClinicalDerivedLayout(raw);

  if (raw.beds && typeof raw.beds === 'object' && !Array.isArray(raw.beds)) {
    Object.entries(raw.beds as Record<string, unknown>).forEach(([id, patient]) => {
      const parsed = PatientDataSchema.safeParse(patient);
      if (parsed.success) {
        salvagedBeds[id] = parsed.data;
        return;
      }

      const fallback = buildFallbackPatientDataReport(patient, id, { keepClinicalEpisodeId });
      salvagedBeds[id] = fallback.patient;
      droppedPatientListItems += fallback.droppedListItems;
      salvagedBedIds.push(id);
    });
  }

  const salvageArrayItems = <T>(
    items: unknown,
    schema: { safeParse: (value: unknown) => ZodSafeParseResult<T> }
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
  // El historial de sincronización se salvaba a cero: cualquier reparación
  // estructural del registro (una cama rota, un enum desconocido) lo perdía
  // entero y la siguiente corrida lo reescribía con un solo evento.
  const salvagedRayenSyncHistory = salvageArrayItems<RayenSyncEvent>(
    raw.rayenSyncHistory,
    RayenSyncEventSchema
  );

  const topLevel = keepValidTopLevelFields(raw);
  const fields = {
    ...topLevel.kept,
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
    ...(Array.isArray(raw.rayenSyncHistory)
      ? { rayenSyncHistory: salvagedRayenSyncHistory.values }
      : {}),
  };

  const rebuilt = new Map<string, unknown>(Object.entries(fields));

  return {
    record: applyDailyRecordStaffingCompatibility(fields as DailyRecord),
    report: {
      nullNormalization,
      salvagedBeds: salvagedBedIds,
      droppedPatientListItems,
      droppedDischargeItems: salvagedDischarges.dropped,
      droppedTransferItems: salvagedTransfers.dropped,
      droppedCmaItems: salvagedCma.dropped,
      droppedRayenSyncEvents: salvagedRayenSyncHistory.dropped,
      // A rejected value the rebuild above takes back as stored was not discarded.
      discardedTopLevelFields: topLevel.rejected
        .filter(([key, value]) => rebuilt.get(key) !== value && !isSalvagedItemByItem(key, value))
        .map(([key]) => key),
    },
  };
};

export const parseDailyRecordWithDefaults = (data: unknown, docId: string): DailyRecord =>
  parseDailyRecordWithDefaultsReport(data, docId).record;
