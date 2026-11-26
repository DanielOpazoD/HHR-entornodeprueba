import type { PatientData } from '@/types/domain/patient';

import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

import { BedType } from '@/types/domain/beds';
import { PatientFieldValue } from '@/types/valueTypes';
import { createEmptyPatient } from '@/domain/patient/patientFactory';
import { BEDS } from '@/constants/beds';
import { getBedTypeForRecord } from '@/utils/bedTypeUtils';
import { deepClone } from '@/utils/deepClone';
import {
  clearDeliveryRouteFields,
  isObstetricGinecobstetricia,
} from '@/shared/census/ginecobstetriciaClassification';
import {
  isUciEligibleBedId,
  normalizePatientUpcForBed,
  resolveNormalizedUpcFlag,
  resolveUpcClassificationFromChecklist,
} from '@/shared/census/upcBedPolicy';
import { shouldAnchorFirstSeenDate } from '@/hooks/controllers/bedManagementPatientIdentityPatchController';
import { buildClinicalCribDraft } from '@/hooks/controllers/clinicalCribController';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';
import { editsPatientDocumentIdentity } from '@/utils/patientDocumentIdentity';
import { editsEloisaNameParts } from '@/utils/patientNamePartsSource';
import { buildDiagnosisManualOverrideBase } from '@/shared/census/diagnosisManualOverridePolicy';

/**
 * Un gesto = un parche MÍNIMO: los guardados del censo reenvían el paciente
 * completo, y cada campo presente-pero-idéntico engordaba la escritura,
 * disparaba side-effects «por presencia» y forzaba splits clínico/estructural
 * innecesarios. Este filtro deja solo lo que realmente cambia respecto del
 * registro vigente (campos de la cama y bedTypeOverrides; las demás rutas
 * pasan intactas), preservando el contrato de acompañamiento del servidor: si
 * `bedTypeOverrides.X` sobrevive, viaja con un parche UPC de la misma cama.
 */
export const filterUnchangedBedFieldPatches = (
  state: DailyRecord,
  bedId: string,
  patches: Record<string, unknown>
): Record<string, unknown> => {
  const fieldPrefix = `beds.${bedId}.`;
  const overridePath = `bedTypeOverrides.${bedId}`;
  const currentPatient = state.beds[bedId];
  const currentFields = new Map<string, unknown>(Object.entries(currentPatient ?? {}));
  const filtered: Record<string, unknown> = {};

  Object.entries(patches).forEach(([path, value]) => {
    if (path === overridePath) {
      if (!arePatchValuesDeepEqual(value, state.bedTypeOverrides?.[bedId])) {
        filtered[path] = value;
      }
      return;
    }
    const field = path.startsWith(fieldPrefix) ? path.slice(fieldPrefix.length) : null;
    if (!field || field.includes('.') || !currentPatient) {
      filtered[path] = value;
      return;
    }
    if (!arePatchValuesDeepEqual(value, currentFields.get(field))) {
      filtered[path] = value;
    }
  });

  if (
    overridePath in filtered &&
    !(`${fieldPrefix}isUPC` in filtered) &&
    !(`${fieldPrefix}upcChecklist` in filtered)
  ) {
    filtered[`${fieldPrefix}isUPC`] = resolveNormalizedUpcFlag(
      bedId,
      Boolean(currentPatient?.isUPC)
    );
  }

  return filtered;
};

const markManualDiagnosis = (
  patches: Record<string, unknown>,
  prefix: string,
  field: string,
  currentPatient?: PatientData
): void => {
  if (['pathology', 'cie10Code', 'cie10Description'].includes(field)) {
    patches[`${prefix}.diagnosisManualOverride`] = true;
    if (currentPatient?.diagnosisManualOverride !== true) {
      patches[`${prefix}.diagnosisManualOverrideBase`] =
        buildDiagnosisManualOverrideBase(currentPatient);
    } else if (currentPatient.diagnosisManualOverrideBase) {
      patches[`${prefix}.diagnosisManualOverrideBase`] = currentPatient.diagnosisManualOverrideBase;
    }
  }
};

