/**
 * Read-only Braden/Downton report with per-scale history and existing reapplication rules.
 * CUDYR provenance remains available separately; planned care is not shown in this report.
 */

import React, { useId, useState } from 'react';
import clsx from 'clsx';
import { Activity, History, Info } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type {
  CudyrCellModel,
  ScoresCellModel,
} from '@/features/census/controllers/evaluationScoresCellController';
import { BradenCard, CudyrCard, DowntonCard } from './ScoresDetailCards';
import { ScoresHistoryTable } from './ScoresHistoryTable';
import { formatIsoDay } from './scoresDetailTokens';

interface ScoresDetailModalProps {
  patientName: string;
  model: ScoresCellModel;
  onClose: () => void;
}

const formatCudyrDateTime = (value: string, day: string): string => {
  const epoch = Date.parse(value);
  if (Number.isNaN(epoch)) return formatIsoDay(day);
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'Pacific/Easter',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epoch));
};

const CudyrNote: React.FC<{ cudyr: CudyrCellModel }> = ({ cudyr }) => (
  <div className="flex items-start gap-2 rounded-lg bg-indigo-50/70 px-3 py-2 text-[11px] text-indigo-700 ring-1 ring-indigo-100">
    <Info size={13} className="mt-px shrink-0" />
    <span>
      CUDYR importado desde <strong>{cudyr.entry.source}</strong>.
      {cudyr.entry.source.includes('Gestión de Camas')
        ? ' La fecha, hora y profesional corresponden al historial oficial de su Lista de trabajo.'
        : ' Esta fuente de respaldo informa solo el último valor; conecta Gestión de Camas para consultar el historial oficial.'}
    </span>
  </div>
);

const CudyrHistory: React.FC<{ cudyr: CudyrCellModel }> = ({ cudyr }) => {
  const history = cudyr.entry.history ?? [];
  if (history.length === 0) return null;
  const isOfficialHistory = cudyr.entry.source.includes('Gestión de Camas');
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <h4 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <History size={13} />
        {isOfficialHistory ? 'Historial CUDYR oficial' : 'Último CUDYR disponible'}
      </h4>
      <ol className="space-y-2">
        {history.map((entry, index) => (
          <li
            key={`${entry.recordedAt}-${index}`}
            className="flex items-start justify-between gap-3 text-xs"
          >
            <div>
              <strong className="text-slate-700">{entry.category}</strong>
              {entry.dependencyScore != null && entry.riskScore != null && (
                <span className="ml-2 text-slate-500">
                  Dependencia {entry.dependencyScore} · Riesgo {entry.riskScore}
                </span>
              )}
              <div className="text-[11px] text-slate-400">
                {[entry.author, entry.authorRole].filter(Boolean).join(' · ') ||
                  'Profesional no informado'}
              </div>
            </div>
            <time className="shrink-0 text-[11px] text-slate-500">
              {formatCudyrDateTime(entry.recordedAt, entry.recordedDate)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
};

export const ScoresDetailModal: React.FC<ScoresDetailModalProps> = ({
  patientName,
  model,
  onClose,
}) => {
  const [active, setActive] = useState<'BRADEN' | 'DOWNTON'>(model.braden ? 'BRADEN' : 'DOWNTON');
  const id = useId();
  const selected = active === 'BRADEN' ? model.braden : model.downton;
  const reapplication =
    active === 'BRADEN' ? model.braden?.assessment.reapplication : model.downton?.reapplication;
  const history = model.history.filter(entry => entry.code === active);
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`Escalas de enfermería — ${patientName}`}
      icon={<Activity size={18} />}
      size="3xl"
      bodyClassName="!px-4 !py-3"
      dataModule="census-scores"
    >
      <div className="space-y-2">
        <div
          role="tablist"
          aria-label="Escala de enfermería"
          className="flex gap-1 border-b border-slate-200"
        >
          {(['BRADEN', 'DOWNTON'] as const).map(code => {
            const score = code === 'BRADEN' ? model.braden : model.downton;
            const urgency =
              code === 'BRADEN'
                ? model.braden?.assessment.reapplication.urgency
                : model.downton?.reapplication?.urgency;
            return (
              <button
                key={code}
                type="button"
                role="tab"
                id={`${id}-${code}`}
                aria-controls={`${id}-panel`}
                aria-selected={active === code}
                tabIndex={active === code ? 0 : -1}
                onClick={() => setActive(code)}
                onKeyDown={event => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? 'BRADEN'
                      : event.key === 'End'
                        ? 'DOWNTON'
                        : code === 'BRADEN'
                          ? 'DOWNTON'
                          : 'BRADEN';
                  setActive(next);
                  document.getElementById(`${id}-${next}`)?.focus();
                }}
                className={clsx(
                  'flex items-center gap-2 border-b-2 px-4 py-1.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600',
                  active === code
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                {code === 'BRADEN' ? 'Braden' : 'Downton'}
                {score && urgency && urgency !== 'ok' && (
                  <span className="text-xs text-red-700">Pendiente</span>
                )}
              </button>
            );
          })}
        </div>
        <section
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-${active}`}
          tabIndex={0}
          className="space-y-3 focus-visible:outline-teal-600"
        >
          {active === 'BRADEN' && model.braden && <BradenCard braden={model.braden} />}
          {active === 'DOWNTON' && model.downton && <DowntonCard downton={model.downton} />}
          {reapplication && (
            <p className="text-xs text-slate-600">
              {active === 'BRADEN' && model.braden
                ? `${model.braden.assessment.conducta.aplicacion} · `
                : ''}
              Próxima aplicación: {formatIsoDay(reapplication.dueDate)}
            </p>
          )}
          {!selected && (
            <p className="py-4 text-sm text-slate-500">
              Sin resultado vigente de {active === 'BRADEN' ? 'Braden' : 'Downton'} para este día.
            </p>
          )}
          <ScoresHistoryTable history={history} />
          {history.length === 0 && (
            <p className="text-xs text-slate-500">
              Sin aplicaciones registradas durante la hospitalización.
            </p>
          )}
        </section>
        {model.cudyr && (
          <details className="border-t border-slate-200 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">
              CUDYR · {model.cudyr.category}
            </summary>
            <div className="mt-3 space-y-3">
              <CudyrCard cudyr={model.cudyr} />
              <CudyrNote cudyr={model.cudyr} />
              <CudyrHistory cudyr={model.cudyr} />
            </div>
          </details>
        )}
      </div>
    </BaseModal>
  );
};
