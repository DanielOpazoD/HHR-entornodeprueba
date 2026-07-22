import React from 'react';
import { CheckCircle2, CircleHelp, CircleMinus } from 'lucide-react';
import type {
  DischargeVerification,
  DischargeVerificationState,
} from '../contracts/censusImportDiff';

/** ISO "YYYY-MM-DD" → "DD-MM-YYYY" for display in the sync dialog. */
export const ddmmyyyy = (iso?: string): string => {
  const match = (iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : (iso ?? '');
};

interface ChipProps {
  label: string;
  value: number;
  tone: 'green' | 'blue' | 'amber' | 'gray' | 'red' | 'teal' | 'indigo';
}

const tones: Record<ChipProps['tone'], string> = {
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-800',
  gray: 'bg-gray-100 text-gray-700',
  red: 'bg-red-100 text-red-800',
  teal: 'bg-teal-100 text-teal-800',
  indigo: 'bg-indigo-100 text-indigo-800',
};

export const Chip: React.FC<ChipProps> = ({ label, value, tone }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${tones[tone]}`}
  >
    <span className="font-bold tabular-nums">{value}</span>
    {label}
  </span>
);

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
