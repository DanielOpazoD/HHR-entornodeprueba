import React from 'react';
import clsx from 'clsx';
import type { AuditTrailSession } from '@/types/auditTrailTypes';
import {
  AUDIT_TRAIL_SESSION_END_LABELS,
  resolveAuditTrailSessionDurationMs,
} from '@/services/admin/auditTrail/auditTrailSessions';
import { formatAuditTrailDuration } from '@/services/admin/auditTrail/auditTrailValues';
import {
  addClinicalDays,
  clinicalDayStartEpochMs,
  formatClinicalClock,
} from '@/utils/clinicalTimeFormat';

interface AuditTrailSessionTimelineProps {
  sessions: AuditTrailSession[];
  /** Hospital day shown (`YYYY-MM-DD`). */
  day: string;
}

const HOUR_TICKS = [0, 6, 12, 18, 24];

const BAR_TONES: Record<AuditTrailSession['end'], string> = {
  open: 'bg-emerald-500',
  manual: 'bg-sky-500',
  automatic: 'bg-sky-300',
  closed: 'bg-slate-400',
  unknown: 'bg-slate-300',
};

/** Connected time of each person across the hospital day, with network drops marked. */
export const AuditTrailSessionTimeline: React.FC<AuditTrailSessionTimelineProps> = ({
  sessions,
  day,
}) => {
  const dayStart = clinicalDayStartEpochMs(day);
  const dayEnd = clinicalDayStartEpochMs(addClinicalDays(day, 1));
  const span = dayEnd - dayStart;
  const toPercent = (epochMs: number) =>
    Math.min(100, Math.max(0, ((epochMs - dayStart) / span) * 100));

  const lanes = new Map<string, { name: string; sessions: AuditTrailSession[] }>();
  sessions.forEach(session => {
    const lane = lanes.get(session.actor.key) ?? { name: session.actor.name, sessions: [] };
    lane.sessions.push(session);
    lanes.set(session.actor.key, lane);
  });

  if (lanes.size === 0) return null;

  return (
    <figure className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <figcaption className="sr-only">Conexiones del día por funcionario</figcaption>
      <div className="ml-[150px] flex justify-between pb-1 text-[10px] tabular-nums text-slate-400">
        {HOUR_TICKS.map(hour => (
          <span key={hour}>{String(hour).padStart(2, '0')}:00</span>
        ))}
      </div>
      <ul className="space-y-1.5">
        {[...lanes.entries()].map(([actorKey, lane]) => (
          <li key={actorKey} className="flex items-center gap-3">
            <span className="w-[138px] shrink-0 truncate text-xs text-slate-600">{lane.name}</span>
            <div className="relative h-4 flex-1 rounded bg-slate-100">
              {lane.sessions.map(session => {
                const end = session.endedAt ?? session.lastSeenAt;
                const left = toPercent(session.startedAt);
                const width = Math.max(0.6, toPercent(end) - left);
                const label = `${formatClinicalClock(session.startedAt)} → ${formatClinicalClock(end)} · ${formatAuditTrailDuration(
                  resolveAuditTrailSessionDurationMs(session)
                )} · ${AUDIT_TRAIL_SESSION_END_LABELS[session.end]}`;
                return (
                  <React.Fragment key={session.id}>
                    <span
                      role="img"
                      title={label}
                      aria-label={label}
                      className={clsx('absolute inset-y-0 rounded', BAR_TONES[session.end])}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                    {session.interruptions.map(gap => (
                      <span
                        key={`${session.id}-${gap.from}`}
                        role="img"
                        aria-label={`Sin red ${formatClinicalClock(gap.from)} → ${formatClinicalClock(gap.to)}`}
                        title={`Sin red ${formatClinicalClock(gap.from)} → ${formatClinicalClock(gap.to)}`}
                        className="absolute inset-y-0 rounded-sm bg-rose-400"
                        style={{
                          left: `${toPercent(gap.from)}%`,
                          width: `${Math.max(0.4, toPercent(gap.to) - toPercent(gap.from))}%`,
                        }}
                      />
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-3 pl-[150px] text-[11px] text-slate-500">
        {(
          [
            ['open', 'En curso'],
            ['manual', 'Cerró sesión'],
            ['automatic', 'Cierre automático'],
            ['closed', 'Ventana cerrada'],
          ] as Array<[AuditTrailSession['end'], string]>
        ).map(([end, label]) => (
          <span key={end} className="inline-flex items-center gap-1.5">
            <span className={clsx('h-2 w-3 rounded-sm', BAR_TONES[end])} />
            {label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm bg-rose-400" />
          Sin red
        </span>
      </div>
    </figure>
  );
};
