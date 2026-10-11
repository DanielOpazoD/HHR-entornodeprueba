/**
 * "Scores" census column: one segmented chip per nursing risk scale synced from Ficha Médico,
 * each with its OWN visual identity (Braden violet · Downton indigo · CUDYR teal) — see
 * `ScaleChip` for the anatomy (identity | value-by-severity | separated reapplication countdown).
 * Hovering a chip shows the sticky note with when it was applied and by whom. Clicking the cell
 * opens the detail modal with the conducta and the unified risk history. Read-only by design:
 * Ficha Médico is the source of truth (ownership `remoteCanonical`).
 */

import React, { lazy, useState } from 'react';
import { Bandage, ClipboardList, Footprints } from 'lucide-react';
import type { BaseCellProps } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { ClinicalDetailLoadBoundary } from './ClinicalDetailLoadBoundary';
import { ScaleChip } from './ScaleChip';
import { buildScoresCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import { isCudyrPatientEligible } from '@/domain/cudyr/cudyrEligibility';
import { isCudyrScoreComplete } from '@/domain/cudyr/cudyrCompletion';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';

const ScoresDetailModal = lazy(() =>
  import('./ScoresDetailModal').then(module => ({ default: module.ScoresDetailModal }))
);

interface ScoresCellProps extends BaseCellProps {
  currentDateString: string;
}

const latestApplicationDetail = (
  entry: { recordedAt: string; recordedDate: string },
  application: { recordedAt: string; recordedDate: string; archived?: boolean }
): string => {
  const differs =
    application.recordedDate !== entry.recordedDate || application.recordedAt !== entry.recordedAt;
  if (!differs && !application.archived) return '';
  const date = application.recordedDate.split('-').reverse().join('-');
  return `${differs ? `Última aplicación registrada el ${date}` : 'Aplicación'}${
    application.archived ? ' · oculta del resumen rápido; disponible en Historial' : ''
  }`;
};

export const ScoresCell: React.FC<ScoresCellProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  currentDateString,
}) => {
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 relative" />;
  }

  const model = buildScoresCellModel(data, currentDateString);
  const hasCompleteManualCudyr = isCudyrScoreComplete(data.cudyr);
  const cudyrPending =
    !isSubRow &&
    data.bedMode !== 'Cuna' &&
    !model.cudyr &&
    !hasCompleteManualCudyr &&
    isCudyrPatientEligible(currentDateString, data)
      ? resolveCudyrPendingStatus(currentDateString)
      : null;
  const hasCellContent = model.hasAny || cudyrPending != null;

  return (
    <td className="py-0.5 px-1 border-r border-slate-200 relative">
      {hasCellContent ? (
        <div className="flex w-full flex-col items-stretch gap-0.5">
          {model.hasAny && (
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                setIsDetailOpen(true);
              }}
              className="flex w-full cursor-pointer flex-col items-stretch gap-0.5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-700"
              aria-label="Ver detalle de escalas de enfermería"
            >
              {model.braden && (
                <ScaleChip
                  hue="violet"
                  icon={Bandage}
                  label="Braden"
                  value={String(model.braden.total)}
                  severity={model.braden.displayLevel}
                  countdown={model.braden.chipCountdown}
                  countdownUrgent={model.braden.assessment.reapplication.urgency !== 'ok'}
                  note={{
                    title: model.braden.entry.name,
                    recordedDate: model.braden.entry.recordedDate,
                    recordedAt: model.braden.entry.recordedAt,
                    author: model.braden.entry.author,
                    authorRole: model.braden.entry.authorRole,
                    detail: [
                      model.braden.severityLabel,
                      latestApplicationDetail(model.braden.entry, model.braden.application),
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }}
                />
              )}
              {model.downton && (
                <ScaleChip
                  hue="indigo"
                  icon={Footprints}
                  label="Downton"
                  value={String(model.downton.total)}
                  severity={model.downton.displayLevel}
                  countdown={model.downton.chipCountdown}
                  countdownUrgent={Boolean(
                    model.downton.reapplication && model.downton.reapplication.urgency !== 'ok'
                  )}
                  note={{
                    title: 'Downton',
                    recordedDate: model.downton.entry.recordedDate,
                    recordedAt: model.downton.entry.recordedAt,
                    author: model.downton.entry.author,
                    authorRole: model.downton.entry.authorRole,
                    detail: [
                      model.downton.severityLabel,
                      latestApplicationDetail(model.downton.entry, model.downton.application),
                    ]
                      .filter(Boolean)
                      .join(' · '),
                  }}
                />
              )}
              {model.cudyr && (
                <ScaleChip
                  hue="teal"
                  icon={ClipboardList}
                  label="CUDYR"
                  value={model.cudyr.category}
                  band={model.cudyr.band}
                  note={{
                    title: 'CUDYR (CRD) — categorización',
                    recordedDate: model.cudyr.entry.recordedDate,
                    recordedAt: model.cudyr.entry.recordedAt,
                    author: model.cudyr.entry.author,
                    authorRole: model.cudyr.entry.authorRole,
                    detail: `Turno noche: ${model.cudyr.entry.recordedDate.split('-').reverse().join('-')}`,
                  }}
                />
              )}
            </button>
          )}
          {cudyrPending && (
            <div
              className="flex flex-wrap items-center justify-between gap-x-1 rounded border border-transparent px-1.5 py-0.5 text-[9px] text-slate-500"
              data-testid="cudyr-pending-status"
              title={cudyrPending.detail}
              aria-label={`CUDYR ${cudyrPending.label}. ${cudyrPending.detail}`}
            >
              <span className="font-semibold">CUDYR</span>
              <span>{cudyrPending.label}</span>
            </div>
          )}
        </div>
      ) : (
        <div
          className="text-center text-slate-300 text-[9px] select-none"
          title="Sin escalas sincronizadas"
        >
          —
        </div>
      )}

      {isDetailOpen && (
        <ClinicalDetailLoadBoundary
          title={`Escalas de enfermería — ${data.patientName}`}
          onClose={() => setIsDetailOpen(false)}
        >
          <ScoresDetailModal
            patientName={data.patientName}
            admissionDate={data.admissionDate}
            importedCudyr={data.evaluationScores?.cudyr}
            model={model}
            onClose={() => setIsDetailOpen(false)}
          />
        </ClinicalDetailLoadBoundary>
      )}
    </td>
  );
};
