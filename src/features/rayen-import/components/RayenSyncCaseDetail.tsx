import React from 'react';
import type { RayenSyncCaseContext, RayenSyncDiagnosticContext } from '@/types/domain/rayenSync';

export const RayenSyncCaseDetail: React.FC<{
  diagnostic?: RayenSyncDiagnosticContext;
  caseContext?: RayenSyncCaseContext;
  bedId?: string | null;
}> = ({ diagnostic, caseContext, bedId }) => {
  const name = diagnostic?.patientName || caseContext?.patientName;
  const bed = diagnostic?.bedId || caseContext?.bedId || bedId;
  return (
    <div className="mb-1">
      <p className="font-semibold text-slate-900">
        {name || 'Paciente no identificado en este registro'}
        {' · '}
        {bed && bed !== '*' ? `Cama ${bed}` : 'Cama no registrada'}
      </p>
      <p className="text-slate-700">Documento: {diagnostic?.document || 'no registrado'}</p>
      {!name && (
        <p>
          Este intento antiguo no guardó la identidad; no se asigna el paciente que ocupa hoy la
          cama.
        </p>
      )}
      {diagnostic?.detail && <p className="mt-1">Qué ocurrió: {diagnostic.detail}</p>}
      {diagnostic?.sourceTimestamp && (
        <p className="mt-1">
          Fecha informada por la fuente: {diagnostic.sourceTimestamp}
          {diagnostic.sourceClinicalDay
            ? ` · corresponde al censo ${diagnostic.sourceClinicalDay}`
            : ''}
          .
        </p>
      )}
    </div>
  );
};
