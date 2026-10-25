import React from 'react';
import {
  type MedicalHandoffDraft,
  discardMedicalHandoffDraft,
} from '@/hooks/useMedicalHandoffDraft';

/** Two steps, so a draft is never discarded by a single stray click. */
export const ConfirmDiscardButton: React.FC<{ label: string; onConfirm: () => void }> = ({
  label,
  onConfirm,
}) => {
  const [asking, setAsking] = React.useState(false);
  return asking ? (
    <span>
      ¿Descartar definitivamente?{' '}
      <button type="button" onClick={onConfirm}>
        Sí, descartar
      </button>{' '}
      <button type="button" onClick={() => setAsking(false)}>
        Cancelar
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setAsking(true)}>
      {label}
    </button>
  );
};

const formatDraftDate = (date: string) => date.split('-').reverse().join('-');

export const MedicalHandoffDraftReview: React.FC<{
  draft: MedicalHandoffDraft;
  /** Only an editor of the same date, patient, episode and entry can take the text back. */
  onRestore?: () => void;
}> = ({ draft, onRestore }) => {
  const [changed, setChanged] = React.useState(false);
  return (
    <div className="mt-1 rounded border border-amber-200 bg-amber-50 p-1.5">
      <p className="font-semibold">
        Nota de entrega de {draft.patientName || 'paciente sin nombre'} ·{' '}
        {formatDraftDate(draft.date)}
      </p>
      <p>
        {draft.documentType} {draft.rut} · Episodio {draft.clinicalEpisodeId}
      </p>
      <pre className="whitespace-pre-wrap font-sans">{draft.value}</pre>
      <p role="status">
        {changed
          ? 'El borrador cambió en otra pestaña; revísalo de nuevo.'
          : draft.durable
            ? 'Sin confirmar en el servidor. No se reenvía solo.'
            : 'Solo en memoria: copia el texto antes de cerrar o cambiar de sesión.'}
      </p>
      {onRestore ? (
        <button type="button" onClick={onRestore}>
          Restaurar y guardar borrador
        </button>
      ) : (
        <p>Solo se puede restaurar en la entrega de ese día, para ese paciente y episodio.</p>
      )}{' '}
      <ConfirmDiscardButton
        label="Descartar borrador"
        onConfirm={() => setChanged(!discardMedicalHandoffDraft(draft))}
      />
    </div>
  );
};
