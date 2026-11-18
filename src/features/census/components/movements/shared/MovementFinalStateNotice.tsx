import React from 'react';
import clsx from 'clsx';
import { CheckCircle2 } from 'lucide-react';

interface MovementFinalStateNoticeProps {
  children: React.ReactNode;
  tone: 'emerald' | 'blue';
}

const resolveToneClassName = (tone: MovementFinalStateNoticeProps['tone']): string =>
  tone === 'blue'
    ? 'border-blue-100 bg-blue-50/70 text-blue-900'
    : 'border-emerald-100 bg-emerald-50/70 text-emerald-900';

const resolveIconClassName = (tone: MovementFinalStateNoticeProps['tone']): string =>
  tone === 'blue' ? 'text-blue-600' : 'text-emerald-600';

export const MovementFinalStateNotice: React.FC<MovementFinalStateNoticeProps> = ({
  children,
  tone,
}) => (
  <div
    className={clsx(
      'rounded-lg border px-3 py-2.5 flex items-start gap-2.5',
      resolveToneClassName(tone)
    )}
  >
    <CheckCircle2 size={15} className={clsx('mt-0.5 shrink-0', resolveIconClassName(tone))} />
    <div className="space-y-0.5">
      <p className="text-[10px] font-bold uppercase tracking-widest">Estado final</p>
      <p className="text-xs leading-relaxed text-slate-700">{children}</p>
    </div>
  </div>
);
