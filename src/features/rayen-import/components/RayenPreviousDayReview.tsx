import React from 'react';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import { ddmmyyyy } from './RayenImportDiffReviewParts';
import { SYNC_TONE } from './syncTone';

// What will not be applied stays readable at a glance by weight and wording, not by alarm red.
const omitted = `ml-1 ${SYNC_TONE.action.text}`;
export const RayenPreviousDayReview: React.FC<{
  edits: NonNullable<CensusImportDiff['previousDayEdits']>;
  hasActionablePreviousDayEdit: boolean;
  accepted: boolean;
  onChange: (accepted: boolean) => void;
}> = ({ edits, hasActionablePreviousDayEdit, accepted, onChange }) => (
  <>
    {edits.length > 0 && (
      <div className={`mt-4 rounded-lg border p-3 ${SYNC_TONE.review.surface}`}>
        <h4 className="mb-1 text-sm font-semibold">Modificar días previos ({edits.length})</h4>
        <p className={`mb-2 text-xs ${SYNC_TONE.review.text}`}>
          Los ingresos de madrugada pertenecen al turno noche anterior y los egresos conservan su
          día clínico oficial. Se registrarán los movimientos pendientes y se retirarán las
          ocupaciones incompatibles con egresos ya registrados, sin duplicarlos.
        </p>
        <ul className="space-y-1 text-sm">
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
                <span className={omitted}>(requiere administrador — se omitirá)</span>
              )}
              {edit.isSigned && <span className={omitted}>(día ya firmado — se omitirá)</span>}
              {!edit.recordExists && (
                <span className={omitted}>(no existe registro para ese día — se omitirá)</span>
              )}
              {(edit.omittedAdmissions ?? []).map(omission => (
                <div
                  key={`${edit.day}-om-${omission.patientName}`}
                  className={`ml-4 ${SYNC_TONE.action.text}`}
                >
                  ↳ {omission.patientName}: {omission.reason} — se omitirá
                </div>
              ))}
            </li>
          ))}
        </ul>
        {hasActionablePreviousDayEdit && (
          <label className="mt-2 flex items-center gap-2 text-sm font-medium">
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
