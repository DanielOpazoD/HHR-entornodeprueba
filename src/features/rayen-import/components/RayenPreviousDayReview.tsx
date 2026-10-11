import React from 'react';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { ddmmyyyy } from './RayenImportDiffReviewParts';
export const RayenPreviousDayReview: React.FC<{
  edits: NonNullable<CensusImportDiff['previousDayEdits']>;
  hasActionablePreviousDayEdit: boolean;
  accepted: boolean;
  onChange: (accepted: boolean) => void;
}> = ({ edits, hasActionablePreviousDayEdit, accepted, onChange }) => (
  <>
    {edits.length > 0 && (
      <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
        <h4 className="mb-1 text-sm font-semibold text-amber-800">
          Modificar días previos ({edits.length})
        </h4>
        <p className="mb-2 text-xs text-amber-700">
          Los ingresos de madrugada pertenecen al turno noche anterior y los egresos conservan su
          día clínico oficial. Se registrarán los movimientos pendientes y se retirarán las
          ocupaciones incompatibles con egresos ya registrados, sin duplicarlos.
        </p>
        <ul className="space-y-1 text-sm text-amber-900">
          {edits.map(edit => (
            <li key={`${edit.day}-${edit.reason}`}>
              <span className="font-semibold tabular-nums">{ddmmyyyy(edit.day)}</span> —{' '}
              <span className="font-medium">
                {edit.reason === 'admission-night-shift-correction'
                  ? 'Ingreso turno noche: '
                  : 'Conciliar egreso: '}
              </span>
              {edit.patientNames.length > 0
                ? edit.patientNames.join(', ')
                : 'sin cambios aplicables'}
              {!edit.withinEditingWindow && (
                <span className="ml-1 font-medium text-red-600">
                  (requiere administrador — se omitirá)
                </span>
              )}
              {edit.isSigned && (
                <span className="ml-1 font-medium text-red-600">(día ya firmado — se omitirá)</span>
              )}
              {!edit.recordExists && (
                <span className="ml-1 font-medium text-red-600">
                  (no existe registro para ese día — se omitirá)
                </span>
              )}
              {(edit.omittedAdmissions ?? []).map(omission => (
                <div
                  key={`${edit.day}-om-${omission.patientName}`}
                  className="ml-4 font-medium text-red-600"
                >
                  ↳ {omission.patientName}: {omission.reason} — se omitirá
                </div>
              ))}
            </li>
          ))}
        </ul>
        {hasActionablePreviousDayEdit && (
          <label className="mt-2 flex items-center gap-2 text-sm font-medium text-amber-900">
            <input
              type="checkbox"
              checked={accepted}
              onChange={event => onChange(event.target.checked)}
              className="h-4 w-4"
            />
            Acepto modificar los días previos indicados
          </label>
        )}
      </div>
    )}
  </>
);
