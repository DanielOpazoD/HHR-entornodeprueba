import React from 'react';
import clsx from 'clsx';
import { Braces } from 'lucide-react';
import type { AuditTrailEvent, AuditTrailLine } from '@/types/auditTrailTypes';
import type { AuditTrailViewPreferences } from '@/services/admin/auditTrail/auditTrailPreferences';
import { AUDIT_TRAIL_STATUS_LABELS } from '@/services/admin/auditTrail/auditTrailCatalog';
import { AuditTrailChanges } from './AuditTrailChanges';
import { AuditTrailTechnicalDetails } from './AuditTrailTechnicalDetails';
import { FOCUS_RING, formatAuditTrailMoment } from './auditTrailDisplay';

interface AuditTrailLineRowProps {
  line: AuditTrailLine;
  showActor: boolean;
  showPatient: boolean;
  withDate: boolean;
  preferences: AuditTrailViewPreferences;
  onSelectActor: (actorKey: string) => void;
  onSelectPatient: (name: string) => void;
}

const STATUS_BADGES = {
  review: 'border-amber-200 bg-amber-50 text-amber-800',
  auto: 'border-slate-200 bg-slate-50 text-slate-500',
} as const;

const Statement: React.FC<{ event: AuditTrailEvent; repeat: number }> = ({ event, repeat }) => {
  const singleField = event.changes.length === 1 ? event.changes[0].field : undefined;
  return (
    <div>
      <span className="font-medium text-slate-800">{event.label}</span>
      {event.detail && <span className="text-slate-500"> · {event.detail}</span>}
      {repeat > 1 && <span className="ml-1 tabular-nums text-slate-500">×{repeat}</span>}
      <AuditTrailChanges
        changes={event.changes}
        hideField={singleField === event.label ? singleField : undefined}
      />
      {event.notes?.map(note => (
        <p key={note} className="text-xs leading-5 text-slate-500">
          {note}
        </p>
      ))}
    </div>
  );
};

/** One line: when, who, on whom, and what changed; the technical record stays one click away. */
export const AuditTrailLineRow: React.FC<AuditTrailLineRowProps> = ({
  line,
  showActor,
  showPatient,
  withDate,
  preferences,
  onSelectActor,
  onSelectPatient,
}) => {
  const [technicalOpen, setTechnicalOpen] = React.useState(false);
  const [first] = line.events;
  const isAccessBurst = first.category === 'access' && line.events.length > 1;
  const status = line.events.find(event => event.status === 'review')?.status ?? first.status;
  const patient = first.patient;
  const comfortable = preferences.density === 'comfortable';

  return (
    <li className={clsx('px-4', comfortable ? 'py-3' : 'py-2')}>
      {/* Phones: when, who and on whom on one line, what happened below. */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1 text-[13px] sm:flex-nowrap">
        <span
          className={clsx(
            'shrink-0 pt-px text-xs tabular-nums text-slate-500',
            withDate ? 'w-[150px]' : 'w-[84px]'
          )}
        >
          {formatAuditTrailMoment(line.from, line.to, withDate)}
        </span>

        {showActor && (
          <button
            type="button"
            title="Ver solo este funcionario"
            onClick={() => onSelectActor(first.actor.key)}
            className={clsx(
              'min-w-0 truncate text-left text-xs text-slate-600 hover:text-sky-700 sm:w-[140px] sm:shrink-0',
              FOCUS_RING
            )}
          >
            {first.actor.name}
            {first.authors && (
              <span className="block truncate text-[11px] text-slate-400" title={first.authors}>
                {first.authors}
              </span>
            )}
          </button>
        )}

        {showPatient && (
          <div className="min-w-0 text-xs sm:w-[190px] sm:shrink-0">
            {patient ? (
              <button
                type="button"
                title="Ver solo este paciente"
                onClick={() => onSelectPatient(patient.name)}
                className={clsx(
                  'block max-w-full truncate text-left font-medium text-slate-700 hover:text-sky-700',
                  FOCUS_RING
                )}
              >
                {patient.name}
              </button>
            ) : (
              <span className="text-slate-400">—</span>
            )}
            {patient && (preferences.columns.document || preferences.columns.bed) && (
              <span className="block truncate text-[11px] text-slate-400">
                {[
                  preferences.columns.document ? patient.document : undefined,
                  preferences.columns.bed ? patient.bedId : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
        )}

        <div className="order-last min-w-0 basis-full space-y-1 sm:order-none sm:flex-1 sm:basis-auto">
          {isAccessBurst ? (
            <Statement event={first} repeat={line.events.length} />
          ) : (
            line.events.map(event => <Statement key={event.id} event={event} repeat={1} />)
          )}
          {preferences.columns.device && (first.device || first.ipAddress) && (
            <p className="text-[11px] text-slate-400">
              {[first.device, first.ipAddress].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {status !== 'ok' && (
            <span
              className={clsx(
                'rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
                STATUS_BADGES[status]
              )}
            >
              {AUDIT_TRAIL_STATUS_LABELS[status]}
            </span>
          )}
          <button
            type="button"
            aria-expanded={technicalOpen}
            aria-label="Detalle técnico"
            title="Detalle técnico"
            onClick={() => setTechnicalOpen(open => !open)}
            className={clsx(
              'rounded-md p-1 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600',
              technicalOpen && 'bg-slate-100 text-slate-600',
              FOCUS_RING
            )}
          >
            <Braces size={14} />
          </button>
        </div>
      </div>

      {technicalOpen && (
        <div className={clsx('mt-2', withDate ? 'sm:pl-[162px]' : 'sm:pl-[96px]')}>
          <AuditTrailTechnicalDetails events={line.events} />
        </div>
      )}
    </li>
  );
};
