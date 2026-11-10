import React from 'react';
import { Trash2 } from 'lucide-react';

import { InlineEditableTitle } from '@/features/clinical-documents/components/InlineEditableTitle';
import {
  getClinicalDocumentPatientFieldGridClass,
  getClinicalDocumentPatientFieldLabel,
} from '@/features/clinical-documents/controllers/clinicalDocumentWorkspaceController';
import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

interface ClinicalDocumentPatientInfoSectionProps {
  document: ClinicalDocumentRecord;
  visiblePatientFields: ClinicalDocumentRecord['patientFields'];
  canEdit: boolean;
  activeTitleTarget: string | null;
  onSetActiveTitleTarget: React.Dispatch<React.SetStateAction<string | null>>;
  onPatchPatientInfoTitle: (title: string) => void;
  onPatchPatientFieldLabel: (fieldId: string, label: string) => void;
  onPatchPatientField: (fieldId: string, value: string) => void;
  onSetPatientFieldVisibility: (fieldId: string, visible: boolean) => void;
}

export const ClinicalDocumentPatientInfoSection: React.FC<
  ClinicalDocumentPatientInfoSectionProps
> = ({
  document,
  visiblePatientFields,
  canEdit,
  activeTitleTarget,
  onSetActiveTitleTarget,
  onPatchPatientInfoTitle,
  onPatchPatientFieldLabel,
  onPatchPatientField,
  onSetPatientFieldVisibility,
}) => (
  <div className="mb-3">
    <InlineEditableTitle
      value={document.patientInfoTitle}
      onChange={onPatchPatientInfoTitle}
      onActivate={() => onSetActiveTitleTarget('patient-info-title')}
      onDeactivate={() =>
        onSetActiveTitleTarget(current => (current === 'patient-info-title' ? null : current))
      }
      disabled={!canEdit || document.isLocked}
      className="clinical-document-section-title clinical-document-patient-info-title"
    />
    <div className="clinical-document-patient-grid">
      {visiblePatientFields.map(field => (
        <div key={field.id} className={getClinicalDocumentPatientFieldGridClass(field.id)}>
          <span className="clinical-document-field-label-row">
            <InlineEditableTitle
              value={getClinicalDocumentPatientFieldLabel(field, document.documentType)}
              onChange={label => onPatchPatientFieldLabel(field.id, label)}
              onActivate={() => onSetActiveTitleTarget(`field:${field.id}`)}
              onDeactivate={() =>
                onSetActiveTitleTarget(current =>
                  current === `field:${field.id}` ? null : current
                )
              }
              disabled={!canEdit || document.isLocked}
              className="clinical-document-patient-label"
            />
            {canEdit && !document.isLocked && activeTitleTarget === `field:${field.id}` && (
              <button
                type="button"
                className="clinical-document-inline-action clinical-document-inline-action--danger"
                onMouseDown={event => event.preventDefault()}
                onClick={() => onSetPatientFieldVisibility(field.id, false)}
                aria-label={`Eliminar campo ${field.label}`}
                title="Eliminar campo"
              >
                <Trash2 size={12} />
              </button>
            )}
          </span>
          <input
            type={field.type}
            value={field.value}
            onChange={event => onPatchPatientField(field.id, event.target.value)}
            readOnly={!canEdit || field.readonly || document.isLocked}
            className="clinical-document-input"
          />
        </div>
      ))}
    </div>
  </div>
);
