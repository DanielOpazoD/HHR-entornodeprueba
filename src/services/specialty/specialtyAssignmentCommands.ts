/**
 * Comandos de cliente para la decisión de especialidad.
 *
 * El comando manual construye `manual_locked` (o la aceptación asistida por
 * IA) y lo envía JUNTO al escalar `specialty` por el canal clínico habitual
 * (`updatePatientMultiple` / `updateClinicalCribMultiple` → callable). La
 * autoridad del episodio en el servidor valida forma, actor, episodio y
 * revisión; el navegador nunca firma procedencia que no pueda verificar.
 */
import type { PatientData } from '@/types/domain/patient';
import type { Specialty } from '@/types/domain/patientClassification';
import type {
  ManualSelectionOrigin,
  SpecialtyAssignment,
} from '@/domain/specialtyAssignment/contracts';
import { deriveSpecialtyAssignment } from '@/domain/specialtyAssignment/contracts';
import { applyManualSelection } from '@/domain/specialtyAssignment/transitions';

export interface ManualSpecialtySelectionInput {
  value: Specialty | string;
  actorUid: string;
  operationId: string;
  decidedAt: string;
  selectionOrigin?: ManualSelectionOrigin;
  recommendationId?: string;
}

export type BuildSelectionResult =
  | {
      ok: true;
      fields: { specialty: Specialty | string; specialtyAssignment: SpecialtyAssignment };
      assignment: SpecialtyAssignment;
    }
  | { ok: false; reason: string };

/**
 * Construye los campos de una selección manual. También cubre el caso
 * "mismo valor": el usuario reafirma el texto pero el ORIGEN cambia a
 * manual_locked con nueva revisión — la semántica manda sobre el diff.
 */
export const buildManualSpecialtySelectionFields = (
  patient: Pick<PatientData, 'specialty' | 'specialtyAssignment' | 'clinicalEpisodeId'>,
  input: ManualSpecialtySelectionInput
): BuildSelectionResult => {
  const current = deriveSpecialtyAssignment(patient);
  const transition = applyManualSelection(current, {
    value: input.value,
    operationId: input.operationId,
    decidedAt: input.decidedAt,
    decidedByUserId: input.actorUid,
    selectionOrigin: input.selectionOrigin ?? 'direct',
    recommendationId: input.recommendationId,
  });
  if (!transition.applied) {
    return { ok: false, reason: transition.reason };
  }
  return {
    ok: true,
    assignment: transition.assignment,
    fields: { specialty: transition.assignment.value, specialtyAssignment: transition.assignment },
  };
};

export interface SpecialtySelectionDispatch {
  /** Persiste campos del paciente de la cama por el canal clínico. */
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => Promise<boolean>;
  /** Persiste campos de la cuna clínica (episodio independiente). */
  updateClinicalCribMultiple?: (bedId: string, fields: Partial<PatientData>) => Promise<boolean>;
}

/**
 * Aplica una selección manual de especialidad a una cama o a la cuna
 * clínica del episodio correspondiente.
 */
export const commitManualSpecialtySelection = async (
  dispatch: SpecialtySelectionDispatch,
  input: ManualSpecialtySelectionInput & {
    bedId: string;
    target?: 'bed' | 'clinicalCrib';
    patient: Pick<PatientData, 'specialty' | 'specialtyAssignment' | 'clinicalEpisodeId'>;
  }
): Promise<{ status: 'applied' | 'rejected'; reason?: string }> => {
  const built = buildManualSpecialtySelectionFields(input.patient, input);
  if (!built.ok) return { status: 'rejected', reason: built.reason };

  const fields = built.fields as Partial<PatientData>;
  const persisted =
    input.target === 'clinicalCrib' && dispatch.updateClinicalCribMultiple
      ? await dispatch.updateClinicalCribMultiple(input.bedId, fields)
      : await dispatch.updatePatientMultiple(input.bedId, fields);
  return persisted ? { status: 'applied' } : { status: 'rejected', reason: 'persist_failed' };
};
