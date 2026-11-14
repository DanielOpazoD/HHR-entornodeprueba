import React from 'react';
import { CheckCircle2, CircleHelp, CircleMinus } from 'lucide-react';
import type {
  ConflictEntry,
  DischargeVerification,
  DischargeVerificationState,
} from '../contracts/censusImportDiff';
import { SYNC_TONE } from './syncTone';

/** ISO "YYYY-MM-DD" → "DD-MM-YYYY" for display in the sync dialog. */
export const ddmmyyyy = (iso?: string): string => {
  const match = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : (iso ?? '');
};

export const Section: React.FC<{
  title: string;
  count: number;
  children: React.ReactNode;
}> = ({ title, count, children }) => {
  if (count === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="mb-1 text-sm font-semibold text-gray-700">
        {title} <span className="text-gray-400">({count})</span>
      </h4>
      <ul className="space-y-1 text-sm text-gray-600">{children}</ul>
    </div>
  );
};

export const HistoricalReconstructionReview: React.FC<{
  conflicts: ConflictEntry[];
}> = ({ conflicts }) => {
  if (conflicts.length === 0) return null;
  return (
    <div className={`mt-4 rounded-lg border px-3 py-2.5 ${SYNC_TONE.review.surface}`}>
      <h4 className="text-sm font-semibold">
        {conflicts.length} {conflicts.length === 1 ? 'paciente quedó' : 'pacientes quedaron'} sin
        cambios
      </h4>
      <p className={`mt-1 text-xs leading-relaxed ${SYNC_TONE.review.text}`}>
        La trazabilidad disponible no permitió confirmar su cama al cierre del turno. El sistema no
        modificará esos pacientes; los demás cambios verificados sí pueden aplicarse.
      </p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer font-medium">
          Ver pacientes que requieren revisión
        </summary>
        <ul className="mt-2 space-y-1 pl-4">
          {conflicts.map((entry, index) => (
            <li key={`historical-review-${index}-${entry.rut || entry.patientName || ''}`}>
              <span className="font-medium">{entry.patientName || entry.rut || 'Paciente'}</span>
              {entry.bedId ? ` · ${entry.bedId}` : ''}
              <span className={`block text-xs ${SYNC_TONE.review.text}`}>{entry.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};

const verificationPresentation: Record<
  DischargeVerificationState,
  { Icon: typeof CheckCircle2; className: string; suffix: string }
> = {
  confirmed: {
    Icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    suffix: 'confirmado',
  },
  'not-detected': {
    Icon: CircleMinus,
    className: 'border-slate-200 bg-slate-50 text-slate-500',
    suffix: 'no detectado',
  },
  unknown: {
    Icon: CircleHelp,
    className: 'border-slate-200 bg-white text-slate-500',
    suffix: 'sin dato',
  },
};

export const VerificationBadges: React.FC<{ verification: DischargeVerification }> = ({
  verification,
}) => {
  const items = [
    ['Epicrisis médica', verification.medicalEpicrisis],
    ['Epicrisis enfermería', verification.nursingEpicrisis],
    ['Egreso hospitalario', verification.hospitalDischarge],
  ] as const;
  return (
    <div
      className="mt-1 flex flex-wrap gap-1.5"
      role="group"
      aria-label="Verificación documental del egreso"
    >
      {items.map(([label, state]) => {
        const { Icon, className, suffix } = verificationPresentation[state];
        return (
          <span
            key={label}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${className}`}
            title={`${label}: ${suffix}`}
          >
            <Icon size={13} aria-hidden="true" />
            <span>{label}</span>
            <span className="sr-only">: {suffix}</span>
          </span>
        );
      })}
    </div>
  );
};
