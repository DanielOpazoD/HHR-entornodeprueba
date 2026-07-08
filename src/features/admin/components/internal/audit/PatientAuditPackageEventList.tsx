import React from 'react';
import clsx from 'clsx';

import { buildClinicalAuditPresentation } from '@/services/admin/clinicalAuditPresentation';
import type { ClinicalAuditTimelineV2Group } from '@/services/admin/clinicalAuditTimelineV2';
import type { ClinicalAuditTimelineV2SyncState } from '@/services/admin/clinicalAuditTimelineV2Types';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import { displayTimestampParts } from './patientAuditPackageRowUtils';

export const auditPackageSyncBadgeClassName = (state: ClinicalAuditTimelineV2SyncState): string => {
  if (state === 'blocked') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (state === 'merged') return 'border-cyan-200 bg-cyan-50 text-cyan-700';
  if (state === 'already_applied') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (state === 'queued' || state === 'replayed') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  if (state === 'accepted') return 'border-sky-200 bg-sky-50 text-sky-700';
  return 'border-slate-200 bg-slate-50 text-slate-500';
};

interface PatientAuditPackageEventListProps {
  logs: AuditLogEntry[];
  timelineGroup: ClinicalAuditTimelineV2Group;
}

export const PatientAuditPackageEventList: React.FC<PatientAuditPackageEventListProps> = ({
  logs,
  timelineGroup,
}) => (
  <div className="divide-y divide-slate-100">
    {logs.map(log => {
      const presentation = buildClinicalAuditPresentation(log);
      const timelineEvent = timelineGroup.events.find(event => event.id === log.id);
      const time = displayTimestampParts(log.timestamp).time;

      return (
        <div key={log.id} className="grid gap-2 px-3 py-2 md:grid-cols-[90px_1fr_1.2fr]">
          <span className="font-mono text-[10px] text-slate-400">{time}</span>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-bold text-slate-700">{presentation.title}</span>
            {timelineEvent && (
              <span
                className={clsx(
                  'w-fit rounded-md border px-1.5 py-0.5 text-[10px] font-black',
                  auditPackageSyncBadgeClassName(timelineEvent.mutationState)
                )}
              >
                {timelineEvent.mutationStateLabel}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-600">{presentation.narrative}</span>
            {timelineEvent &&
              (timelineEvent.mutationId ||
                timelineEvent.clientId ||
                timelineEvent.tabId ||
                timelineEvent.changedPaths.length > 0) && (
                <span className="text-[10px] font-medium text-slate-400">
                  {[timelineEvent.mutationId, timelineEvent.clientId, timelineEvent.tabId]
                    .filter(Boolean)
                    .join(' · ')}
                  {timelineEvent.changedPaths.length > 0
                    ? ` · ${timelineEvent.changedPaths.slice(0, 2).join(', ')}`
                    : ''}
                </span>
              )}
          </div>
        </div>
      );
    })}
  </div>
);
