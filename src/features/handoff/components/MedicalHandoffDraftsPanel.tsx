import React from 'react';
import { useMedicalHandoffDrafts } from '@/hooks/useMedicalHandoffDraft';
export const MedicalHandoffDraftsPanel: React.FC<{ date: string }> = ({ date }) => {
  const drafts = useMedicalHandoffDrafts().filter(draft => draft.date === date);
  if (!drafts.length) return null;
  return (
    <details className="p-2 text-xs text-amber-800 print:hidden">
      <summary>Revisar borradores de entrega ({drafts.length})</summary>
      <p>
        Copias locales vinculadas al paciente y episodio originales. No se reenvían automáticamente.
      </p>
      {drafts.map(draft => (
        <div key={draft.key}>
          <p>
            {draft.patientName} · {draft.documentType} {draft.rut} · Episodio{' '}
            {draft.clinicalEpisodeId}
          </p>
          <pre className="whitespace-pre-wrap">{draft.value}</pre>
        </div>
      ))}
    </details>
  );
};
