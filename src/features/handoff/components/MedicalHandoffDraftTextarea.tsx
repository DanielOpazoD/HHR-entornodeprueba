import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import React from 'react';
import { DebouncedTextarea } from '@/components/ui/DebouncedTextarea';
import type { PatientData } from '@/domain/handoff/patientContracts';
import { buildLegacyClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';
import { useMedicalHandoffDrafts, writeMedicalHandoffDraft } from '@/hooks/useMedicalHandoffDraft';

export const medicalHandoffPatientKey = (patient: PatientData): string =>
  JSON.stringify([
    patient.documentType || 'RUT',
    patient.rut,
    patient.patientName,
    patient.clinicalEpisodeId || buildLegacyClinicalEpisodeId(patient),
  ]);

interface Props {
  patient: PatientData;
  reportDate: string;
  entryId: string;
  value: string;
  onChangeValue: (value: string) => void;
}

// A keyed editor freezes its patient's callback when typing starts. Remounting never submits.
export const MedicalHandoffDraftTextarea: React.FC<Props> = props => (
  <DraftEditor
    key={`${props.reportDate}:${medicalHandoffPatientKey(props.patient)}:${props.entryId}`}
    {...props}
  />
);

const DraftEditor: React.FC<Props> = ({ patient, reportDate, entryId, value, onChangeValue }) => {
  const key = `${reportDate}:${medicalHandoffPatientKey(patient)}:${entryId}`;
  const drafts = useMedicalHandoffDrafts();
  const draft = drafts.find(item => item.key === key);
  const [storageFailed, setStorageFailed] = React.useState(false);
  const [reviewing, setReviewing] = React.useState(false);
  const pendingValue = React.useRef<string | null>(null);
  const capturedSave = React.useRef<typeof onChangeValue | null>(null);
  const submitPending = () => {
    if (pendingValue.current === null) return;
    const next = pendingValue.current;
    pendingValue.current = null;
    const save = capturedSave.current;
    capturedSave.current = null;
    save?.(next);
  };
  return (
    <>
      <DebouncedTextarea
        value={draft?.value ?? value}
        onChange={event => {
          capturedSave.current ??= onChangeValue;
          pendingValue.current = event.target.value;
          setStorageFailed(
            !writeMedicalHandoffDraft({
              key,
              date: reportDate,
              patientName: patient.patientName,
              rut: patient.rut,
              documentType: patient.documentType || 'RUT',
              clinicalEpisodeId:
                patient.clinicalEpisodeId || buildLegacyClinicalEpisodeId(patient) || '',
              entryId,
              value: event.target.value,
            })
          );
        }}
        onChangeValue={submitPending}
        onBlur={submitPending}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-[13px] leading-snug focus:ring-2 focus:ring-medical-500 focus:outline-none"
        minRows={1}
        debounceMs={1500}
      />
      {draft && (
        <div className="text-xs text-amber-800 print:hidden" role="status">
          {storageFailed
            ? 'Borrador solo en pantalla: no se pudo guardar en el dispositivo.'
            : 'Copia local del texto; verifica el guardado antes de cerrar.'}
          <button type="button" onClick={() => setReviewing(!reviewing)}>
            Revisar borrador
          </button>
          {reviewing && (
            <div>
              <p>
                {draft.patientName} · Episodio {draft.clinicalEpisodeId}
              </p>
              <p>Texto del borrador:</p>
              <pre className="whitespace-pre-wrap">{draft.value}</pre>
              <p>Texto recibido del registro:</p>
              <pre className="whitespace-pre-wrap">{value}</pre>
              <button
                type="button"
                disabled={storageFailed}
                onClick={() => defaultBrowserWindowRuntime.reload()}
              >
                Recargar conservando borrador
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
};