const buildPatientFieldPatches = ({
  bedId,
  currentPatient,
  updates,
  recordDate,
}: {
  bedId: string;
  currentPatient: PatientData;
  updates: Partial<PatientData>;
  recordDate: string;
}): Record<string, unknown> => {
  const patches: Record<string, unknown> = {};
  const manualDiagnosisPatches: Record<string, unknown> = {};
  const manualDocumentPatches: Record<string, unknown> = {};
  const updatesGinecobstetriciaType = Object.prototype.hasOwnProperty.call(
    updates,
    'ginecobstetriciaType'
  );
  const updatesDeliveryRoute = Object.prototype.hasOwnProperty.call(updates, 'deliveryRoute');
  const updatesUpcChecklist = Object.prototype.hasOwnProperty.call(updates, 'upcChecklist');

  Object.entries(updates).forEach(([key, value]) => {
    patches[`beds.${bedId}.${key}`] =
      key === 'isUPC' ? resolveNormalizedUpcFlag(bedId, Boolean(value)) : value;

    if (value !== currentPatient[key as keyof PatientData]) {
      markManualDiagnosis(manualDiagnosisPatches, `beds.${bedId}`, key, currentPatient);
    }
  });

  if (editsPatientDocumentIdentity(currentPatient, updates)) {
    manualDocumentPatches[`beds.${bedId}.documentManualOverride`] = true;
  }

  Object.assign(patches, manualDiagnosisPatches, manualDocumentPatches);
  if (editsEloisaNameParts(currentPatient, updates)) {
    patches[`beds.${bedId}.namePartsSource`] = undefined;
  }

  if (
    currentPatient.clinicalEpisodeId &&
    updates.clinicalEpisodeId &&
    currentPatient.clinicalEpisodeId !== updates.clinicalEpisodeId
  ) {
    patches[`beds.${bedId}.diagnosisManualOverride`] = undefined;
    patches[`beds.${bedId}.diagnosisManualOverrideBase`] = undefined;
    patches[`beds.${bedId}.documentManualOverride`] = undefined;
  }

  // Corregir identidad (nombre, RUT o tipo de documento) en una cama ocupada
  // nunca borra el diagnóstico ni suelta el clinicalEpisodeId: un reemplazo de
  // paciente pasa siempre por egreso/traslado/limpieza explícita de la cama.
  const nextPatientName = String(updates.patientName ?? currentPatient.patientName ?? '');
  const nextRut = String(updates.rut ?? currentPatient.rut ?? '');
  if (
    shouldAnchorFirstSeenDate({
      currentPatientName: currentPatient.patientName,
      currentRut: currentPatient.rut,
      nextPatientName,
      nextRut,
      currentFirstSeenDate: currentPatient.firstSeenDate,
    })
  ) {
    patches[`beds.${bedId}.firstSeenDate`] = recordDate;
  }

  const nextGinecobstetriciaType =
    updates.ginecobstetriciaType ?? currentPatient.ginecobstetriciaType;
  const nextDeliveryRoute = updates.deliveryRoute ?? currentPatient.deliveryRoute;
  const nextUpcClassification = resolveUpcClassificationFromChecklist(
    updates.upcChecklist ?? currentPatient.upcChecklist
  );

  if (updatesGinecobstetriciaType && !isObstetricGinecobstetricia(nextGinecobstetriciaType)) {
    Object.entries(clearDeliveryRouteFields()).forEach(([key, value]) => {
      patches[`beds.${bedId}.${key}`] = value;
    });
  } else if (updatesDeliveryRoute && nextDeliveryRoute !== 'Cesárea') {
    patches[`beds.${bedId}.deliveryCesareanLabor`] = undefined;
  }

  if (updatesUpcChecklist && isUciEligibleBedId(bedId)) {
    // Solo cuando la clasificación UPC realmente CAMBIA: los guardados que
    // reenvían el paciente completo (p. ej. Datos Demográficos) incluyen un
    // upcChecklist sin cambios, y colar bedTypeOverrides (autoridad clínica)
    // en ese parche estructural hacía rechazar TODO el guardado por la
    // separación de autoridades.
    const currentUpcClassification = resolveUpcClassificationFromChecklist(
      currentPatient.upcChecklist
    );
    if (nextUpcClassification !== currentUpcClassification) {
      patches[`bedTypeOverrides.${bedId}`] =
        nextUpcClassification === 'UPC_UCI' ? BedType.UCI : undefined;
    }
  }

  return patches;
};

const buildTargetBedPatient = ({
  patient,
  targetBedId,
  targetLocation,
}: {
  patient: PatientData;
  targetBedId: string;
  targetLocation: PatientData['location'];
}): PatientData =>
  normalizePatientUpcForBed(
    {
      ...patient,
      location: targetLocation,
    },
    targetBedId
  );

const buildClearedBedPatient = ({
  bedId,
  location,
}: {
  bedId: string;
  location: PatientData['location'];
}): PatientData => {
  const cleanPatient = createEmptyPatient(bedId);
  cleanPatient.location = location;
  return cleanPatient;
};

