import React, { useContext, useMemo } from 'react';
import { AuthContext } from '@/context/AuthContext';
import { BOOTSTRAP_PLACEHOLDER_UID } from '@/constants/security';
import { useSessionEpoch } from '@/hooks/useSessionEpoch';
import { SicSignatureField, useSicSignature } from './forms/SicSignatureField';
import { SIC_FORM_ID } from '../../domain/forms/sicFormData';
import { readSicSignaturePng } from '../../services/sicSignatureImage';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { buildClinicalFormPatientOptions } from '../../domain/forms/clinicalFormPatient';
import type { ClinicalFormId } from '../../domain/forms/clinicalFormTypes';
import { generateClinicalFormPdf } from '../../services/clinicalFormPdf';
import { ClinicalFormEditor } from './forms/ClinicalFormEditor';
import type { ToolComponentProps } from './ToolFrame';

export { LibraryExitConfirmation } from '../LibraryExitConfirmation';

type Props = ToolComponentProps & {
  formId: ClinicalFormId;
  onFormChange: (id: ClinicalFormId) => void;
};

export const ClinicalFormTool: React.FC<Props> = props => {
  const user = useContext(AuthContext)?.currentUser;
  const epoch = useSessionEpoch();
  const uid = user?.uid && user.uid !== BOOTSTRAP_PLACEHOLDER_UID ? user.uid : null;
  return <SessionForm key={`${uid}:${epoch}`} {...props} uid={uid} />;
};

const SessionForm: React.FC<Props & { uid: string | null }> = ({
  uid,
  formId,
  onFormChange,
  onBack,
  onClose,
  onDirtyChange,
}) => {
  const { record } = useDailyRecordData();
  const patients = useMemo(() => buildClinicalFormPatientOptions(record), [record]);
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
