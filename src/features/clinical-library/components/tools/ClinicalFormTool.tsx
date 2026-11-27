import React, { useContext, useMemo } from 'react';
import { AuthContext } from '@/context/AuthContext';
import { BOOTSTRAP_PLACEHOLDER_UID } from '@/constants/security';
import { useDailyRecordBeds, useDailyRecordMeta } from '@/context/DailyRecordContext';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { getClinicalForm } from '../../domain/forms/clinicalFormCatalog';
import { buildClinicalFormPatientOptions } from '../../domain/forms/clinicalFormPatient';
import { SIC_FORM_ID } from '../../domain/forms/sicFormData';
import type {
  ClinicalFormId,
  ClinicalFormPatientOption,
} from '../../domain/forms/clinicalFormTypes';
import { generateClinicalFormPdf } from '../../services/clinicalFormPdf';
import { readSicSignaturePng } from '../../services/sicSignatureImage';
import { ClinicalFormEditor } from './forms/ClinicalFormEditor';
import { SicSignatureField, useSicSignature } from './forms/SicSignatureField';
import type { ToolComponentProps } from './ToolFrame';

export { LibraryExitConfirmation } from '../LibraryExitConfirmation';

type Props = Pick<ToolComponentProps, 'onBack' | 'onClose' | 'onDirtyChange'> & {
  formId: ClinicalFormId;
  onFormChange: (id: ClinicalFormId) => void;
};

const NO_PATIENTS: ReadonlyArray<ClinicalFormPatientOption> = [];

export const ClinicalFormTool: React.FC<Props> = props => {
  const user = useContext(AuthContext)?.currentUser;
  const epoch = useSessionEpoch();
  const uid = user?.uid && user.uid !== BOOTSTRAP_PLACEHOLDER_UID ? user.uid : null;
  const sessionKey = `${uid}:${epoch}`;
  return getClinicalForm(props.formId).internalOnly ? (
    <ClinicalFormEditor
      key={`${props.formId}:${sessionKey}`}
      {...props}
      patients={NO_PATIENTS}
      onGeneratePdf={generateClinicalFormPdf}
    />
  ) : (
    <PatientForm key={sessionKey} {...props} uid={uid} />
  );
};

const PatientForm: React.FC<Props & { uid: string | null }> = ({
  uid,
  formId,
  onFormChange,
  onBack,
  onClose,
  onDirtyChange,
}) => {
  const beds = useDailyRecordBeds();
  const { date, activeExtraBeds } = useDailyRecordMeta();
  const patients = useMemo(
    () => (date && beds ? buildClinicalFormPatientOptions({ date, beds, activeExtraBeds }) : []),
    [activeExtraBeds, beds, date]
  );
  const sic = formId === SIC_FORM_ID;
  const signature = useSicSignature(sic ? uid : null);
  const signatureBytes = async () => {
    if (signature.busy || signature.failed) throw new Error('Revisa la firma antes de exportar.');
    return signature.url ? readSicSignaturePng(signature.url) : undefined;
  };
  return (
    <ClinicalFormEditor
      formId={formId}
      onFormChange={onFormChange}
      patients={patients}
      onBack={onBack}
      onClose={onClose}
      onDirtyChange={onDirtyChange}
      exportContext={
        sic
          ? JSON.stringify([signature.url, signature.include, signature.busy, signature.failed])
          : ''
      }
      exportDirty={Boolean(signature.localUrl)}
      exportBlocked={sic && (signature.busy || signature.failed)}
      exportFields={sic ? <SicSignatureField signature={signature} /> : undefined}
      onGeneratePdf={async (form, values, hidden) => {
        if (form.id !== SIC_FORM_ID) return generateClinicalFormPdf(form, values, hidden);
        const { generateSicFormPdf } = await import('../../services/sicFormPdf');
        return generateSicFormPdf(form, values, hidden, await signatureBytes());
      }}
      onGenerateDocx={async (form, values, hidden, annexes) => {
        if (form.id === SIC_FORM_ID) {
          const { generateSicFormDocx } = await import('../../services/sicFormDocx');
          return generateSicFormDocx(form, values, hidden, await signatureBytes());
        }
        const { generateClinicalFormDocx } = await import('../../services/clinicalFormDocx');
        return generateClinicalFormDocx(form, values, hidden, annexes);
      }}
    />
  );
};
