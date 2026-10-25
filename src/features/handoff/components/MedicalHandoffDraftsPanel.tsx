import React from 'react';
import { useMedicalHandoffDrafts } from '@/hooks/useMedicalHandoffDraft';
import { MedicalHandoffDraftReview } from './MedicalHandoffDraftReview';
export const MedicalHandoffDraftsPanel: React.FC<{ date: string }> = ({ date }) => {
  const drafts = useMedicalHandoffDrafts().filter(draft => draft.date === date);
  if (!drafts.length) return null;
  return (
    <details className="p-2 text-xs text-amber-800 print:hidden">
      <summary>Revisar borradores de entrega ({drafts.length})</summary>
      <p>Copias pendientes del paciente y episodio originales. No se reenvían automáticamente.</p>
      {drafts.map(draft => (
        <MedicalHandoffDraftReview key={draft.key} draft={draft} />
      ))}
    </details>
  );
};
