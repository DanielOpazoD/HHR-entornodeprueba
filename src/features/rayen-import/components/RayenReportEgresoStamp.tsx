import React from 'react';
import type { ReportEgreso } from '../contracts/egresoReport';
import { ddmmyyyy } from './RayenImportDiffReviewParts';
import { SYNC_TONE } from './syncTone';

interface RayenReportEgresoStampProps {
  entry: ReportEgreso;
  isPreviousDay: boolean;
}

/** Shows the clinical Rapa Nui stamp instead of the mainland clock printed by the bulk report. */
export const RayenReportEgresoStamp: React.FC<RayenReportEgresoStampProps> = ({
  entry,
  isPreviousDay,
}) => {
  const stamp =
    entry.correctedDay && entry.correctedTime
      ? `${ddmmyyyy(entry.correctedDay)} ${entry.correctedTime} (hora isla)`
      : entry.fechaEgreso;
  return (
    <>
      {stamp && <span className="text-gray-400"> · {stamp}</span>}
      {isPreviousDay && (
        <span className={`ml-1 font-medium ${SYNC_TONE.info.text}`}>
          → se grabará en ese día, no hoy
        </span>
      )}
    </>
  );
};
