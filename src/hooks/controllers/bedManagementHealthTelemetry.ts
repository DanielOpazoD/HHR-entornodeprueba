import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { BedAction } from '@/hooks/contracts/bedManagementActionContracts';
import type { OperationalTelemetryEvent } from '@/services/observability/operationalTelemetryTypes';
import { BEDS } from '@/constants/beds';

const PATIENT_FIELD_LABELS: Partial<Record<keyof PatientData, string>> = {
  age: 'Edad',
  admissionDate: 'Fecha de ingreso',
  bedMode: 'Tipo de cupo',
  clinicalEvents: 'Eventos clinicos',
  devices: 'Dispositivos',
  hasCompanionCrib: 'Cuna acompanante',
  handoffNoteDayShift: 'Nota entrega dia',
  handoffNoteNightShift: 'Nota entrega noche',
  isUPC: 'UPC',
  patientName: 'Nombre paciente',
  pathology: 'Diagnostico',
  rut: 'RUT',
  specialty: 'Especialidad',
  status: 'Estado',
};

interface BedPatchFieldMetadata {
  bedId?: string;
  fieldKey?: string;
  fieldLabel?: string;
  actionLabel: string;
}

const getBedLabel = (bedId: string): string => {
  const bed = BEDS.find(candidate => candidate.id === bedId);
  return bed?.name ? `Cama ${bed.name}` : `Cama ${bedId}`;
};

const getPatientFieldLabel = (field: keyof PatientData): string =>
  PATIENT_FIELD_LABELS[field] || String(field);

