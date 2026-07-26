import React from 'react';
import { Biohazard } from 'lucide-react';

interface IsolationBadgeProps {
  isolationType?: string;
  microorganism?: string;
}

export const resolveIsolationDescription = (
  isolationType?: string,
  microorganism?: string
): string => {
  const type = isolationType?.trim();
  const organism = microorganism?.trim();
  if (type && organism) return `Aislamiento: ${type} · ${organism}`;
  if (type) return `Aislamiento: ${type}`;
  if (organism) return `Aislamiento activo · ${organism}`;
  return 'Aislamiento activo · tipo no informado por Eloísa';
};

export const IsolationBadge: React.FC<IsolationBadgeProps> = ({ isolationType, microorganism }) => {
  const description = resolveIsolationDescription(isolationType, microorganism);

  return (
    <span
      className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1 py-px text-[8px] font-bold uppercase leading-none text-amber-700 ring-1 ring-amber-300"
      title={description}
      aria-label={description}
    >
      <Biohazard size={9} strokeWidth={2.5} aria-hidden="true" />
      Aisl.
    </span>
  );
};