export const buildClearAllBedsPatches = (state: DailyRecord): DailyRecordPatch => {
  const patches: Record<string, unknown> = {};
  Object.keys(state.beds).forEach(bedId => {
    patches[`beds.${bedId}`] = buildClearedBedPatient({
      bedId,
      location: state.beds[bedId]?.location,
    });
  });
  return patches as DailyRecordPatch;
};

export const buildMovePatientPatches = (
  state: DailyRecord,
  sourceBedId: string,
  targetBedId: string
): DailyRecordPatch => {
  const sourceData = state.beds[sourceBedId];
  if (!sourceData) {
    return {} as DailyRecordPatch;
  }

  return {
    [`beds.${targetBedId}`]: buildTargetBedPatient({
      patient: sourceData,
      targetBedId,
      targetLocation: state.beds[targetBedId]?.location,
    }),
    [`beds.${sourceBedId}`]: buildClearedBedPatient({
      bedId: sourceBedId,
      location: sourceData.location,
    }),
  } as DailyRecordPatch;
};

export const buildCopyPatientPatches = (
  state: DailyRecord,
  sourceBedId: string,
  targetBedId: string
): DailyRecordPatch => {
  const sourceData = state.beds[sourceBedId];
  if (!sourceData) {
    return {} as DailyRecordPatch;
  }

  return {
    [`beds.${targetBedId}`]: buildTargetBedPatient({
      patient: deepClone(sourceData),
      targetBedId,
      targetLocation: state.beds[targetBedId]?.location,
    }),
  } as DailyRecordPatch;
};

export const buildClinicalCribMultipleFieldPatches = (
  state: DailyRecord,
  bedId: string,
  fields: Partial<PatientData>
): DailyRecordPatch => {
  // Mismo modal demográfico que la cama (reenvía el objeto completo): solo
  // viaja lo que realmente cambia respecto de la cuna vigente. Sin cuna aún,
  // todo es cambio.
  const currentCrib = state.beds[bedId]?.clinicalCrib;
  const currentCribFields = currentCrib
    ? new Map<string, unknown>(Object.entries(currentCrib))
    : undefined;
  const patches: Record<string, unknown> = {};
  const manualDiagnosisPatches: Record<string, unknown> = {};
  const manualDocumentPatches: Record<string, unknown> = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (currentCribFields && arePatchValuesDeepEqual(value, currentCribFields.get(key))) return;
    patches[`beds.${bedId}.clinicalCrib.${key}`] = value;
    markManualDiagnosis(manualDiagnosisPatches, `beds.${bedId}.clinicalCrib`, key, currentCrib);
  });
  if (
    currentCrib?.diagnosisManualOverride === true &&
    arePatchValuesDeepEqual(
      manualDiagnosisPatches[`beds.${bedId}.clinicalCrib.diagnosisManualOverrideBase`],
      currentCrib.diagnosisManualOverrideBase
    )
  ) {
    delete manualDiagnosisPatches[`beds.${bedId}.clinicalCrib.diagnosisManualOverrideBase`];
    if (
      Object.prototype.hasOwnProperty.call(
        patches,
        `beds.${bedId}.clinicalCrib.diagnosisManualOverrideBase`
      ) &&
      manualDiagnosisPatches[`beds.${bedId}.clinicalCrib.diagnosisManualOverride`] === true
    ) {
      delete patches[`beds.${bedId}.clinicalCrib.diagnosisManualOverrideBase`];
    }
  }
  if (
    editsPatientDocumentIdentity(currentCrib, fields) &&
    (currentCrib?.documentManualOverride !== true || fields.documentManualOverride === false)
  ) {
    manualDocumentPatches[`beds.${bedId}.clinicalCrib.documentManualOverride`] = true;
  }
  Object.assign(patches, manualDiagnosisPatches, manualDocumentPatches);
  if (editsEloisaNameParts(currentCrib, fields)) {
    patches[`beds.${bedId}.clinicalCrib.namePartsSource`] = undefined;
  }
  if (
    currentCrib?.clinicalEpisodeId &&
    fields.clinicalEpisodeId &&
    currentCrib.clinicalEpisodeId !== fields.clinicalEpisodeId
  ) {
    patches[`beds.${bedId}.clinicalCrib.diagnosisManualOverride`] = undefined;
    patches[`beds.${bedId}.clinicalCrib.diagnosisManualOverrideBase`] = undefined;
    patches[`beds.${bedId}.clinicalCrib.documentManualOverride`] = undefined;
  }
  return patches as DailyRecordPatch;
};

export const buildUpdatePatientPatches = (
  state: DailyRecord,
  bedId: string,
  fields: Partial<PatientData>
): DailyRecordPatch => {
  const currentPatient = state.beds[bedId];
  if (!currentPatient) {
    return {} as DailyRecordPatch;
  }

  return filterUnchangedBedFieldPatches(
    state,
    bedId,
    buildPatientFieldPatches({
      bedId,
      currentPatient,
      updates: fields,
      recordDate: state.date,
    })
  ) as DailyRecordPatch;
};

