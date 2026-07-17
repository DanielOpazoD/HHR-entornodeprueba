import React, { useMemo } from 'react';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { HandoffCudyrPrintHeader } from './HandoffCudyrPrintHeader';
import { HandoffCudyrPrintTable } from './HandoffCudyrPrintTable';
import {
  buildCudyrPrintMetrics,
  formatCudyrPrintDate,
  resolveResponsibleNightNurses,
  resolveVisibleCudyrBeds,
} from './handoffCudyrPrintSupport';
import { resolveCudyrNightApplicationDate } from '@/features/cudyr/public';

export const HandoffCudyrPrint: React.FC = () => {
  const { record } = useDailyRecordData();

  const visibleBeds = useMemo(() => resolveVisibleCudyrBeds(record), [record]);
  const metrics = useMemo(() => buildCudyrPrintMetrics(record), [record]);

  if (!record) return null;

  const printDate = formatCudyrPrintDate(record.date);
  const applicationDate = formatCudyrPrintDate(resolveCudyrNightApplicationDate(record.date));
  const responsibleNurses = resolveResponsibleNightNurses(record);
  const hasCompletionAttribution = Boolean(
    record.cudyrCompletedAt &&
    !Number.isNaN(Date.parse(record.cudyrCompletedAt)) &&
    record.cudyrCompletedBy?.trim()
  );
  const hasUpdateAttribution = Boolean(
    record.cudyrUpdatedAt &&
    !Number.isNaN(Date.parse(record.cudyrUpdatedAt)) &&
    record.cudyrUpdatedBy?.trim()
  );

  return (
    <div className="handoff-cudyr-print list-none bg-white print:m-0 print:bg-white print:p-0">
      <HandoffCudyrPrintHeader
        occupied={metrics.occupied}
        categorized={metrics.categorized}
        index={metrics.index}
        printDate={printDate}
        applicationDate={applicationDate}
        responsibleNurses={responsibleNurses}
        recordedAt={
          hasCompletionAttribution
            ? record.cudyrCompletedAt
            : hasUpdateAttribution
              ? record.cudyrUpdatedAt
              : undefined
        }
        recordedBy={
          hasCompletionAttribution
            ? record.cudyrCompletedBy
            : hasUpdateAttribution
              ? record.cudyrUpdatedBy
              : undefined
        }
      />
      <HandoffCudyrPrintTable record={record} visibleBeds={visibleBeds} />
    </div>
  );
};
