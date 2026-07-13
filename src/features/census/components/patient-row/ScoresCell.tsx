/**
 * "Scores" census column: one segmented chip per nursing risk scale synced from Ficha Médico,
 * each with its OWN visual identity (Braden violet · Downton indigo · CUDYR teal) — see
 * `ScaleChip` for the anatomy (identity | value-by-severity | separated reapplication countdown).
 * Hovering a chip shows the sticky note with when it was applied and by whom. Clicking the cell
 * opens the detail modal with the conducta and the unified risk history. Read-only by design:
 * Ficha Médico is the source of truth (ownership `remoteCanonical`).
 */

import React, { useState } from 'react';
import { Bandage, ClipboardList, Footprints } from 'lucide-react';
import type { BaseCellProps } from './inputCellTypes';
import { PatientEmptyCell } from './PatientEmptyCell';
import { ScoresDetailModal } from './ScoresDetailModal';
import { ScaleChip } from './ScaleChip';
import { buildScoresCellModel } from '@/features/census/controllers/evaluationScoresCellController';
import { useRayenFillStatus } from '@/features/rayen-import';

interface ScoresCellProps extends BaseCellProps {
  currentDateString: string;
}

export const ScoresCell: React.FC<ScoresCellProps> = ({
  data,
  isSubRow = false,
  isEmpty = false,
  currentDateString,
}) => {
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const isFilling = useRayenFillStatus();

  if (isEmpty && !isSubRow) {
    return <PatientEmptyCell tdClassName="py-0.5 px-1 border-r border-slate-200 relative" />;
  }

  const model = buildScoresCellModel(data, currentDateString);

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
          aria-label="Ver detalle de escalas de enfermería"
        >
          {model.braden && (
            <ScaleChip
              hue="violet"
              icon={Bandage}
              label="Braden"
              value={String(model.braden.total)}
              severity={model.braden.assessment.riskLevel}
              countdown={model.braden.chipCountdown}
              countdownUrgent={model.braden.assessment.reapplication.urgency !== 'ok'}
              note={{
                title: model.braden.entry.name,
                recordedDate: model.braden.entry.recordedDate,
                recordedAt: model.braden.entry.recordedAt,
                author: model.braden.entry.author,
                authorRole: model.braden.entry.authorRole,
                detail: model.braden.assessment.conducta.riskLabel,
              }}
            />
          )}
          {model.downton && (
            <ScaleChip
              hue="indigo"
              icon={Footprints}
              label="Downton"
              value={String(model.downton.total)}
              severity={model.downton.level}
              countdown={model.downton.chipCountdown}
              countdownUrgent={
                !!model.downton.reapplication && model.downton.reapplication.urgency !== 'ok'
              }
              note={{
                title: model.downton.entry.name,
                recordedDate: model.downton.entry.recordedDate,
                recordedAt: model.downton.entry.recordedAt,
                author: model.downton.entry.author,
                authorRole: model.downton.entry.authorRole,
                detail: model.downton.severityLabel,
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
                detail: `Importado desde ${model.cudyr.entry.source} · sin desglose`,
              }}
            />
          )}
        </button>
      ) : isFilling ? (
        <div
          className="flex flex-col gap-0.5 animate-pulse"
          title="Sincronizando escalas desde Eloísa…"
          aria-label="Cargando escalas"
        >
          <span className="h-2.5 rounded bg-slate-200" />
          <span className="h-2.5 w-2/3 rounded bg-slate-200" />
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
        <ScoresDetailModal
          patientName={data.patientName}
          model={model}
          onClose={() => setIsDetailOpen(false)}
        />
      )}
    </td>
  );
};