export const buildClearPatientPatches = (state: DailyRecord, bedId: string): DailyRecordPatch =>
  ({
    [`beds.${bedId}`]: buildClearedBedPatient({
      bedId,
      location: state.beds[bedId]?.location,
    }),
  }) as DailyRecordPatch;

export const buildToggleBlockedBedPatches = (
  state: DailyRecord,
  bedId: string,
  reason?: string
): DailyRecordPatch => {
  const newIsBlocked = !state.beds[bedId]?.isBlocked;
  return {
    [`beds.${bedId}.isBlocked`]: newIsBlocked,
    [`beds.${bedId}.blockedReason`]: newIsBlocked ? reason || '' : '',
  } as DailyRecordPatch;
};

export const buildToggleExtraBedPatches = (state: DailyRecord, bedId: string): DailyRecordPatch => {
  const currentExtras = state.activeExtraBeds || [];
  const isActive = !currentExtras.includes(bedId);
  const newExtras = isActive ? [...currentExtras, bedId] : currentExtras.filter(id => id !== bedId);
  return {
    activeExtraBeds: newExtras,
  } as DailyRecordPatch;
};

export const buildToggleBedTypePatches = (
  state: DailyRecord,
  bedId: string
): DailyRecordPatch | null => {
  const bedDef = BEDS.find(b => b.id === bedId);
  if (!bedDef) return null;

  const currentType = getBedTypeForRecord(bedDef, state);
  const nextType = currentType === BedType.UTI ? BedType.UCI : BedType.UTI;
  const patchValue = nextType === bedDef.type ? undefined : nextType;

  // El servidor exige que bedTypeOverrides viaje en la MISMA escritura que un
  // parche UPC de la cama («bed type override must accompany a UPC patch»):
  // un override solitario era rechazado y el toggle manual quedó roto bajo la
  // valla schema-v2 (bug latente confirmado 01-09). isUPC viaja con su valor
  // vigente como acompañante del sobre clínico.
  return {
    [`bedTypeOverrides.${bedId}`]: patchValue,
    [`beds.${bedId}.isUPC`]: state.beds[bedId]?.isUPC === true,
  } as DailyRecordPatch;
};

export const buildUpdateBlockedReasonPatches = (bedId: string, reason: string): DailyRecordPatch =>
  ({
    [`beds.${bedId}.blockedReason`]: reason,
  }) as DailyRecordPatch;

export const buildCreateClinicalCribPatches = (
  state: DailyRecord,
  bedId: string
): DailyRecordPatch => {
  const parentPatient = state.beds[bedId];
  if (!parentPatient) {
    return {} as DailyRecordPatch;
  }

  return {
    [`beds.${bedId}.clinicalCrib`]: buildClinicalCribDraft(bedId, parentPatient),
    [`beds.${bedId}.hasCompanionCrib`]: false,
  } as DailyRecordPatch;
};

export const buildRemoveClinicalCribPatches = (bedId: string): DailyRecordPatch =>
  ({
    [`beds.${bedId}.clinicalCrib`]: null,
  }) as DailyRecordPatch;

export const buildUpdateClinicalCribPatches = (
  state: DailyRecord,
  bedId: string,
  field: keyof PatientData,
  value: PatientFieldValue
): DailyRecordPatch => {
  const currentCrib = state.beds[bedId]?.clinicalCrib;
  const update = { [field]: value } as Partial<PatientData>;
  const patches: Record<string, unknown> = {
    [`beds.${bedId}.clinicalCrib.${field}`]: value,
  };
  markManualDiagnosis(patches, `beds.${bedId}.clinicalCrib`, field, currentCrib);
  if (
    currentCrib?.diagnosisManualOverride === true &&
    arePatchValuesDeepEqual(
      patches[`beds.${bedId}.clinicalCrib.diagnosisManualOverrideBase`],
      currentCrib.diagnosisManualOverrideBase
    )
  ) {
    delete patches[`beds.${bedId}.clinicalCrib.diagnosisManualOverrideBase`];
  }
  if (
    editsPatientDocumentIdentity(currentCrib, update) &&
    currentCrib?.documentManualOverride !== true
  ) {
    patches[`beds.${bedId}.clinicalCrib.documentManualOverride`] = true;
  }
  if (editsEloisaNameParts(currentCrib, update)) {
    patches[`beds.${bedId}.clinicalCrib.namePartsSource`] = undefined;
  }
  return patches as DailyRecordPatch;
};
