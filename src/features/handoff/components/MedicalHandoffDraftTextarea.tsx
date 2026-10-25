import React from 'react';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import { MedicalHandoffDraftReview } from './MedicalHandoffDraftReview';
import type { PatientData } from '@/domain/handoff/patientContracts';
import { buildLegacyClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import {
  useMedicalHandoffDrafts,
  writeMedicalHandoffDraft,
  deleteMedicalHandoffDraft,
  medicalHandoffDraftKey,
  registerMedicalHandoffDraftRestore,
} from '@/hooks/useMedicalHandoffDraft';
import { medicalHandoffPatientKey } from './medicalHandoffPatientKey';

interface Props {
  patient: PatientData;
  reportDate: string;
  entryId: string;
  value: string;
  onChangeValue: (value: string) => void;
}

export const MedicalHandoffDraftTextarea: React.FC<Props> = props => (
  <DraftEditor
    key={`${props.reportDate}:${medicalHandoffPatientKey(props.patient)}:${props.entryId}`}
    {...props}
  />
);

const DraftEditor: React.FC<Props> = ({ patient, reportDate, entryId, value, onChangeValue }) => {
  const identity = {
    documentType: patient.documentType || 'RUT',
    rut: patient.rut,
    clinicalEpisodeId: patient.clinicalEpisodeId || buildLegacyClinicalEpisodeId(patient) || '',
    entryId,
  };
  const key = medicalHandoffDraftKey(identity);
  const draft = useMedicalHandoffDrafts().find(item => item.key === key);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [storageFailed, setStorageFailed] = React.useState(false);
  const pendingValue = React.useRef<string | null>(null);
  const capturedSave = React.useRef<typeof onChangeValue | null>(null);
  React.useEffect(() => {
    pendingValue.current = null;
    capturedSave.current = null;
    setEditing(null);
    deleteMedicalHandoffDraft(key, value);
  }, [key, value]);
  const submitPending = () => {
    if (pendingValue.current === null) return;
    const next = pendingValue.current;
    pendingValue.current = null;
    const save = capturedSave.current;
    capturedSave.current = null;
    save?.(next);
  };
  React.useEffect(() => {
    if (!draft) {
      pendingValue.current = null;
      capturedSave.current = null;
      setEditing(null);
    }
  }, [draft]);
  React.useEffect(
    () =>
      registerMedicalHandoffDraftRestore(key, () => {
        if (!draft) return;
        pendingValue.current = null;
        capturedSave.current = null;
        setEditing(draft.value);
        onChangeValue(draft.value);
      }),
    [key, draft, onChangeValue]
  );
  return (
    <>
      <DebouncedTextarea
        value={editing ?? value}
        onChange={event => {
          capturedSave.current ??= onChangeValue;
          pendingValue.current = event.target.value;
          setEditing(event.target.value);
          setStorageFailed(
            !writeMedicalHandoffDraft({
              ...identity,
              key,
              date: reportDate,
              patientName: patient.patientName,
              value: event.target.value,
            })
          );
        }}
        onChangeValue={submitPending}
        onBlur={submitPending}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[13px] leading-snug focus:ring-2 focus:ring-medical-500 focus:outline-none"
        minRows={1}
        debounceMs={1500}
        syncWhileFocused
      />
      {draft && draft.value !== value && (
        <div className="text-xs text-amber-800 print:hidden">
          <p role="status">
            {storageFailed
              ? 'Borrador sin guardar, solo en memoria. Inicia sesión o conserva el texto antes de cerrar.'
              : 'Borrador pendiente; no se reenvía automáticamente.'}
          </p>
          <details>
            <summary>Revisar borrador</summary>
            <MedicalHandoffDraftReview draft={draft} />
          </details>
        </div>
      )}
    </>
  );
};
