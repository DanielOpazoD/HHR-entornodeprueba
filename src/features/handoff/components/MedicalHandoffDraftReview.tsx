import React from 'react';
import {
  type MedicalHandoffDraft,
  deleteMedicalHandoffDraft,
  restoreMedicalHandoffDraft,
} from '@/hooks/useMedicalHandoffDraft';

export const MedicalHandoffDraftReview: React.FC<{ draft: MedicalHandoffDraft }> = ({ draft }) => {
  const [unavailable, setUnavailable] = React.useState(false);
  return (
    <div>
      <p>
        {draft.patientName} · {draft.documentType} {draft.rut} · Episodio {draft.clinicalEpisodeId}
      </p>
      <pre className="whitespace-pre-wrap">{draft.value}</pre>
      {unavailable && (
        <p role="status">
          No se puede guardar: el paciente, episodio o entrada original no está disponible para
          editar. Conserva el texto para revisión.
        </p>
      )}
      <button type="button" onClick={() => setUnavailable(!restoreMedicalHandoffDraft(draft.key))}>
        Restaurar y guardar borrador
      </button>
      <button type="button" onClick={() => deleteMedicalHandoffDraft(draft.key)}>
        Descartar borrador
      </button>
    </div>
  );
};
