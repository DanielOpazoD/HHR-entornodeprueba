import React from 'react';
import clsx from 'clsx';
import { Copy } from 'lucide-react';
import type { AuditTrailEvent } from '@/types/auditTrailTypes';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';
import { formatClinicalClock, formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';
import { FOCUS_RING } from './auditTrailDisplay';

/** Raw exception internals are never shown, even if an old record still carries them. */
const HIDDEN_KEYS = new Set(['stack', 'componentStack']);

const withoutHiddenKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutHiddenKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !HIDDEN_KEYS.has(key))
        .map(([key, item]) => [key, withoutHiddenKeys(item)])
    );
  }
  return value;
};

const Fact: React.FC<{ label: string; value?: string }> = ({ label, value }) =>
  value ? (
    <>
      <dt className="text-slate-400">{label}</dt>
      <dd className="break-all font-mono text-slate-700">{value}</dd>
    </>
  ) : null;

/** What is behind the statement: identifiers, origin and the stored document. */
export const AuditTrailTechnicalDetails: React.FC<{ events: AuditTrailEvent[] }> = ({ events }) => (
  <div className="space-y-3">
    {events.map(event => {
      const { source } = event;
      const json = JSON.stringify(withoutHiddenKeys(source.details ?? {}), null, 2);
      return (
        <div key={event.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[11px]">
            <Fact
              label="Fecha y hora"
              value={`${formatClinicalDayMonthYear(event.at)} ${formatClinicalClock(event.at, true)}`}
            />
            <Fact label="Acción" value={source.action} />
            <Fact label="Entidad" value={`${source.entityType} · ${source.entityId}`} />
            <Fact
              label="Funcionario"
              value={[event.actor.email, event.actor.uid].filter(Boolean).join(' · ')}
            />
            <Fact label="Responsables" value={event.authors} />
            <Fact label="Conexión" value={event.sessionId} />
            <Fact label="Dispositivo" value={event.device} />
            <Fact label="IP" value={event.ipAddress} />
            <Fact
              label="Censo"
              value={event.censusDate ? formatClinicalDayMonthYear(event.censusDate) : undefined}
            />
            <Fact label="ID" value={event.id} />
          </dl>
          <div className="mt-2 flex items-start gap-2">
            <pre className="max-h-48 flex-1 overflow-auto rounded-md bg-white p-2 font-mono text-[11px] leading-4 text-slate-600 ring-1 ring-slate-200">
              {json}
            </pre>
            <button
              type="button"
              aria-label="Copiar detalle técnico"
              onClick={() => void writeClipboardText(json).catch(() => undefined)}
              className={clsx(
                'rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 hover:text-slate-800',
                FOCUS_RING
              )}
            >
              <Copy size={13} />
            </button>
          </div>
        </div>
      );
    })}
  </div>
);
