import React, { useMemo } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { buildClinicalFormPatientOptions } from '../../domain/forms/clinicalFormPatient';
import type { ClinicalFormId } from '../../domain/forms/clinicalFormTypes';
import { generateClinicalFormPdf } from '../../services/clinicalFormPdf';
import { ClinicalFormEditor } from './forms/ClinicalFormEditor';
import type { ToolComponentProps } from './ToolFrame';

export const ClinicalFormTool: React.FC<
  ToolComponentProps & { formId: ClinicalFormId; onFormChange: (id: ClinicalFormId) => void }
> = ({ formId, onFormChange, onBack, onClose, onDirtyChange }) => {
  const { record } = useDailyRecordData();
  const patients = useMemo(() => buildClinicalFormPatientOptions(record), [record]);
  return (
    <ClinicalFormEditor
      formId={formId}
      onFormChange={onFormChange}
      patients={patients}
      onBack={onBack}
      onClose={onClose}
      onDirtyChange={onDirtyChange}
      onGeneratePdf={generateClinicalFormPdf}
    />
  );
};
