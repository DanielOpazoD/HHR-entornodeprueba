import React, { useMemo } from 'react';
import { useDailyRecordBeds, useDailyRecordMeta } from '@/context/DailyRecordContext';
import { buildClinicalFormPatientOptions } from '../../domain/forms/clinicalFormPatient';
import { medifValuesFromClinicalPatient } from '../../domain/forms/clinicalFormMedif';
import { downloadMedifPdf } from '../../services/medifDownload';
import type { ToolComponentProps } from './ToolFrame';
import { MedifEditor } from './medif/MedifEditor';

export { LibraryExitConfirmation } from '../LibraryExitConfirmation';

/** Read-only snapshot of the authorized census. MEDIF never writes back to beds. */
export const MedifTool: React.FC<ToolComponentProps> = ({ onBack, onClose, onDirtyChange }) => {
  const beds = useDailyRecordBeds();
  const { date, activeExtraBeds } = useDailyRecordMeta();
  const patients = useMemo(
    () =>
      date && beds
        ? buildClinicalFormPatientOptions({ date, beds, activeExtraBeds }).map(patient => ({
            key: patient.key,
            label: patient.label,
            values: medifValuesFromClinicalPatient(patient),
            sourceLabel: `${patient.values.cama_nombre}${patient.context.location === 'clinicalCrib' ? ' · Cuna clínica' : ''} · Censo ${patient.context.recordDate}`,
          }))
        : [],
    [activeExtraBeds, beds, date]
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
