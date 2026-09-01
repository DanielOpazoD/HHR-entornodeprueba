import type { DailyRecord, DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import { PatientData } from '@/hooks/contracts/patientHookContracts';
import { BedType } from '@/types/domain/beds';
import { PatientFieldValue } from '@/types/valueTypes';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { BEDS } from '@/constants/beds';
import { getBedTypeForRecord } from '@/utils/bedTypeUtils';
import { deepClone } from '@/utils/deepClone';
import {
  clearDeliveryRouteFields,
  clearGinecobstetriciaFields,
  isGinecobstetriciaSpecialty,
  isObstetricGinecobstetricia,
} from '@/shared/census/ginecobstetriciaClassification';
import {
  isUciEligibleBedId,
  normalizePatientUpcForBed,
  resolveNormalizedUpcFlag,
  resolveUpcClassificationFromChecklist,
} from '@/shared/census/upcBedPolicy';
import {
  getClearClinicalDataPatches,
  isDifferentPatientIdentity,
  shouldAnchorFirstSeenDate,
  shouldResetClinicalEpisodeOwnership,
} from '@/hooks/controllers/bedManagementPatientIdentityPatchController';
import { buildClinicalCribDraft } from '@/hooks/controllers/clinicalCribController';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';

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
  const currentPatient = state.beds[bedId] as unknown as Record<string, unknown> | undefined;
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
    if (!arePatchValuesDeepEqual(value, currentPatient[field])) {
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
  let hasIdentityChange = false;
  const updatesSpecialty = Object.prototype.hasOwnProperty.call(updates, 'specialty');
  const updatesGinecobstetriciaType = Object.prototype.hasOwnProperty.call(
    updates,
    'ginecobstetriciaType'
  );
  const updatesDeliveryRoute = Object.prototype.hasOwnProperty.call(updates, 'deliveryRoute');
  const updatesUpcChecklist = Object.prototype.hasOwnProperty.call(updates, 'upcChecklist');

  Object.entries(updates).forEach(([key, value]) => {
    patches[`beds.${bedId}.${key}`] =
      key === 'isUPC' ? resolveNormalizedUpcFlag(bedId, Boolean(value)) : value;

    if (
      (key === 'rut' || key === 'patientName') &&
      value !== currentPatient[key as keyof PatientData]
    ) {
      hasIdentityChange = true;
    }
  });

  const nextPatientName = String(updates.patientName ?? currentPatient.patientName ?? '');
  const nextRut = String(updates.rut ?? currentPatient.rut ?? '');
  const hadPatientIdentity = Boolean(
    String(currentPatient.patientName || '').trim() || String(currentPatient.rut || '').trim()
  );
  const resetsClinicalEpisodeOwnership = shouldResetClinicalEpisodeOwnership({
    currentClinicalEpisodeId: currentPatient.clinicalEpisodeId,
    currentPatientName: currentPatient.patientName,
    currentRut: currentPatient.rut,
    nextPatientName,
    nextRut,
  });

  // La limpieza clínica de la cama es para un REEMPLAZO de persona, no para
  // corregir el nombre del mismo paciente (mismo RUT): el heurístico anterior
  // borraba el diagnóstico y volvía mixto el guardado demográfico.
  const identityReplaced =
    hasIdentityChange &&
    isDifferentPatientIdentity({
      currentPatientName: currentPatient.patientName,
      currentRut: currentPatient.rut,
      nextPatientName,
      nextRut,
    });
  if (identityReplaced && hadPatientIdentity) {
    Object.assign(patches, getClearClinicalDataPatches(bedId));
  }

  if (resetsClinicalEpisodeOwnership) {
    patches[`beds.${bedId}.clinicalEpisodeId`] = undefined;
    patches[`beds.${bedId}.firstSeenDate`] =
      nextPatientName.trim() || nextRut.trim() ? recordDate : undefined;
  } else if (
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

  const nextSpecialty = String(updates.specialty ?? currentPatient.specialty ?? '');
  const nextGinecobstetriciaType =
    updates.ginecobstetriciaType ?? currentPatient.ginecobstetriciaType;
  const nextDeliveryRoute = updates.deliveryRoute ?? currentPatient.deliveryRoute;
  const nextUpcClassification = resolveUpcClassificationFromChecklist(
    updates.upcChecklist ?? currentPatient.upcChecklist
  );

  if (updatesSpecialty && !isGinecobstetriciaSpecialty(nextSpecialty)) {
    Object.entries(clearGinecobstetriciaFields()).forEach(([key, value]) => {
      patches[`beds.${bedId}.${key}`] = value;
    });
  } else if (
    updatesGinecobstetriciaType &&
    !isObstetricGinecobstetricia(nextGinecobstetriciaType)
  ) {
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
      bedId: targetBedId,
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
      location: state.beds[bedId].location,
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

  return {
    [`beds.${targetBedId}`]: buildTargetBedPatient({
      patient: sourceData,
      targetBedId,
      targetLocation: state.beds[targetBedId].location,
    }),
    [`beds.${sourceBedId}`]: buildClearedBedPatient({
      bedId: sourceBedId,
      location: state.beds[sourceBedId].location,
    }),
  } as DailyRecordPatch;
};

export const buildCopyPatientPatches = (
  state: DailyRecord,
  sourceBedId: string,
  targetBedId: string
): DailyRecordPatch =>
  ({
    [`beds.${targetBedId}`]: buildTargetBedPatient({
      patient: deepClone(state.beds[sourceBedId]),
      targetBedId,
      targetLocation: state.beds[targetBedId].location,
    }),
  }) as DailyRecordPatch;

export const buildClinicalCribMultipleFieldPatches = (
  bedId: string,
  fields: Partial<PatientData>
): DailyRecordPatch => {
  const patches: Record<string, unknown> = {};
  Object.entries(fields).forEach(([key, value]) => {
    patches[`beds.${bedId}.clinicalCrib.${key}`] = value;
  });
  return patches as DailyRecordPatch;
};

export const buildUpdatePatientPatches = (
  state: DailyRecord,
  bedId: string,
  fields: Partial<PatientData>
): DailyRecordPatch =>
  filterUnchangedBedFieldPatches(
    state,
    bedId,
    buildPatientFieldPatches({
      bedId,
      currentPatient: state.beds[bedId],
      updates: fields,
      recordDate: state.date,
    })
  ) as DailyRecordPatch;

export const buildClearPatientPatches = (state: DailyRecord, bedId: string): DailyRecordPatch =>
  ({
    [`beds.${bedId}`]: buildClearedBedPatient({
      bedId,
      location: state.beds[bedId].location,
    }),
  }) as DailyRecordPatch;

export const buildToggleBlockedBedPatches = (
  state: DailyRecord,
  bedId: string,
  reason?: string
): DailyRecordPatch => {
  const newIsBlocked = !state.beds[bedId].isBlocked;
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
): DailyRecordPatch =>
  ({
    [`beds.${bedId}.clinicalCrib`]: buildClinicalCribDraft(bedId, state.beds[bedId]),
    [`beds.${bedId}.hasCompanionCrib`]: false,
  }) as DailyRecordPatch;

export const buildRemoveClinicalCribPatches = (bedId: string): DailyRecordPatch =>
  ({
    [`beds.${bedId}.clinicalCrib`]: null,
  }) as DailyRecordPatch;

export const buildUpdateClinicalCribPatches = (
  bedId: string,
  field: keyof PatientData,
  value: PatientFieldValue
): DailyRecordPatch =>
  ({
    [`beds.${bedId}.clinicalCrib.${field}`]: value,
  }) as DailyRecordPatch;
