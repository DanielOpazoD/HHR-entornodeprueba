import React from 'react';
import clsx from 'clsx';
import { Info } from 'lucide-react';
import type { InfusionPreset } from '../../domain/infusionPresets';
import { TONE_BADGE_CLASSES } from '../../controllers/libraryPresentation';
import type { InfusionPresentation } from '../../controllers/infusionPresentation';

const RANGE_TONE = { within: 'success', below: 'info', above: 'warning', unknown: 'info' } as const;

interface InfusionResultPanelProps {
  presentation: InfusionPresentation;
  preset: InfusionPreset | null;
}

export const InfusionResultPanel: React.FC<InfusionResultPanelProps> = ({
  presentation,
  preset,
}) => (
  <div className="mt-3" role="status" aria-live="polite" data-testid="infusion-result">
    {presentation.kind === 'idle' && (
      <p className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-500">
        {presentation.message}
      </p>
    )}
    {presentation.kind === 'error' && (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
        {presentation.message}
      </p>
    )}
    {presentation.kind === 'result' && (
      <div className="rounded-lg border border-medical-200 bg-medical-50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-medical-700">
          {presentation.primaryUnit === 'mL/h' ? 'Velocidad de la bomba' : 'Dosis equivalente'}
        </p>
        <p
          data-testid="infusion-primary-value"
          className="mt-0.5 text-3xl font-bold tabular-nums leading-none text-medical-900"
        >
          {presentation.primaryValue}
          <span className="ml-1.5 text-sm font-semibold text-medical-700">
            {presentation.primaryUnit}
          </span>
        </p>
        <p className="mt-2 text-[11px] tabular-nums text-medical-900/80">
          {presentation.concentrationLabel}
        </p>
        <ul className="mt-1 space-y-0.5 text-[11px] tabular-nums text-medical-900/70">
          {presentation.equivalents.map(item => (
            <li key={item}>≈ {item}</li>
          ))}
        </ul>
        {presentation.range && (
          <p
            data-testid="infusion-range"
            data-assessment={presentation.range.assessment}
            className={clsx(
              'mt-2 rounded-md border px-2 py-1.5 text-[11px] font-semibold',
              TONE_BADGE_CLASSES[RANGE_TONE[presentation.range.assessment]]
            )}
          >
            {presentation.range.label}
            {presentation.range.note && (
              <span className="mt-0.5 block font-normal">{presentation.range.note}</span>
            )}
          </p>
        )}
      </div>
    )}
    {preset && preset.notes.length > 0 && (
      <ul className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
        {preset.notes.map(note => (
          <li key={note} className="flex items-start gap-1.5">
            <Info size={12} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span>{note}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);
