/**
 * Detail modal for the census "Scores" column — a clean, at-a-glance report of the nursing risk
 * scales synced from Ficha Médico:
 *   1. an alert strip when any scale is due/overdue for reapplication,
 *   2. a grid of summary cards (Braden UPP · Downton falls · CUDYR) with the score colored by risk
 *      level and its reapplication countdown,
 *   3. the Braden "conducta" (planned care by risk level),
 *   4. the CUDYR imported-from-Eloísa note, and
 *   5. a per-scale history timeline (colored dots over the hospitalization) with a legend.
 * Informational only: the scales are recorded in Ficha Médico and synced here.
 */

import React from 'react';
import clsx from 'clsx';
import {
  Activity,
  AlarmClock,
  Bandage,
  CalendarClock,
  ClipboardList,
  Footprints,
  History,
  Info,
  Layers3,
} from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type {
  BradenCellModel,
  CudyrCellModel,
  DowntonCellModel,
  ScoresCellModel,
} from '@/features/census/controllers/evaluationScoresCellController';
import type { BradenRiskLevel, EvaluationScoreEntry } from '@/types/domain/evaluationScores';

interface ScoresDetailModalProps {
  patientName: string;
  model: ScoresCellModel;
  onClose: () => void;
}

/** One risk-level's palette, reused across chips, big numbers, accents and timeline dots. */
interface LevelTokens {
  chip: string;
  accent: string;
  number: string;
  dot: string;
  soft: string;
  label: string;
}

const LEVEL_TOKENS: Record<BradenRiskLevel, LevelTokens> = {
  bajo: {
    chip: 'bg-emerald-100 text-emerald-800',
    accent: 'border-l-emerald-400',
    number: 'text-emerald-700',
    dot: 'bg-emerald-500',
    soft: 'bg-emerald-50 text-emerald-700',
    label: 'Riesgo bajo',
  },
  medio: {
    chip: 'bg-amber-100 text-amber-800',
    accent: 'border-l-amber-400',
    number: 'text-amber-700',
    dot: 'bg-amber-500',
    soft: 'bg-amber-50 text-amber-700',
    label: 'Riesgo medio',
  },
  alto: {
    chip: 'bg-red-100 text-red-800',
    accent: 'border-l-red-400',
    number: 'text-red-700',
    dot: 'bg-red-500',
    soft: 'bg-red-50 text-red-700',
    label: 'Riesgo alto',
  },
};

const NEUTRAL_TOKENS: LevelTokens = {
  chip: 'bg-slate-100 text-slate-600',
  accent: 'border-l-slate-300',
  number: 'text-slate-700',
  dot: 'bg-slate-400',
  soft: 'bg-slate-50 text-slate-600',
  label: 'Sin interpretación',
};

// CUDYR category band → color (A highest acuity → D lowest), matching the census cell chip.
const CUDYR_BAND: Record<'A' | 'B' | 'C' | 'D', { chip: string; accent: string; number: string }> =
  {
    A: { chip: 'bg-rose-100 text-rose-800', accent: 'border-l-rose-400', number: 'text-rose-700' },
    B: {
      chip: 'bg-amber-100 text-amber-800',
      accent: 'border-l-amber-400',
      number: 'text-amber-700',
    },
    C: { chip: 'bg-sky-100 text-sky-800', accent: 'border-l-sky-400', number: 'text-sky-700' },
    D: {
      chip: 'bg-emerald-100 text-emerald-800',
      accent: 'border-l-emerald-400',
      number: 'text-emerald-700',
    },
  };

const tokensFor = (level: BradenRiskLevel | null): LevelTokens =>
  level ? LEVEL_TOKENS[level] : NEUTRAL_TOKENS;

const formatIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-');
  return year && month && day ? `${day}-${month}-${year}` : isoDay;
};

