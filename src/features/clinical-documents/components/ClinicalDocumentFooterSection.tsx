import React from 'react';
import { EyeOff, FileSignature, Save, UserRoundCheck } from 'lucide-react';

import { InlineEditableTitle } from '@/features/clinical-documents/components/InlineEditableTitle';
import type { ClinicalDocumentRecord } from '@/features/clinical-documents/domain/entities';
import type { ClinicalDocumentSignatureProfile } from '@/features/clinical-documents/services/clinicalDocumentSignatureProfileService';

interface ClinicalDocumentFooterSectionProps {
  document: ClinicalDocumentRecord;
  canEdit: boolean;
  onPatchFooterLabel: (kind: 'medico' | 'especialidad', title: string) => void;
  onPatchDocumentMeta: (
    patch: Partial<
      Pick<ClinicalDocumentRecord, 'medico' | 'especialidad' | 'includePatientSignature'>
    >
  ) => void;
  signatureProfile?: ClinicalDocumentSignatureProfile | null;
  onSaveSignatureProfile?: () => void;
  onApplySignatureProfile?: () => void;
  onClearActiveTitleTarget: () => void;
}

const DOCUMENT_TYPES_WITH_PATIENT_SIGNATURE = new Set<ClinicalDocumentRecord['documentType']>([
  'epicrisis',
  'epicrisis_traslado',
]);

export const ClinicalDocumentFooterSection: React.FC<ClinicalDocumentFooterSectionProps> = ({
  document,
  canEdit,
  onPatchFooterLabel,
  onPatchDocumentMeta,
  signatureProfile,
  onSaveSignatureProfile,
  onApplySignatureProfile,
  onClearActiveTitleTarget,
}) => {
  const includePatientSignature = document.includePatientSignature ?? true;
  const canChangePatientSignature = canEdit && !document.isLocked;
  const showsPatientSignatureControl = DOCUMENT_TYPES_WITH_PATIENT_SIGNATURE.has(
    document.documentType
  );
  const signatureToggleLabel = includePatientSignature
    ? 'Firma visible paciente/familiar'
    : 'Firma oculta paciente/familiar';
  const signatureToggleActionLabel = includePatientSignature
    ? 'Ocultar firma paciente/familiar'
    : 'Mostrar firma paciente/familiar';
  const signatureToggleClassName = [
    'clinical-document-print-control inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[9px] font-medium transition-colors print:hidden disabled:cursor-not-allowed disabled:opacity-50',
    includePatientSignature
      ? 'border-slate-200 bg-white/70 text-slate-400 hover:border-slate-300 hover:text-slate-600'
      : 'border-amber-200 bg-amber-50/80 text-amber-700 hover:border-amber-300 hover:text-amber-800',
  ].join(' ');
  const canUseSpecialistSignatureControls =
    canEdit && !document.isLocked && Boolean(onSaveSignatureProfile);
  const canApplySignatureProfile =
    canUseSpecialistSignatureControls &&
    Boolean(signatureProfile) &&
    (signatureProfile?.displayName !== document.medico ||
      signatureProfile?.specialty !== document.especialidad);
  const specialistSignatureButtonClassName =
    'clinical-document-print-control inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md border border-slate-200 bg-white/70 px-1.5 text-[8px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 print:hidden disabled:cursor-not-allowed disabled:opacity-50';
  const saveSignatureButtonClassName =
    'clinical-document-print-control inline-flex h-5 w-5 items-center justify-center rounded-md border border-slate-200 bg-white/70 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 print:hidden disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="clinical-document-footer">
      <div className="flex flex-col gap-1">
        <div className="flex min-h-6 flex-nowrap items-center gap-1.5 overflow-visible">
          <InlineEditableTitle
            value={document.footerMedicoLabel}
            onChange={title => onPatchFooterLabel('medico', title)}
            onDeactivate={onClearActiveTitleTarget}
            disabled={!canEdit || document.isLocked}
            className="clinical-document-section-title clinical-document-footer-title"
          />
          {canUseSpecialistSignatureControls ? (
            <div className="flex flex-nowrap items-center gap-1.5 print:hidden">
              <button
                type="button"
                aria-label="Guardar mi firma"
                title="Guardar nombre y especialidad como mi firma clínica"
                onClick={onSaveSignatureProfile}
                className={saveSignatureButtonClassName}
              >
                <Save size={10} />
              </button>
              {signatureProfile ? (
                <button
                  type="button"
                  aria-label="Usar mi firma"
                  title="Aplicar mi firma clínica guardada a este documento"
                  disabled={!canApplySignatureProfile}
                  onClick={onApplySignatureProfile}
                  className={specialistSignatureButtonClassName}
                >
                  <UserRoundCheck size={10} />
                  Usar mi firma
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <input
          type="text"
          value={document.medico}
          onChange={event => onPatchDocumentMeta({ medico: event.target.value })}
          readOnly={!canEdit || document.isLocked}
          className="clinical-document-input"
        />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex min-h-6 items-center">
          <InlineEditableTitle
            value={document.footerEspecialidadLabel}
            onChange={title => onPatchFooterLabel('especialidad', title)}
            onDeactivate={onClearActiveTitleTarget}
            disabled={!canEdit || document.isLocked}
            className="clinical-document-section-title clinical-document-footer-title"
          />
        </div>
        <input
          type="text"
          value={document.especialidad}
          onChange={event => onPatchDocumentMeta({ especialidad: event.target.value })}
          readOnly={!canEdit || document.isLocked}
          className="clinical-document-input"
        />
        {showsPatientSignatureControl ? (
          <div className="mt-2 flex justify-end print:hidden">
            <button
              type="button"
              aria-pressed={!includePatientSignature}
              aria-label={signatureToggleActionLabel}
              title={signatureToggleActionLabel}
              disabled={!canChangePatientSignature}
              onClick={() =>
                onPatchDocumentMeta({ includePatientSignature: !includePatientSignature })
              }
              className={signatureToggleClassName}
            >
              {includePatientSignature ? <FileSignature size={11} /> : <EyeOff size={11} />}
              {signatureToggleLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
};
