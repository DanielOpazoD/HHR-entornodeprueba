import React, { useMemo } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { buildMedifPatientOptions, prefillMedifPatient } from '../../domain/medifPatientPrefill';
import { emptyMedifValues } from '../../domain/medifDraft';
import { downloadMedifPdf } from '../../services/medifDownload';
import type { ToolComponentProps } from './ToolFrame';
import { MedifEditor } from './medif/MedifEditor';

export { LibraryExitConfirmation } from '../LibraryExitConfirmation';

/** Read-only snapshot of the authorized census. MEDIF never writes back to beds. */
export const MedifTool: React.FC<ToolComponentProps> = ({ onBack, onClose, onDirtyChange }) => {
  const { record } = useDailyRecordData();
  const patients = useMemo(
    () =>
      buildMedifPatientOptions(record).map(patient => ({
        key: patient.key,
        label: patient.label,
        values: { ...emptyMedifValues(), ...prefillMedifPatient(patient).fields },
        sourceLabel: `${patient.bedLabel}${patient.location === 'clinicalCrib' ? ' · Cuna clínica' : ''} · Censo ${patient.recordDate}`,
      })),
    [record]
  );
  return (
    <MedifEditor
      patients={patients}
      onBack={onBack}
      onClose={onClose}
      onDirtyChange={onDirtyChange}
      onGeneratePdf={downloadMedifPdf}
    />
  );
};