const getPatchFieldMetadata = (action: BedAction): BedPatchFieldMetadata => {
  switch (action.type) {
    case 'UPDATE_PATIENT':
      return {
        bedId: action.bedId,
        fieldKey: String(action.field),
        fieldLabel: getPatientFieldLabel(action.field),
        actionLabel: `Guardar ${getPatientFieldLabel(action.field).toLowerCase()}`,
      };
    case 'UPDATE_PATIENT_MULTIPLE': {
      const fields = Object.keys(action.fields);
      return {
        bedId: action.bedId,
        fieldKey: fields.join(', '),
        fieldLabel: fields
          .map(field => getPatientFieldLabel(field as keyof PatientData))
          .join(', '),
        actionLabel: 'Guardar datos de cama',
      };
    }
    case 'UPDATE_CUDYR':
      return {
        bedId: action.bedId,
        fieldKey: `cudyr.${String(action.field)}`,
        fieldLabel: `CUDYR ${String(action.field)}`,
        actionLabel: 'Guardar CUDYR',
      };
    case 'UPDATE_CUDYR_MULTIPLE': {
      const fields = Object.keys(action.fields);
      return {
        bedId: action.bedId,
        fieldKey: fields.map(field => `cudyr.${field}`).join(', '),
        fieldLabel: `${fields.length} campos CUDYR`,
        actionLabel: 'Guardar CUDYR',
      };
    }
    case 'UPDATE_CUDYR_BATCH':
      return {
        fieldKey: 'cudyr.batch',
        fieldLabel: 'CUDYR en lote',
        actionLabel: 'Guardar CUDYR',
      };
    case 'UPDATE_CLINICAL_CRIB':
      return {
        bedId: action.bedId,
        fieldKey: `clinicalCrib.${String(action.field)}`,
        fieldLabel: `Cuna clinica ${getPatientFieldLabel(action.field)}`,
        actionLabel: `Guardar cuna clinica ${getPatientFieldLabel(action.field).toLowerCase()}`,
      };
    case 'UPDATE_CLINICAL_CRIB_MULTIPLE': {
      const fields = Object.keys(action.fields);
      return {
        bedId: action.bedId,
        fieldKey: fields.map(field => `clinicalCrib.${field}`).join(', '),
        fieldLabel: fields
          .map(field => `Cuna clinica ${getPatientFieldLabel(field as keyof PatientData)}`)
          .join(', '),
        actionLabel: 'Guardar datos de cuna clinica',
      };
    }
    case 'UPDATE_CLINICAL_CRIB_CUDYR':
      return {
        bedId: action.bedId,
        fieldKey: `clinicalCrib.cudyr.${String(action.field)}`,
        fieldLabel: `Cuna clinica CUDYR ${String(action.field)}`,
        actionLabel: 'Guardar CUDYR de cuna clinica',
      };
    case 'UPDATE_CLINICAL_CRIB_CUDYR_MULTIPLE': {
      const fields = Object.keys(action.fields);
      return {
        bedId: action.bedId,
        fieldKey: fields.map(field => `clinicalCrib.cudyr.${field}`).join(', '),
        fieldLabel: `${fields.length} campos CUDYR de cuna clinica`,
        actionLabel: 'Guardar CUDYR de cuna clinica',
      };
    }
    case 'CLEAR_PATIENT':
      return {
        bedId: action.bedId,
        fieldKey: 'bed',
        fieldLabel: 'Cama completa',
        actionLabel: 'Limpiar cama',
      };
    case 'CREATE_CLINICAL_CRIB':
      return {
        bedId: action.bedId,
        fieldKey: 'clinicalCrib',
        fieldLabel: 'Cuna clinica',
        actionLabel: 'Crear cuna clinica',
      };
    case 'REMOVE_CLINICAL_CRIB':
      return {
        bedId: action.bedId,
        fieldKey: 'clinicalCrib',
        fieldLabel: 'Cuna clinica',
        actionLabel: 'Eliminar cuna clinica',
      };
    case 'TOGGLE_BLOCK_BED':
      return {
        bedId: action.bedId,
        fieldKey: 'isBlocked',
        fieldLabel: 'Bloqueo de cama',
        actionLabel: 'Cambiar bloqueo de cama',
      };
    case 'UPDATE_BLOCKED_REASON':
      return {
        bedId: action.bedId,
        fieldKey: 'blockedReason',
        fieldLabel: 'Motivo de bloqueo',
        actionLabel: 'Guardar motivo de bloqueo',
      };
    case 'TOGGLE_BED_TYPE':
      return {
        bedId: action.bedId,
        fieldKey: 'bedTypeOverrides',
        fieldLabel: 'Nivel de cuidado',
        actionLabel: 'Cambiar UTI/UCI',
      };
    case 'MOVE_PATIENT':
      return {
        bedId: action.targetBedId,
        fieldKey: 'bed',
        fieldLabel: `Movimiento desde ${action.sourceBedId}`,
        actionLabel: 'Mover paciente',
      };
    case 'COPY_PATIENT':
      return {
        bedId: action.targetBedId,
        fieldKey: 'bed',
        fieldLabel: `Copia desde ${action.sourceBedId}`,
        actionLabel: 'Copiar paciente',
      };
    case 'CLEAR_ALL_BEDS':
      return {
        fieldKey: 'allBeds',
        fieldLabel: 'Todas las camas',
        actionLabel: 'Limpiar todas las camas',
      };
    case 'TOGGLE_EXTRA_BED':
      return {
        bedId: action.bedId,
        fieldKey: 'activeExtraBeds',
        fieldLabel: 'Cama extra',
        actionLabel: 'Cambiar cama extra',
      };
  }
};

const formatTelemetryIssue = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const buildBedPatchFailureTelemetryEvent = (
  record: DailyRecord,
  action: BedAction,
  error: unknown
): Omit<OperationalTelemetryEvent, 'timestamp'> => {
  const metadata = getPatchFieldMetadata(action);
  return {
    category: 'daily_record',
    operation: 'daily_record_bed_patch_failed',
    status: 'failed',
    runtimeState: 'blocked',
    date: record.date,
    issues: [formatTelemetryIssue(error)],
    context: {
      module: 'Censo diario',
      section: 'Censo diario',
      action: metadata.actionLabel,
      route: '/censo',
      clinicalDate: record.date,
      bedId: metadata.bedId,
      bedLabel: metadata.bedId ? getBedLabel(metadata.bedId) : undefined,
      fieldKey: metadata.fieldKey,
      fieldLabel: metadata.fieldLabel,
      patchType: action.type,
    },
  };
};
