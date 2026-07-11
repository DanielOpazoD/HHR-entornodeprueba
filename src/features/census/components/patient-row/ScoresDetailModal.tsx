/**
 * Detail modal for the census "Scores" column: current Braden (UPP) assessment with its conducta —
 * planned care and the reapplication countdown ("faltan X días" → "Reaplicar hoy" → overdue) —
 * plus the Downton (falls) severity and the unified risk history over the hospitalization.
 * Informational only: the scales are recorded in Ficha Médico and synced here.
 */

import React from 'react';
import clsx from 'clsx';
import { Activity, AlarmClock, CalendarClock, ClipboardList, History, Info } from 'lucide-react';
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

const LEVEL_BADGE_CLASSES: Record<BradenRiskLevel, string> = {
  bajo: 'bg-emerald-100 text-emerald-800',
  medio: 'bg-amber-100 text-amber-800',
  alto: 'bg-red-100 text-red-800',
};

const formatIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-');
  return year && month && day ? `${day}-${month}-${year}` : isoDay;
};

const LevelBadge: React.FC<{ level: BradenRiskLevel | null; label: string }> = ({
  level,
  label,
}) => (
  <span
    className={clsx(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
      level ? LEVEL_BADGE_CLASSES[level] : 'bg-slate-100 text-slate-600'
    )}
  >
    {label}
  </span>
);

const BradenSection: React.FC<{ braden: BradenCellModel }> = ({ braden }) => {
  const { assessment, countdownLabel } = braden;
  const urgency = assessment.reapplication.urgency;
  const needsReapply = urgency !== 'ok';

  return (
    <section className="rounded-lg border border-slate-200 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Escala de riesgo UPP (Braden)</h3>
        <LevelBadge level={assessment.riskLevel} label={assessment.conducta.riskLabel} />
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-800 tabular-nums">{braden.total}</span>
        <span className="text-xs text-slate-500">
          puntos · realizada el {formatIsoDay(braden.entry.recordedDate)}
        </span>
      </div>

      <div
        className={clsx(
          'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold',
          needsReapply ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
        )}
      >
        {needsReapply ? <AlarmClock size={14} /> : <CalendarClock size={14} />}
        <span>{countdownLabel}</span>
        <span className="ml-auto font-normal text-[11px] opacity-80">
          Aplicación: {assessment.conducta.aplicacion} · próxima:{' '}
          {formatIsoDay(assessment.reapplication.dueDate)}
        </span>
      </div>

      <div>
        <h4 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
          <ClipboardList size={12} /> Cuidados planeados según riesgo de LPP
        </h4>
        <ul className="list-disc pl-5 space-y-0.5 text-xs text-slate-600">
          {assessment.conducta.cuidados.map(cuidado => (
            <li key={cuidado}>{cuidado}</li>
          ))}
        </ul>
        <p className="mt-1 text-[10px] text-slate-400">Cada intervención debe tener su registro.</p>
      </div>
    </section>
  );
};

const DowntonSection: React.FC<{ downton: DowntonCellModel }> = ({ downton }) => {
  const needsReapply = downton.reapplication != null && downton.reapplication.urgency !== 'ok';
  return (
    <section className="rounded-lg border border-slate-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Escala de riesgo de caídas (Downton)
        </h3>
        <LevelBadge level={downton.level} label={downton.severityLabel || 'Sin interpretación'} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-slate-800 tabular-nums">{downton.total}</span>
        <span className="text-xs text-slate-500">
          puntos · realizada el {formatIsoDay(downton.entry.recordedDate)}
        </span>
      </div>
      {downton.reapplication && downton.countdownLabel && (
        <div
          className={clsx(
            'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold',
            needsReapply ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          )}
        >
          {needsReapply ? <AlarmClock size={14} /> : <CalendarClock size={14} />}
          <span>{downton.countdownLabel}</span>
          <span className="ml-auto font-normal text-[11px] opacity-80">
            próxima: {formatIsoDay(downton.reapplication.dueDate)}
          </span>
        </div>
      )}
    </section>
  );
};

const CudyrSection: React.FC<{ cudyr: CudyrCellModel }> = ({ cudyr }) => (
  <section className="rounded-lg border border-slate-200 p-3 space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-slate-700">
        CUDYR — Categorización de riesgo y dependencia
      </h3>
      <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
        {cudyr.category}
      </span>
    </div>
    <div className="flex items-start gap-2 rounded-md bg-indigo-50/70 px-2.5 py-1.5 text-[11px] text-indigo-700">
      <Info size={13} className="mt-px shrink-0" />
      <span>
        Resultado importado desde <strong>{cudyr.entry.source}</strong>. Eloísa entrega solo la
        categoría compuesta, por eso no se muestra el valor de cada variable. Categorizado el{' '}
        {formatIsoDay(cudyr.entry.recordedDate)}.
      </span>
    </div>
  </section>
);

const HistorySection: React.FC<{ history: EvaluationScoreEntry[] }> = ({ history }) => (
  <section className="rounded-lg border border-slate-200 p-3">
    <h3 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-2">
      <History size={12} /> Historial durante la hospitalización
    </h3>
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100">
          <th className="py-1 pr-2 font-semibold">Fecha</th>
          <th className="py-1 pr-2 font-semibold">Escala</th>
          <th className="py-1 pr-2 font-semibold text-right">Puntaje</th>
          <th className="py-1 font-semibold">Interpretación</th>
        </tr>
      </thead>
      <tbody>
        {history.map(entry => (
          <tr key={entry.encounterEventId} className="border-b border-slate-50 text-slate-600">
            <td className="py-1 pr-2 whitespace-nowrap tabular-nums">
              {formatIsoDay(entry.recordedDate)}
            </td>
            <td className="py-1 pr-2">
              {entry.code === 'BRADEN' ? 'Braden (UPP)' : 'Downton (caídas)'}
            </td>
            <td className="py-1 pr-2 text-right font-semibold tabular-nums">
              {entry.total ?? '—'}
            </td>
            <td className="py-1">{entry.severity ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

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
    size="md"
    dataModule="census-scores"
  >
    <div className="space-y-3">
      {model.braden && <BradenSection braden={model.braden} />}
      {model.downton && <DowntonSection downton={model.downton} />}
      {model.cudyr && <CudyrSection cudyr={model.cudyr} />}
      {!model.braden && !model.downton && !model.cudyr && (
        <p className="text-sm text-slate-500">Sin escalas sincronizadas para este día.</p>
      )}
      {model.history.length > 0 && <HistorySection history={model.history} />}
    </div>
  </BaseModal>
);
