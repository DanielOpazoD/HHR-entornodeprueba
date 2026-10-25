import React from 'react';
import {
  hasMountedMedicalHandoffEditor,
  useMedicalHandoffDrafts,
} from '@/hooks/useMedicalHandoffDraft';
import { MedicalHandoffDraftReview } from './MedicalHandoffDraftReview';

/** Unconfirmed notes no editor on screen can take: patient or entry gone, or another date. */
export const MedicalHandoffDraftsPanel: React.FC = () => {
  const drafts = useMedicalHandoffDrafts()
    .filter(draft => !hasMountedMedicalHandoffEditor(draft.key))
    .sort((left, right) => right.date.localeCompare(left.date));
  if (!drafts.length) return null;
  return (
    <details className="p-2 text-xs text-amber-800 print:hidden">
      <summary>Revisar borradores de entrega ({drafts.length})</summary>
      <p>Textos sin confirmar en el servidor. No se envían solos ni pasan a otro paciente o día.</p>
      {drafts.map(draft => (
        <MedicalHandoffDraftReview key={draft.slot} draft={draft} />
      ))}
    </details>
  );
};
