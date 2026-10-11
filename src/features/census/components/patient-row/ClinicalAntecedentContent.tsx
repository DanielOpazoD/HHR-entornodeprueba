import { useEffect, useRef, useState } from 'react';
import { FileDown } from 'lucide-react';
import type {
  ClinicalAntecedentDetail,
  ClinicalAntecedentEntry,
  ClinicalAntecedentPrescription,
} from '@/features/rayen-import/clinical-panel';
import { formatClinicalAntecedentDate } from './clinicalAntecedentDate';

const PrescriptionCopy = ({
  recipe,
  detail,
  entry,
}: {
  recipe: ClinicalAntecedentPrescription;
  detail: ClinicalAntecedentDetail;
  entry: ClinicalAntecedentEntry;
}) => {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => () => pending.current?.abort(), []);
  const download = async (): Promise<void> => {
    if (pending.current || !detail.patientName?.trim()) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    try {
      const { downloadAntecedentPrescriptionCopy } =
        await import('@/services/pdf/antecedentPrescriptionPdf');
      await downloadAntecedentPrescriptionCopy(
        {
          ...recipe,
          date: formatClinicalAntecedentDate(recipe.date),
          patientName: detail.patientName,
          professional: detail.professional,
          facility: entry.facility,
          encounterDate: formatClinicalAntecedentDate(entry.date),
        },
        controller.signal
      );
    } catch {
      if (!controller.signal.aborted) setError('No se pudo preparar la copia PDF. Reintenta.');
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="mt-2 rounded border border-slate-200 p-2">
      <p className="font-semibold">Receta N° {recipe.id}</p>
      <p className="text-[11px] text-slate-500">
        {[formatClinicalAntecedentDate(recipe.date), recipe.type, recipe.status]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {recipe.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy || !detail.patientName?.trim()}
        aria-label={`Descargar copia PDF de receta ${recipe.id}`}
        className="mt-2 inline-flex items-center gap-1 font-semibold text-teal-700 disabled:opacity-50"
      >
        <FileDown size={14} aria-hidden="true" /> {busy ? 'Preparando PDF…' : 'Receta PDF · copia'}
      </button>
      {!detail.patientName?.trim() && (
        <p>Falta la identificación del paciente para preparar la copia PDF.</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-amber-800">
          {error}
        </p>
      )}
    </div>
  );
};

export const ClinicalAntecedentContent = ({
  detail,
  entry,
}: {
  detail: ClinicalAntecedentDetail;
  entry: ClinicalAntecedentEntry;
}) => (
  <div className="space-y-3 break-words [&>section]:rounded-lg [&>section]:border [&>section]:border-slate-100 [&>section]:bg-slate-50/50 [&>section]:p-2.5">
    {detail.professional && (
      <p className="text-[11px] font-medium text-slate-500">{detail.professional}</p>
    )}
    {detail.reason && (
      <section>
        <h5 className="mb-1 font-semibold text-teal-800">Motivo de consulta</h5>
        <p>{detail.reason}</p>
      </section>
    )}
    {detail.history && (
      <section>
        <h5 className="mb-1 font-semibold text-teal-800">Enfermedad actual</h5>
        <p>{detail.history}</p>
      </section>
    )}
    {!!detail.diagnoses?.length && (
      <section>
        <h5 className="mb-1 font-semibold text-teal-800">Diagnósticos</h5>
        <ul className="list-disc space-y-1 pl-4">
          {detail.diagnoses.map((diagnosis, index) => (
            <li key={index}>{diagnosis}</li>
          ))}
        </ul>
      </section>
    )}
    {detail.careType === 'emergency' &&
      detail.physicalExams?.map((exam, index) => (
        <section key={index}>
          <h5 className="mb-1 font-semibold text-teal-800">{exam.name}</h5>
          <dl className="mt-1 divide-y divide-slate-100 rounded border border-slate-200">
            {exam.fields.map((field, fieldIndex) => (
              <div
                key={fieldIndex}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3 px-2 py-1.5 odd:bg-slate-50"
              >
                <dt className="text-slate-500">{field.label}</dt>
                <dd className="font-medium text-slate-700">
                  {/fecha/i.test(field.label)
                    ? formatClinicalAntecedentDate(field.value)
                    : field.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    {!!detail.indications?.length && (
      <section>
        <h5 className="mb-1 font-semibold text-teal-800">Indicaciones</h5>
        <ul className="list-disc space-y-1 pl-4">
          {detail.indications.map((indication, index) => (
            <li key={index}>{indication}</li>
          ))}
        </ul>
      </section>
    )}
    {detail.careType === 'outpatient' && !!detail.prescriptions?.length && (
      <section>
        <h5 className="mb-1 font-semibold text-teal-800">Prescripciones</h5>
        {detail.prescriptions.map((recipe, index) => (
          <PrescriptionCopy
            key={`${entry.source}:${entry.id}:${detail.patientName}:${recipe.id}:${index}`}
            recipe={recipe}
            detail={detail}
            entry={entry}
          />
        ))}
      </section>
    )}
  </div>
);
