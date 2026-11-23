/**
 * Read-only per-scale applications with source signatures, not inferred shift rosters.
 */

import React, { useId, useState } from 'react';
import clsx from 'clsx';
import { Gauge } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { ScoresCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import { BradenCard, DowntonCard } from './ScoresDetailCards';
import { CudyrHistoryPanel, formatCudyrDateTime } from './CudyrHistoryPanel';
import { ScoresHistoryTable } from './ScoresHistoryTable';
import { useLatestPriorCudyr } from '@/features/census/hooks/useLatestPriorCudyr';
import { resolveCudyrOwningCensusDay } from '@/domain/evaluationScales/importedCudyr';
import type { CudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';
import type { ImportedCudyr } from '@/types/domain/evaluationScores';

interface ScoresDetailModalProps {
  patientName: string;
  admissionDate?: string;
  censusDate?: string;
  clinicalEpisodeId?: string;
  cudyrPending?: CudyrPendingStatus | null;
  importedCudyr?: ImportedCudyr;
  initialTab?: 'CUDYR' | 'BRADEN' | 'DOWNTON';
  model: ScoresCellModel;
  onClose: () => void;
}

export const ScoresDetailModal: React.FC<ScoresDetailModalProps> = ({
  patientName,
  admissionDate,
  censusDate,
  clinicalEpisodeId,
  cudyrPending,
  importedCudyr,
  initialTab,
  model,
  onClose,
}) => {
  const [active, setActive] = useState<'CUDYR' | 'BRADEN' | 'DOWNTON'>(
    initialTab ?? (model.braden ? 'BRADEN' : model.downton ? 'DOWNTON' : 'CUDYR')
  );
  const id = useId();
  const priorCudyr = useLatestPriorCudyr({
    enabled: active === 'CUDYR' && !model.cudyr && !importedCudyr,
    censusDate,
    clinicalEpisodeId,
  });
  const selected =
    active === 'BRADEN' ? model.braden : active === 'DOWNTON' ? model.downton : model.cudyr;
  const reapplication =
    active === 'BRADEN'
      ? model.braden?.assessment.reapplication
      : active === 'DOWNTON'
        ? model.downton?.reapplication
        : undefined;
  const history = model.history.filter(entry => entry.code === active);
  const cudyrHistory = importedCudyr ?? model.cudyr?.entry ?? priorCudyr.cudyr ?? undefined;
  const priorOwningDay =
    !model.cudyr && cudyrHistory
      ? ((cudyrHistory.recordedAt ? resolveCudyrOwningCensusDay(cudyrHistory.recordedAt) : null) ??
        cudyrHistory.recordedDate)
      : null;
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`Escalas de enfermería — ${patientName}`}
      icon={<Gauge size={18} />}
      size="3xl"
      bodyClassName="!px-4 !py-2"
      dataModule="census-scores"
    >
      <div className="space-y-2">
        <p className="text-xs text-slate-600">
          Ingreso:{' '}
          <strong className="font-medium tabular-nums">
            {admissionDate ? formatClinicalDayMonthYear(admissionDate) : 'No informado'}
          </strong>
        </p>
        <div
          role="tablist"
          aria-label="Escala de enfermería"
          className="flex gap-1 border-b border-slate-200"
        >
          {(['CUDYR', 'BRADEN', 'DOWNTON'] as const).map((code, index) => {
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
                  const tabs = ['CUDYR', 'BRADEN', 'DOWNTON'] as const;
                  const next =
                    tabs[
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 2
                          : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3
                    ];
                  if (!next) return;
                  setActive(next);
                  document.getElementById(`${id}-${next}`)?.focus();
                }}
                className={clsx(
                  'flex items-center gap-2 border-b-2 px-4 py-1 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700',
                  active === code
                    ? 'border-teal-600 text-teal-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                {code === 'BRADEN' ? 'Braden' : code === 'DOWNTON' ? 'Downton' : 'CUDYR'}
              </button>
            );
          })}
        </div>
        <section
          role="tabpanel"
          id={`${id}-panel`}
          aria-labelledby={`${id}-${active}`}
          tabIndex={0}
          className="space-y-2 focus-visible:outline-teal-700"
        >
          {!selected && (
            <div className="space-y-1.5 py-2">
              <p className="text-sm text-slate-500">
                Sin resultado vigente de{' '}
                {active === 'BRADEN' ? 'Braden' : active === 'DOWNTON' ? 'Downton' : 'CUDYR'} para
                este día.
              </p>
              {active === 'CUDYR' && cudyrPending && (
                <p className="text-xs text-slate-500">{cudyrPending.detail}</p>
              )}
              {active === 'CUDYR' && cudyrHistory && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  Último CUDYR registrado en Eloísa:{' '}
                  <strong className="font-semibold">{cudyrHistory.category}</strong> (
                  <span className="tabular-nums">
                    {formatCudyrDateTime(cudyrHistory.recordedAt, cudyrHistory.recordedDate)}
                  </span>
                  {priorOwningDay
                    ? ` — corresponde al turno noche del ${formatClinicalDayMonthYear(priorOwningDay)}`
                    : ''}
                  ).
                </p>
              )}
              {active === 'CUDYR' && !cudyrHistory && priorCudyr.status === 'loading' && (
                <p className="text-xs text-slate-500">Consultando categorización previa…</p>
              )}
              {active === 'CUDYR' && !cudyrHistory && priorCudyr.status === 'unavailable' && (
                <p className="text-xs text-slate-500">
                  No se pudo consultar el historial CUDYR de días anteriores.
                </p>
              )}
            </div>
          )}
          {active === 'CUDYR' && cudyrHistory && (
            <CudyrHistoryPanel cudyr={model.cudyr} entry={cudyrHistory} />
          )}
          {active === 'BRADEN' && model.braden && <BradenCard braden={model.braden} />}
          {active === 'DOWNTON' && model.downton && <DowntonCard downton={model.downton} />}
          {reapplication && (
            <p className="text-xs text-slate-600">
              {active === 'BRADEN' && model.braden
                ? `${model.braden.assessment.conducta.aplicacion} · `
                : ''}
              Próxima aplicación: {formatClinicalDayMonthYear(reapplication.dueDate)}
            </p>
          )}
          {active !== 'CUDYR' && <ScoresHistoryTable history={history} />}
          {active !== 'CUDYR' && history.length === 0 && (
            <p className="text-xs text-slate-500">
              Sin aplicaciones registradas durante la hospitalización.
            </p>
          )}
        </section>
      </div>
    </BaseModal>
  );
};
