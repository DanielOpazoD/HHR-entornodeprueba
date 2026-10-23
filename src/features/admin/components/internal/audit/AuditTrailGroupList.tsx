import React from 'react';
import clsx from 'clsx';
import { ChevronRight } from 'lucide-react';
import type { AuditTrailGroup } from '@/types/auditTrailTypes';
import type { AuditTrailViewPreferences } from '@/services/admin/auditTrail/auditTrailPreferences';
import { buildAuditTrailLines } from '@/services/admin/auditTrail/auditTrailGroups';
import {
  AUDIT_TRAIL_SESSION_END_LABELS,
  resolveAuditTrailSessionDurationMs,
} from '@/services/admin/auditTrail/auditTrailSessions';
import { formatAuditTrailDuration } from '@/services/admin/auditTrail/auditTrailValues';
import { AuditTrailLineRow } from './AuditTrailLineRow';
import {
  FOCUS_RING,
  formatAuditTrailCounts,
  formatAuditTrailMoment,
  pluralize,
} from './auditTrailDisplay';

interface AuditTrailGroupListProps {
  groups: AuditTrailGroup[];
  preferences: AuditTrailViewPreferences;
  multiDay: boolean;
  onSelectActor: (actorKey: string) => void;
  onSelectPatient: (name: string) => void;
}

const sessionSummary = (group: AuditTrailGroup, multiDay: boolean): string | undefined => {
  const { session } = group;
  if (!session) return undefined;
  const end = session.endedAt ?? session.lastSeenAt;
  return [
    formatAuditTrailMoment(session.startedAt, end, multiDay).replace('–', ' → '),
    formatAuditTrailDuration(resolveAuditTrailSessionDurationMs(session)),
    // An open session already shows the "En curso" badge.
    session.end === 'open' ? undefined : AUDIT_TRAIL_SESSION_END_LABELS[session.end],
    session.interruptions.length > 0
      ? pluralize(session.interruptions.length, 'corte de red', 'cortes de red')
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
};

const GroupSection: React.FC<
  Omit<AuditTrailGroupListProps, 'groups'> & { group: AuditTrailGroup }
> = ({ group, preferences, multiDay, onSelectActor, onSelectPatient }) => {
  const [expanded, setExpanded] = React.useState(preferences.expandGroups);
  const bodyId = React.useId();
  const lines = React.useMemo(
    () => (expanded ? buildAuditTrailLines(group.events) : []),
    [expanded, group.events]
  );
  const counts = formatAuditTrailCounts(group.counts);
  const extra =
    group.grouping === 'patient' && group.actorCount > 1
      ? pluralize(group.actorCount, 'funcionario', 'funcionarios')
      : group.grouping !== 'patient' && group.patientCount > 0
        ? pluralize(group.patientCount, 'paciente', 'pacientes')
        : undefined;
  const sessionText = sessionSummary(group, multiDay);
  const isOpenSession = group.session?.end === 'open';

  React.useEffect(() => setExpanded(preferences.expandGroups), [preferences.expandGroups]);

  return (
    <section className="border-b border-slate-100 last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded(value => !value)}
          className={clsx(
            'flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50',
            FOCUS_RING
          )}
        >
          <ChevronRight
            size={15}
            className={clsx('shrink-0 text-slate-400 transition', expanded && 'rotate-90')}
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-semibold text-slate-900">{group.title}</span>
              {group.subtitle && (
                <span className="truncate text-xs text-slate-500">{group.subtitle}</span>
              )}
              {isOpenSession && (
                <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700">
                  En curso
                </span>
              )}
            </span>
            {sessionText && <span className="block text-xs text-slate-500">{sessionText}</span>}
          </span>
          <span className="hidden text-xs text-slate-500 sm:block">
            {[counts, extra].filter(Boolean).join(' · ')}
          </span>
          {!group.session && group.events.length > 0 && (
            <span className="w-[120px] shrink-0 text-right text-xs tabular-nums text-slate-400">
              {formatAuditTrailMoment(group.from, group.to, multiDay && group.grouping !== 'time')}
            </span>
          )}
          {group.counts.review > 0 && (
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
              title={pluralize(group.counts.review, 'evento por revisar', 'eventos por revisar')}
            />
          )}
        </button>
      </h3>

      {expanded && (
        <ul id={bodyId} className="divide-y divide-slate-50 border-t border-slate-100 bg-white">
          {lines.length === 0 ? (
            <li className="px-4 py-3 text-xs text-slate-400">
              Sin eventos con los filtros actuales
            </li>
          ) : (
            lines.map(line => (
              <AuditTrailLineRow
                key={line.key}
                line={line}
                showActor={group.grouping !== 'actor' && group.grouping !== 'session'}
                showPatient={group.grouping !== 'patient'}
                withDate={multiDay && group.grouping !== 'time'}
                preferences={preferences}
                onSelectActor={onSelectActor}
                onSelectPatient={onSelectPatient}
              />
            ))
          )}
        </ul>
      )}
    </section>
  );
};

export const AuditTrailGroupList: React.FC<AuditTrailGroupListProps> = ({ groups, ...rest }) => (
  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    {groups.map(group => (
      <GroupSection key={`${group.grouping}-${group.key}`} group={group} {...rest} />
    ))}
  </div>
);
