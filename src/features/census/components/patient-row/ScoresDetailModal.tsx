/**
 * Detail modal for the census "Scores" column — a clean, at-a-glance report of the nursing risk
 * scales synced from Ficha Médico:
 *   1. an alert strip when any scale is due/overdue for reapplication,
 *   2. a grid of summary cards (Braden UPP · Downton falls · CUDYR) — see `ScoresDetailCards`,
 *   3. the Braden "conducta" (planned care by risk level),
 *   4. the CUDYR imported-from-Eloísa note, and
 *   5. a per-scale history timeline (colored dots over the hospitalization) with a legend.
 * Informational only: the scales are recorded in Ficha Médico and synced here.
 */

import React from 'react';
import clsx from 'clsx';
import { Activity, AlarmClock, ClipboardList, History, Info } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type {
  BradenCellModel,
  CudyrCellModel,
  ScoresCellModel,
} from '@/features/census/controllers/evaluationScoresCellController';
import type { BradenRiskLevel, EvaluationScoreEntry } from '@/types/domain/evaluationScores';
import { BradenCard, CudyrCard, DowntonCard } from './ScoresDetailCards';
import { LEVEL_TOKENS, formatIsoDay, severityLevel, tokensFor } from './scoresDetailTokens';

interface ScoresDetailModalProps {
  patientName: string;
  model: ScoresCellModel;
  onClose: () => void;
}

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
