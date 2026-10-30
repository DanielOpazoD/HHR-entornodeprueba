import type {
  DailyRecord,
  DailyRecordPatch,
  MedicalHandoffActor,
  MedicalSpecialty,
} from '@/domain/handoff/recordContracts';
import { buildMedicalHandoffSummary, DEFAULT_NO_CHANGES_COMMENT } from '@/domain/handoff/specialty';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';

export const normalizeMedicalHandoffActor = (
  actor: Partial<MedicalHandoffActor>,
  specialty?: MedicalSpecialty
): MedicalHandoffActor => ({
  uid: actor.uid || 'unknown-user',
  displayName: actor.displayName || actor.email || 'Usuario sin nombre',
  email: actor.email || 'unknown@hospitalhangaroa.cl',
  role: actor.role,
  specialty: specialty || actor.specialty,
});

export const buildChecklistUpdateRecord = (
  record: DailyRecord,
  shift: 'day' | 'night' | 'shared',
  field: string,
  value: boolean | string
): DailyRecord => {
  const updatedRecord = { ...record };
  if (shift === 'shared') {
    updatedRecord.handoffSharedChecklist = {
      ...record.handoffSharedChecklist,
      [field]: value,
    };
  } else if (shift === 'day') {
    updatedRecord.handoffDayChecklist = {
      ...updatedRecord.handoffDayChecklist,
      [field]: value as boolean,
    } as DailyRecord['handoffDayChecklist'];
  } else {
    updatedRecord.handoffNightChecklist = {
      ...updatedRecord.handoffNightChecklist,
      [field]: value,
    } as DailyRecord['handoffNightChecklist'];
  }
  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

export const buildNovedadesUpdateRecord = (
  record: DailyRecord,
  shift: 'day' | 'night' | 'medical',
  value: string
): DailyRecord => {
  const updatedRecord = { ...record };
  if (shift === 'day') updatedRecord.handoffNovedadesDayShift = value;
  if (shift === 'night') updatedRecord.handoffNovedadesNightShift = value;
  if (shift === 'medical') updatedRecord.medicalHandoffNovedades = value;
  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

export const buildUpdatedHandoffStaffRecord = (
  currentRecord: DailyRecord,
  shift: 'day' | 'night',
  type: 'delivers' | 'receives' | 'tens',
  staffList: string[]
): DailyRecord => {
  const updatedRecord = { ...currentRecord };

  if (shift === 'day') {
    if (type === 'delivers') {
      updatedRecord.nursesDayShift = staffList;
    } else if (type === 'receives') {
      updatedRecord.nursesNightShift = staffList;
    } else {
      updatedRecord.tensDayShift = staffList;
    }
  } else if (type === 'delivers') {
    updatedRecord.nursesNightShift = staffList;
  } else if (type === 'receives') {
    updatedRecord.handoffNightReceives = staffList;
  } else {
    updatedRecord.tensNightShift = staffList;
  }

  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

export const buildMedicalSpecialtyNoteRecord = (
  record: DailyRecord,
  specialty: MedicalSpecialty,
  value: string,
  actor: Partial<MedicalHandoffActor>
): DailyRecord => {
  const now = new Date().toISOString();
  const normalizedActor = normalizeMedicalHandoffActor(actor, specialty);
  const currentNote = record.medicalHandoffBySpecialty?.[specialty];
  const updatedRecord: DailyRecord = {
    ...record,
    medicalHandoffBySpecialty: {
      ...(record.medicalHandoffBySpecialty || {}),
      [specialty]: {
        note: value,
        createdAt: currentNote?.createdAt || now,
        updatedAt: now,
        author: currentNote?.author || normalizedActor,
        lastEditor: normalizedActor,
        version: (currentNote?.version || 0) + 1,
        dailyContinuity: {
          ...(currentNote?.dailyContinuity || {}),
          [record.date]: { status: 'updated_by_specialist' },
        },
      },
    },
    lastUpdated: now,
  };
  updatedRecord.medicalHandoffNovedades = buildMedicalHandoffSummary(updatedRecord);
  return updatedRecord;
};

export const buildMedicalNoChangesRecord = (
  record: DailyRecord,
  specialty: MedicalSpecialty,
  actor: Partial<MedicalHandoffActor>,
  comment?: string,
  dateKey?: string
): DailyRecord => {
  const currentNote = record.medicalHandoffBySpecialty?.[specialty];
  if (!currentNote) return record;
  const effectiveDateKey = dateKey || record.date;
  const now = new Date().toISOString();
  const normalizedActor = normalizeMedicalHandoffActor(actor, specialty);
  const nextComment = comment?.trim() || DEFAULT_NO_CHANGES_COMMENT;
  const updatedRecord: DailyRecord = {
    ...record,
    medicalHandoffBySpecialty: {
      ...(record.medicalHandoffBySpecialty || {}),
      [specialty]: {
        ...currentNote,
        dailyContinuity: {
          ...(currentNote.dailyContinuity || {}),
          [effectiveDateKey]: {
            status: 'confirmed_no_changes',
            confirmedAt: now,
            confirmedBy: normalizedActor,
            comment: nextComment,
          },
        },
      },
    },
    lastUpdated: now,
  };
  updatedRecord.medicalHandoffNovedades = buildMedicalHandoffSummary(updatedRecord);
  return updatedRecord;
};

export const buildMedicalSignatureRecord = (
  record: DailyRecord,
  doctorName: string,
  scope: MedicalHandoffScope
): DailyRecord => {
  const signedAt = new Date().toISOString();
  const signature = { doctorName, signedAt };
  const updatedRecord = { ...record };
  updatedRecord.medicalSignatureByScope = {
    ...(updatedRecord.medicalSignatureByScope || {}),
    [scope]: signature,
  };
  if (scope === 'all') updatedRecord.medicalSignature = signature;
  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

export const buildMedicalSentPatch = (
  record: DailyRecord,
  doctorName?: string,
  scope: MedicalHandoffScope = 'all'
): DailyRecordPatch => {
  const sentAt = new Date().toISOString();
  const updates: Partial<DailyRecord> = {
    medicalHandoffSentAtByScope: {
      ...(record.medicalHandoffSentAtByScope || {}),
      [scope]: sentAt,
    },
  };
  if (scope === 'all') updates.medicalHandoffSentAt = sentAt;
  if (doctorName) updates.medicalHandoffDoctor = doctorName;
  return updates;
};

export const buildResetMedicalHandoffRecord = (record: DailyRecord): DailyRecord => {
  const updatedRecord = { ...record };
  updatedRecord.medicalHandoffSentAt = undefined;
  updatedRecord.medicalSignature = undefined;
  updatedRecord.medicalHandoffSentAtByScope = {};
  updatedRecord.medicalSignatureByScope = {};
  updatedRecord.lastUpdated = new Date().toISOString();
  return updatedRecord;
};

// ---------------------------------------------------------------------------
// Patch builders — return only the changed fields for concurrent-safe writes.
// Each function mirrors its full-record counterpart above but produces a
// DailyRecordPatch suitable for Firestore updateDoc() field-level writes.
// ---------------------------------------------------------------------------

export const buildChecklistPatch = (
  shift: 'day' | 'night' | 'shared',
  field: string,
  value: boolean | string
): DailyRecordPatch => {
  const key =
    shift === 'shared'
      ? 'handoffSharedChecklist'
      : shift === 'day'
        ? 'handoffDayChecklist'
        : 'handoffNightChecklist';
  return { [`${key}.${field}`]: value } as DailyRecordPatch;
};

export const buildNovedadesPatch = (
  shift: 'day' | 'night' | 'medical',
  value: string
): DailyRecordPatch => {
  if (shift === 'day') return { handoffNovedadesDayShift: value };
  if (shift === 'night') return { handoffNovedadesNightShift: value };
  return { medicalHandoffNovedades: value };
};

export const buildHandoffStaffPatch = (
  shift: 'day' | 'night',
  type: 'delivers' | 'receives' | 'tens',
  staffList: string[]
): DailyRecordPatch => {
  if (shift === 'day') {
    if (type === 'delivers') return { nursesDayShift: staffList };
    if (type === 'receives') return { nursesNightShift: staffList };
    return { tensDayShift: staffList };
  }
  if (type === 'delivers') return { nursesNightShift: staffList };
  if (type === 'receives') return { handoffNightReceives: staffList };
  return { tensNightShift: staffList };
};

export const buildMedicalSpecialtyNotePatch = (
  record: DailyRecord,
  specialty: MedicalSpecialty,
  value: string,
  actor: Partial<MedicalHandoffActor>
): DailyRecordPatch => {
  const now = new Date().toISOString();
  const normalizedActor = normalizeMedicalHandoffActor(actor, specialty);
  const currentNote = record.medicalHandoffBySpecialty?.[specialty];
  const updatedSpecialtyEntry = {
    note: value,
    createdAt: currentNote?.createdAt || now,
    updatedAt: now,
    author: currentNote?.author || normalizedActor,
    lastEditor: normalizedActor,
    version: (currentNote?.version || 0) + 1,
    dailyContinuity: {
      ...(currentNote?.dailyContinuity || {}),
      [record.date]: { status: 'updated_by_specialist' as const },
    },
  };
  // Compute summary from a projected record to keep it consistent
  const projectedRecord: DailyRecord = {
    ...record,
    medicalHandoffBySpecialty: {
      ...(record.medicalHandoffBySpecialty || {}),
      [specialty]: updatedSpecialtyEntry,
    },
  };
  return {
    [`medicalHandoffBySpecialty.${specialty}`]: updatedSpecialtyEntry,
    medicalHandoffNovedades: buildMedicalHandoffSummary(projectedRecord),
  } as DailyRecordPatch;
};

export const buildMedicalNoChangesPatch = (
  record: DailyRecord,
  specialty: MedicalSpecialty,
  actor: Partial<MedicalHandoffActor>,
  comment?: string,
  dateKey?: string
): DailyRecordPatch | null => {
  const currentNote = record.medicalHandoffBySpecialty?.[specialty];
  if (!currentNote) return null;
  const effectiveDateKey = dateKey || record.date;
  const now = new Date().toISOString();
  const normalizedActor = normalizeMedicalHandoffActor(actor, specialty);
  const nextComment = comment?.trim() || DEFAULT_NO_CHANGES_COMMENT;
  const updatedEntry = {
    ...currentNote,
    dailyContinuity: {
      ...(currentNote.dailyContinuity || {}),
      [effectiveDateKey]: {
        status: 'confirmed_no_changes' as const,
        confirmedAt: now,
        confirmedBy: normalizedActor,
        comment: nextComment,
      },
    },
  };
  const projectedRecord: DailyRecord = {
    ...record,
    medicalHandoffBySpecialty: {
      ...(record.medicalHandoffBySpecialty || {}),
      [specialty]: updatedEntry,
    },
  };
  return {
    [`medicalHandoffBySpecialty.${specialty}`]: updatedEntry,
    medicalHandoffNovedades: buildMedicalHandoffSummary(projectedRecord),
  } as DailyRecordPatch;
};

export const buildMedicalSignaturePatch = (
  record: DailyRecord,
  doctorName: string,
  scope: MedicalHandoffScope
): DailyRecordPatch => {
  const signedAt = new Date().toISOString();
  const signature = { doctorName, signedAt };
  const patch = {
    [`medicalSignatureByScope.${scope}`]: signature,
  } as DailyRecordPatch;
  if (scope === 'all') (patch as Record<string, unknown>).medicalSignature = signature;
  return patch;
};

export const buildMedicalHandoffDoctorPatch = (doctorName: string): DailyRecordPatch => ({
  medicalHandoffDoctor: doctorName,
});

export const buildResetMedicalHandoffPatch = (): DailyRecordPatch => ({
  medicalHandoffSentAt: '',
  medicalSignature: undefined,
  medicalHandoffSentAtByScope: {},
  medicalSignatureByScope: {},
});
