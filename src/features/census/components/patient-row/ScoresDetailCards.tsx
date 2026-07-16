/**
 * Summary cards for the census "Scores" detail modal: one card per scale (Braden UPP · Downton falls
 * · CUDYR) with a colored left accent, the big score number colored by risk level, a risk badge and a
 * reapplication countdown pill. Extracted from `ScoresDetailModal` to keep each module small.
 */

import React from 'react';
import clsx from 'clsx';
import { AlarmClock, Bandage, CalendarClock, Footprints, Layers3 } from 'lucide-react';
import type {
  BradenCellModel,
  CudyrCellModel,
  DowntonCellModel,
} from '@/features/census/controllers/evaluationScoresCellController';
import { CUDYR_BAND, NEUTRAL_TOKENS, formatIsoDay, tokensFor } from './scoresDetailTokens';

const formatCudyrTime = (value?: string): string => {
  const epoch = Date.parse(value ?? '');
  if (Number.isNaN(epoch)) return '';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'Pacific/Easter',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epoch));
};

/** Small reapplication pill: green "en Nd", red "Reaplicar hoy"/"vencida". */
const ReapplyPill: React.FC<{ label: string; urgent: boolean }> = ({ label, urgent }) => (
  <span
    className={clsx(
      'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
      urgent ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
    )}
  >
    {urgent ? <AlarmClock size={11} strokeWidth={2.5} /> : <CalendarClock size={11} />}
    {label}
  </span>
);

interface ScoreCardProps {
  icon: React.ReactNode;
  name: string;
  sub: string;
  value: string;
  valueClass: string;
  accentClass: string;
  badge: React.ReactNode;
  recordedDate: string;
  footer?: React.ReactNode;
}

/** One summary card: colored left accent, big value, risk badge, reapplication footer. */
const ScoreCard: React.FC<ScoreCardProps> = ({
  icon,
  name,
  sub,
  value,
  valueClass,
  accentClass,
  badge,
  recordedDate,
  footer,
}) => (
  <div
    className={clsx(
      'flex min-w-[150px] flex-1 flex-col gap-1.5 rounded-lg border border-slate-200 border-l-4 bg-white p-3',
      accentClass
    )}
  >
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-center gap-1.5 text-slate-600">
        {icon}
        <div className="leading-tight">
          <div className="text-xs font-semibold text-slate-700">{name}</div>
          <div className="text-[10px] text-slate-400">{sub}</div>
        </div>
      </div>
      {badge}
    </div>
    <div className="flex items-baseline gap-1.5">
      <span className={clsx('text-3xl font-bold tabular-nums', valueClass)}>{value}</span>
    </div>
    <div className="text-[10px] text-slate-400">Realizada el {formatIsoDay(recordedDate)}</div>
    {footer}
  </div>
);

const Badge: React.FC<{ className: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <span
    className={clsx(
      'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
      className
    )}
  >
    {children}
  </span>
);

export const BradenCard: React.FC<{ braden: BradenCellModel }> = ({ braden }) => {
  const t = tokensFor(braden.assessment.riskLevel);
  return (
    <ScoreCard
      icon={<Bandage size={16} />}
      name="Braden"
      sub="Riesgo UPP"
      value={String(braden.total)}
      valueClass={t.number}
      accentClass={t.accent}
      badge={<Badge className={t.chip}>{braden.assessment.conducta.riskLabel}</Badge>}
      recordedDate={braden.entry.recordedDate}
      footer={
        braden.countdownLabel ? (
          <ReapplyPill
            label={braden.countdownLabel}
            urgent={braden.assessment.reapplication.urgency !== 'ok'}
          />
        ) : undefined
      }
    />
  );
};

export const DowntonCard: React.FC<{ downton: DowntonCellModel }> = ({ downton }) => {
  const t = tokensFor(downton.level);
  return (
    <ScoreCard
      icon={<Footprints size={16} />}
      name="Downton"
      sub="Riesgo de caídas"
      value={String(downton.total)}
      valueClass={t.number}
      accentClass={t.accent}
      badge={<Badge className={t.chip}>{downton.severityLabel || 'Sin interpretación'}</Badge>}
      recordedDate={downton.entry.recordedDate}
      footer={
        downton.reapplication && downton.countdownLabel ? (
          <ReapplyPill
            label={downton.countdownLabel}
            urgent={downton.reapplication.urgency !== 'ok'}
          />
        ) : undefined
      }
    />
  );
};

export const CudyrCard: React.FC<{ cudyr: CudyrCellModel }> = ({ cudyr }) => {
  const t = cudyr.band
    ? CUDYR_BAND[cudyr.band]
    : { chip: NEUTRAL_TOKENS.chip, accent: NEUTRAL_TOKENS.accent, number: NEUTRAL_TOKENS.number };
  return (
    <ScoreCard
      icon={<Layers3 size={16} />}
      name="CUDYR"
      sub="Riesgo y dependencia"
      value={cudyr.category}
      valueClass={t.number}
      accentClass={t.accent}
      badge={
        <Badge className={t.chip}>
          {cudyr.entry.source.includes('Gestión de Camas') ? 'Gestión de Camas' : 'Ficha Médico'}
        </Badge>
      }
      recordedDate={cudyr.entry.recordedDate}
      footer={
        cudyr.entry.author || cudyr.entry.authorRole || cudyr.entry.recordedAt ? (
          <div className="text-[10px] text-slate-500">
            {[formatCudyrTime(cudyr.entry.recordedAt), cudyr.entry.author, cudyr.entry.authorRole]
              .filter(Boolean)
              .join(' · ')}
          </div>
        ) : undefined
      }
    />
  );
};
