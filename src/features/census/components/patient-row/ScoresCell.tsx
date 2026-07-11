/**
 * "Scores" census column: compact chips for the nursing risk scales synced from Ficha Médico —
 * Braden (UPP) with its reapplication countdown and Downton (falls) severity. Clicking the cell
 * opens the detail modal with the conducta and the unified risk history. Read-only by design:
 * Ficha Médico is the source of truth (ownership `remoteCanonical`).
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { AlarmClock } from 'lucide-react';
import type { BaseCellProps } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { ScoresDetailModal } from './ScoresDetailModal';
import { buildScoresCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import type { BradenRiskLevel } from '@/types/domain/evaluationScores';

interface ScoresCellProps extends BaseCellProps {
  currentDateString: string;
}

const LEVEL_CHIP_CLASSES: Record<BradenRiskLevel, string> = {
  bajo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medio: 'bg-amber-50 text-amber-700 border-amber-300',
  alto: 'bg-red-50 text-red-700 border-red-300',
};

const NEUTRAL_CHIP_CLASSES = 'bg-slate-50 text-slate-500 border-slate-200';

// CUDYR category band colors, matching the CUDYR night-handoff view (A highest acuity → D lowest).
const CUDYR_BAND_CLASSES: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'bg-rose-50 text-rose-700 border-rose-200',
  B: 'bg-amber-50 text-amber-700 border-amber-300',
  C: 'bg-sky-50 text-sky-700 border-sky-200',
  D: 'bg-emerald-50 text-emerald-700 border-emerald-200',
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
  const bradenUrgency = model.braden?.assessment.reapplication.urgency ?? 'ok';
  const needsReapply = bradenUrgency !== 'ok';

  return (
    <td className="py-0.5 px-1 border-r border-slate-200 relative">
      {model.hasAny ? (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            setIsDetailOpen(true);
          }}
          className="w-full flex flex-col items-stretch gap-0.5 cursor-pointer"
          title="Ver detalle de escalas de enfermería"
        >
          {model.braden && (
            <span
              className={clsx(
                'flex items-center justify-between gap-0.5 rounded border px-1 py-px text-[9px] font-semibold leading-tight',
                LEVEL_CHIP_CLASSES[model.braden.assessment.riskLevel],
                needsReapply && 'ring-1 ring-red-400'
              )}
              title={`Braden ${model.braden.total} · ${model.braden.assessment.conducta.riskLabel} · ${model.braden.countdownLabel}`}
            >
              <span>B {model.braden.total}</span>
              <span
                className={clsx(
                  'flex items-center gap-0.5 font-bold tabular-nums',
                  needsReapply && 'text-red-600 animate-pulse'
                )}
              >
                {needsReapply && <AlarmClock size={9} strokeWidth={3} />}
                {model.braden.chipCountdown}
              </span>
            </span>
          )}
          {model.downton && (
            <span
              className={clsx(
                'flex items-center justify-between gap-0.5 rounded border px-1 py-px text-[9px] font-semibold leading-tight',
                model.downton.level ? LEVEL_CHIP_CLASSES[model.downton.level] : NEUTRAL_CHIP_CLASSES
              )}
              title={`Downton ${model.downton.total} · ${model.downton.severityLabel}`}
            >
              <span>D {model.downton.total}</span>
            </span>
          )}
          {model.cudyr && (
            <span
              className={clsx(
                'flex items-center justify-between gap-0.5 rounded border px-1 py-px text-[9px] font-semibold leading-tight',
                model.cudyr.band ? CUDYR_BAND_CLASSES[model.cudyr.band] : NEUTRAL_CHIP_CLASSES
              )}
              title={`CUDYR ${model.cudyr.category} · importado desde ${model.cudyr.entry.source} (sin desglose)`}
            >
              <span>CUDYR {model.cudyr.category}</span>
            </span>
          )}
        </button>
      ) : (
        <div
          className="text-center text-slate-300 text-[9px] select-none"
          title="Sin escalas sincronizadas"
        >
          —
        </div>
      )}

      {isDetailOpen && (
        <ScoresDetailModal
          patientName={data.patientName}
          model={model}
          onClose={() => setIsDetailOpen(false)}
        />
      )}
    </td>
  );
};