/** Derive a risk level from a source severity text ("Riesgo alto" → 'alto') for history coloring. */
const severityLevel = (severity: string | null): BradenRiskLevel | null => {
  const value = (severity ?? '').toLowerCase();
  if (value.includes('alto')) return 'alto';
  if (value.includes('medio') || value.includes('moderad')) return 'medio';
  if (value.includes('bajo')) return 'bajo';
  return null;
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

const BradenCard: React.FC<{ braden: BradenCellModel }> = ({ braden }) => {
  const level = braden.assessment.riskLevel;
  const t = tokensFor(level);
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

const DowntonCard: React.FC<{ downton: DowntonCellModel }> = ({ downton }) => {
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

const CudyrCard: React.FC<{ cudyr: CudyrCellModel }> = ({ cudyr }) => {
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
      badge={<Badge className={t.chip}>Importado</Badge>}
      recordedDate={cudyr.entry.recordedDate}
    />
  );
};

/** Prominent strip when any scale needs reapplication, so it's the first thing the nurse sees. */
const ReapplyAlert: React.FC<{ model: ScoresCellModel }> = ({ model }) => {
  const items: string[] = [];
  if (model.braden?.assessment.reapplication.urgency !== 'ok' && model.braden?.countdownLabel) {
    items.push(`Braden: ${model.braden.countdownLabel.toLowerCase()}`);
  }
  if (
    model.downton?.reapplication &&
    model.downton.reapplication.urgency !== 'ok' &&
    model.downton.countdownLabel
  ) {
    items.push(`Downton: ${model.downton.countdownLabel.toLowerCase()}`);
  }
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-200">
      <AlarmClock size={16} className="shrink-0 animate-pulse" />
      <span>{items.join(' · ')}</span>
    </div>
  );
};

const BradenConducta: React.FC<{ braden: BradenCellModel }> = ({ braden }) => {
  const { conducta, reapplication } = braden.assessment;
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <ClipboardList size={13} /> Cuidados planeados según riesgo de LPP
        </h4>
        <span className="text-[11px] text-slate-400">
          {conducta.aplicacion} · próxima {formatIsoDay(reapplication.dueDate)}
        </span>
      </div>
      <ul className="space-y-1 text-xs text-slate-600">
        {conducta.cuidados.map(cuidado => (
          <li key={cuidado} className="flex items-start gap-1.5">
            <span
              className={clsx(
                'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                tokensFor(braden.assessment.riskLevel).dot
              )}
            />
            {cuidado}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-slate-400">Cada intervención debe tener su registro.</p>
    </section>
  );
};

const CudyrNote: React.FC<{ cudyr: CudyrCellModel }> = ({ cudyr }) => (
  <div className="flex items-start gap-2 rounded-lg bg-indigo-50/70 px-3 py-2 text-[11px] text-indigo-700 ring-1 ring-indigo-100">
    <Info size={13} className="mt-px shrink-0" />
    <span>
      CUDYR importado desde <strong>{cudyr.entry.source}</strong>: Eloísa entrega solo la categoría
      compuesta, por eso no se muestra el valor de cada variable.
    </span>
  </div>
);

/** History as a per-scale timeline of colored dots (oldest → newest) plus a legend. */
const HistoryTimeline: React.FC<{ history: EvaluationScoreEntry[] }> = ({ history }) => {
  const byCode = (code: 'BRADEN' | 'DOWNTON') =>
    history
      .filter(entry => entry.code === code)
      .slice()
      .sort((a, b) => a.encounterEventId - b.encounterEventId);

  const rows: Array<{ label: string; entries: EvaluationScoreEntry[] }> = [
    { label: 'Braden (UPP)', entries: byCode('BRADEN') },
    { label: 'Downton (caídas)', entries: byCode('DOWNTON') },
  ].filter(row => row.entries.length > 0);

  if (rows.length === 0) return null;

  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <History size={13} /> Evolución durante la hospitalización
        </h4>
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          {(['bajo', 'medio', 'alto'] as BradenRiskLevel[]).map(level => (
            <span key={level} className="flex items-center gap-1">
              <span className={clsx('h-2 w-2 rounded-full', LEVEL_TOKENS[level].dot)} />
              {level}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.label} className="flex items-center gap-2">
            <span className="w-28 shrink-0 text-[11px] font-medium text-slate-500">
              {row.label}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {row.entries.map(entry => {
                const t = tokensFor(severityLevel(entry.severity));
                return (
                  <span
                    key={entry.encounterEventId}
                    className={clsx(
                      'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-bold tabular-nums text-white',
                      t.dot
                    )}
                    title={`${formatIsoDay(entry.recordedDate)} · ${entry.severity ?? 's/inter.'}`}
                  >
                    {entry.total ?? '—'}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

export const ScoresDetailModal: React.FC<ScoresDetailModalProps> = ({
  patientName,
  model,
  onClose,
}) => (
  <BaseModal
    isOpen
    onClose={onClose}
    title={`Escalas de enfermería — ${patientName}`}
    icon={<Activity size={18} />}
    size="lg"
    dataModule="census-scores"
  >
    <div className="space-y-3">
      <ReapplyAlert model={model} />

      {(model.braden || model.downton || model.cudyr) && (
        <div className="flex flex-wrap gap-2">
          {model.braden && <BradenCard braden={model.braden} />}
          {model.downton && <DowntonCard downton={model.downton} />}
          {model.cudyr && <CudyrCard cudyr={model.cudyr} />}
        </div>
      )}

      {model.braden && <BradenConducta braden={model.braden} />}
      {model.cudyr && <CudyrNote cudyr={model.cudyr} />}

      {!model.braden && !model.downton && !model.cudyr && (
        <p className="text-sm text-slate-500">Sin escalas sincronizadas para este día.</p>
      )}

      <HistoryTimeline history={model.history} />
    </div>
  </BaseModal>
);
