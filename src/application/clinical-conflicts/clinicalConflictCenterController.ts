import type {
  ConflictSnapshotRecoveryEvidence,
  ConflictVersionSnapshot,
} from '@/application/ports/dailyRecordConflictRecoveryPort';
import { resolveConflictSnapshotRecoveryState } from '@/application/clinical-conflicts/conflictSnapshotRecoveryPresentation';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import {
  CLINICAL_CONFLICT_MODULE_DESCRIPTORS,
  CLINICAL_CONFLICT_MODULE_ORDER,
  classifyClinicalConflictPath,
  type ClinicalConflictModuleDescriptor,
  type ClinicalConflictModuleKey,
} from '@/application/clinical-conflicts/clinicalConflictPathClassifier';
import type { PatientData } from '@/shared/contracts/patientDomainContracts';
import type { DischargeData, TransferData, CMAData } from '@/types/domain/movements';

export {
  classifyClinicalConflictPath,
  type ClinicalConflictModuleDescriptor,
  type ClinicalConflictModuleKey,
  type ClinicalConflictPathClassification,
} from '@/application/clinical-conflicts/clinicalConflictPathClassifier';

export interface ClinicalConflictFieldChange {
  path: string;
  module: ClinicalConflictModuleKey;
  label: string;
  before: string;
  after: string;
  bedId?: string;
}

export interface ClinicalConflictPatientContext {
  patientName: string;
  rut?: string;
  bedName?: string;
  bedId?: string;
}

export interface ClinicalConflictSnapshotOption {
  id: string;
  origin: ConflictVersionSnapshot['origin'];
  label: string;
  sourceLastUpdated?: string;
  summary: string;
  patientCount: number;
  movementCount: number;
}

export type ClinicalConflictReviewStatus = 'reviewable' | 'auto_merged_reviewable';

export interface ClinicalConflictReviewPackage {
  id: string;
  status: ClinicalConflictReviewStatus;
  title: string;
  subtitle: string;
  modules: ClinicalConflictModuleDescriptor[];
  patientContexts: ClinicalConflictPatientContext[];
  changes: ClinicalConflictFieldChange[];
  totalChangeCount: number;
  options: ClinicalConflictSnapshotOption[];
}

export interface ClinicalConflictCenterModel {
  date?: string;
  hasReviewableConflicts: boolean;
  conflicts: ClinicalConflictReviewPackage[];
  emptyState: ReturnType<typeof resolveConflictSnapshotRecoveryState>;
}

const ORIGIN_LABELS: Record<ConflictVersionSnapshot['origin'], string> = {
  remote_premerge: 'Versión en la nube',
  incoming_premerge: 'Versión local',
};

const IGNORED_DIFF_PATHS = new Set(['date', 'lastUpdated', 'dateTimestamp', 'schemaVersion']);

const isPrimitive = (value: unknown): boolean =>
  value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && Object.prototype.toString.call(value) === '[object Object]';

const stableStringify = (value: unknown): string => {
  if (isPrimitive(value)) return String(value ?? '');
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isPlainObject(value)) return String(value);
  return `{${Object.keys(value)
    .sort()
    .map(key => `${key}:${stableStringify(value[key])}`)
    .join(',')}}`;
};

const formatValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return 'Sin dato';
  if (typeof value === 'string') return value.length > 160 ? `${value.slice(0, 157)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value))
    return value.length === 0 ? 'Sin registros' : `${value.length} registro(s)`;
  return stableStringify(value).slice(0, 160);
};

const flattenRecord = (
  value: unknown,
  prefix: string,
  output: Map<string, unknown>,
  depth = 0
): void => {
  if (!prefix && isPlainObject(value)) {
    Object.keys(value)
      .sort()
      .forEach(key => flattenRecord(value[key], key, output, depth + 1));
    return;
  }

  if (IGNORED_DIFF_PATHS.has(prefix)) return;

  if (depth > 7 || isPrimitive(value)) {
    output.set(prefix, value);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      output.set(prefix, []);
      return;
    }
    value.forEach((item, index) => flattenRecord(item, `${prefix}.${index}`, output, depth + 1));
    return;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      output.set(prefix, {});
      return;
    }
    keys.forEach(key => flattenRecord(value[key], `${prefix}.${key}`, output, depth + 1));
    return;
  }

  output.set(prefix, value);
};

const compareRecords = (
  beforeRecord: DailyRecord,
  afterRecord: DailyRecord
): ClinicalConflictFieldChange[] => {
  const before = new Map<string, unknown>();
  const after = new Map<string, unknown>();
  flattenRecord(beforeRecord, '', before);
  flattenRecord(afterRecord, '', after);

  const paths = Array.from(new Set([...before.keys(), ...after.keys()])).sort();
  return paths
    .filter(path => stableStringify(before.get(path)) !== stableStringify(after.get(path)))
    .map(path => {
      const classification = classifyClinicalConflictPath(path);
      return {
        path,
        module: classification.module,
        label: classification.label,
        before: formatValue(before.get(path)),
        after: formatValue(after.get(path)),
        bedId: classification.bedId,
      };
    });
};

const hasPatientName = (patient?: Partial<PatientData> | null): patient is PatientData =>
  Boolean(patient?.patientName?.trim());

const collectMovementContexts = (
  movements: Array<Partial<DischargeData | TransferData | CMAData>>
): ClinicalConflictPatientContext[] =>
  movements
    .filter(movement => Boolean(movement.patientName?.trim()))
    .map(movement => ({
      patientName: movement.patientName || 'Paciente no identificado',
      rut: movement.rut || undefined,
      bedName: movement.bedName || undefined,
      bedId: 'bedId' in movement ? movement.bedId : undefined,
    }));

const collectPatientContextsFromRecord = (
  record: DailyRecord
): ClinicalConflictPatientContext[] => [
  ...Object.entries(record.beds || {})
    .filter(([, patient]) => hasPatientName(patient))
    .map(([bedId, patient]) => ({
      patientName: patient.patientName,
      rut: patient.rut || undefined,
      bedName: patient.bedName || bedId,
      bedId,
    })),
  ...collectMovementContexts(record.discharges || []),
  ...collectMovementContexts(record.transfers || []),
  ...collectMovementContexts(record.cma || []),
];

const dedupePatientContexts = (
  contexts: ClinicalConflictPatientContext[]
): ClinicalConflictPatientContext[] => {
  const seen = new Set<string>();
  return contexts.filter(context => {
    const key = [context.rut, context.bedId, context.bedName, context.patientName].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildSnapshotSummary = (
  record: DailyRecord
): Pick<ClinicalConflictSnapshotOption, 'patientCount' | 'movementCount' | 'summary'> => {
  const patientCount = Object.values(record.beds || {}).filter(patient =>
    patient?.patientName?.trim()
  ).length;
  const movementCount =
    (record.discharges?.length || 0) + (record.transfers?.length || 0) + (record.cma?.length || 0);
  return {
    patientCount,
    movementCount,
    summary: `${patientCount} paciente(s) activo(s) · ${movementCount} movimiento(s)`,
  };
};

const buildSnapshotOption = (snapshot: ConflictVersionSnapshot): ClinicalConflictSnapshotOption => {
  const summary = buildSnapshotSummary(snapshot.record);
  return {
    id: snapshot.id,
    origin: snapshot.origin,
    label: ORIGIN_LABELS[snapshot.origin] ?? snapshot.origin,
    sourceLastUpdated: snapshot.sourceLastUpdated,
    ...summary,
  };
};

const resolveConflictId = (snapshot: ConflictVersionSnapshot): string =>
  snapshot.conflictId || snapshot.id.split('__')[0] || snapshot.id;

const isAutoMergedReviewable = (
  snapshots: ConflictVersionSnapshot[],
  snapshotRecovery?: ConflictSnapshotRecoveryEvidence | null
): boolean => {
  const recoveryIds = new Set(snapshotRecovery?.snapshotIds || []);
  return (
    snapshotRecovery?.status === 'saved' && snapshots.some(snapshot => recoveryIds.has(snapshot.id))
  );
};

const buildModules = (
  changes: ClinicalConflictFieldChange[]
): ClinicalConflictModuleDescriptor[] => {
  const keys = new Set<ClinicalConflictModuleKey>(changes.map(change => change.module));
  if (keys.size === 0) keys.add('system');
  return CLINICAL_CONFLICT_MODULE_ORDER.filter(key => keys.has(key)).map(
    key => CLINICAL_CONFLICT_MODULE_DESCRIPTORS[key]
  );
};

const buildConflictPackage = (
  conflictId: string,
  snapshots: ConflictVersionSnapshot[],
  snapshotRecovery?: ConflictSnapshotRecoveryEvidence | null
): ClinicalConflictReviewPackage => {
  const remote = snapshots.find(snapshot => snapshot.origin === 'remote_premerge');
  const incoming = snapshots.find(snapshot => snapshot.origin === 'incoming_premerge');
  const changes = remote && incoming ? compareRecords(remote.record, incoming.record) : [];
  const status: ClinicalConflictReviewStatus = isAutoMergedReviewable(snapshots, snapshotRecovery)
    ? 'auto_merged_reviewable'
    : 'reviewable';
  const patientContexts = dedupePatientContexts(
    snapshots.flatMap(snapshot => collectPatientContextsFromRecord(snapshot.record))
  );

  return {
    id: conflictId,
    status,
    title:
      status === 'auto_merged_reviewable' ? 'Auto-merge revisable' : 'Conflicto clínico revisable',
    subtitle:
      changes.length > 0
        ? `${changes.length} diferencia(s) detectada(s) antes de resolver`
        : 'Versiones recuperables disponibles para revisión',
    modules: buildModules(changes),
    patientContexts,
    changes,
    totalChangeCount: changes.length,
    options: snapshots.map(buildSnapshotOption),
  };
};

export const buildClinicalConflictCenterModel = ({
  date,
  snapshots,
  snapshotRecovery,
  now,
}: {
  date?: string;
  snapshots: ConflictVersionSnapshot[];
  snapshotRecovery?: ConflictSnapshotRecoveryEvidence | null;
  now?: Date;
}): ClinicalConflictCenterModel => {
  const groups = snapshots.reduce((acc, snapshot) => {
    const conflictId = resolveConflictId(snapshot);
    const group = acc.get(conflictId) || [];
    group.push(snapshot);
    acc.set(conflictId, group);
    return acc;
  }, new Map<string, ConflictVersionSnapshot[]>());

  const conflicts = Array.from(groups.entries())
    .map(([conflictId, groupSnapshots]) =>
      buildConflictPackage(conflictId, groupSnapshots, snapshotRecovery)
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    date,
    hasReviewableConflicts: conflicts.length > 0,
    conflicts,
    emptyState: resolveConflictSnapshotRecoveryState({
      date,
      snapshotCount: snapshots.length,
      snapshotRecovery,
      now,
    }),
  };
};
