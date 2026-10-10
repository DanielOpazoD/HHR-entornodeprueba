import { useCallback, useEffect, useState } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { cudyrMonthlyIndicatorRange } from '@/services/cudyr/cudyrMonthlyIndicator';
import {
  cudyrIndicatorAnnual,
  cudyrIndicatorMonths,
  type CudyrIndicatorRead,
} from '@/services/cudyr/cudyrIndicatorHistory';
import { useCudyrIndicatorRead } from '../hooks/useCudyrIndicatorRead';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

const monthLabel = (month: string) =>
  new Date(`${month}-01T12:00:00Z`).toLocaleDateString('es-CL', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const CudyrMonthlyIndicator = ({ date }: { date: string }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const months = cudyrIndicatorMonths(now);
  const initial = months.includes(date.slice(0, 7)) ? date.slice(0, 7) : months.at(-1);
  const scope = `${getStoredSessionOwnerKey()}:${getSessionGeneration()}`;
  return (
    <section
      aria-label="Cumplimiento CUDYR mensual"
      className="census-toolbar-card min-h-20 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 pr-10"
    >
      {initial ? (
        <History key={`${scope}:${date.slice(0, 7)}`} initial={initial} months={months} now={now} />
      ) : (
        <p className="text-xs text-slate-500">Historial desde agosto de 2026</p>
      )}
    </section>
  );
};

const Reader = ({
  month,
  through,
  now,
  onRead,
}: {
  month: string;
  through: string;
  now: Date;
  onRead: (month: string, read: CudyrIndicatorRead) => void;
}) => {
  useCudyrIndicatorRead(month, through, now, onRead);
  return null;
};

const History = ({ initial, months, now }: { initial: string; months: string[]; now: Date }) => {
  const [month, setMonth] = useState(initial);
  const [reads, setReads] = useState<Record<string, CudyrIndicatorRead>>({});
  const onRead = useCallback((key: string, read: CudyrIndicatorRead) => {
    setReads(current => ({ ...current, [key]: read }));
  }, []);
  const closedMonths = months.filter(value => cudyrMonthlyIndicatorRange(value + '-01', now));
  const annualMonths = closedMonths.filter(
    value => value.slice(0, 4) === month.slice(0, 4) && value <= month
  );
  // Selected month first; at most one additional background reader, kept mounted for reuse.
  const background = annualMonths.find(
    value => value !== month && (!reads[value] || reads[value].busy)
  );
  const settled = Object.keys(reads).filter(value => !reads[value].busy);
  const reading = new Set([...settled, month, ...(background ? [background] : [])]);
  const current = reads[month];
  const summary = current?.summary;
  const annual = cudyrIndicatorAnnual(closedMonths, month, reads);
  const index = months.indexOf(month);
  return (
    <>
      <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
        <ChartNoAxesCombined size={12} className="text-teal-600" aria-hidden="true" />
        <span>CUDYR</span>
        <button
          type="button"
          aria-label="Mes anterior"
          disabled={index <= 0}
          onClick={() => setMonth(months[index - 1])}
          className="rounded px-1 text-teal-700 hover:bg-teal-50 disabled:opacity-30"
        >
          ‹
        </button>
        <select
          aria-label="Mes de CUDYR"
          value={month}
          onChange={event => setMonth(event.target.value)}
          className="min-w-0 cursor-pointer rounded bg-transparent py-0.5 focus-visible:outline-teal-700"
        >
          {months.map(value => (
            <option key={value} value={value}>
              {monthLabel(value)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Mes siguiente"
          disabled={index === months.length - 1}
          onClick={() => setMonth(months[index + 1])}
          className="rounded px-1 text-teal-700 hover:bg-teal-50 disabled:opacity-30"
        >
          ›
        </button>
      </div>
      {summary ? (
        <div aria-live="polite">
          <div className="flex items-baseline gap-2">
            <strong className="text-2xl leading-7 font-semibold tabular-nums text-teal-800">
              {summary.percentage === null ? '—' : `${summary.percentage}%`}
            </strong>
            <span className="text-[11px] tabular-nums text-slate-600">
              {summary.categorized}/{summary.eligible} elegibles
            </span>
          </div>
          <div
            className="h-1 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="Cumplimiento CUDYR"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.percentage ?? undefined}
            aria-valuetext={
              summary.percentage === null ? 'Sin pacientes elegibles' : `${summary.percentage}%`
            }
          >
            <div
              className="h-full rounded-full bg-teal-600"
              style={{ width: `${summary.percentage ?? 0}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {summary.through
              ? `Hasta ${summary.through.slice(8)}/${summary.through.slice(5, 7)}`
              : 'Sin días cerrados'}{' '}
            ·{' '}
            {current.error
              ? 'Copia local · sin verificar'
              : current.busy
                ? 'Verificando…'
                : summary.quality}
          </p>
        </div>
      ) : (
        <p role="status" className="mt-2 text-xs text-slate-500">
          {current?.error
            ? 'No se pudo leer CUDYR'
            : cudyrMonthlyIndicatorRange(month + '-01', now)
              ? 'Leyendo CUDYR…'
              : 'Sin días cerrados'}
        </p>
      )}
      <p
        className="mt-0.5 text-[9px] tabular-nums text-slate-500"
        title={`CUDYR registrados / pacientes-día elegibles. Desde ${annual.from ? monthLabel(annual.from) : 'inicio del año'} hasta ${monthLabel(month)}. ${annual.categorized}/${annual.eligible}.`}
      >
        Acum. {month.slice(0, 4)} ·{' '}
        {annual.missing
          ? annual.error
            ? 'No disponible'
            : 'Leyendo…'
          : annual.percentage === null
            ? '—'
            : `${annual.percentage}%`}
        {!annual.missing &&
          (annual.error
            ? ' · Copia local'
            : annual.busy
              ? ' · Verificando…'
              : annual.provisional
                ? ' · Provisional'
                : ' · Oficial')}
        {annual.from?.startsWith('2026') ? ' · desde ago.' : ''}
      </p>
      {[...reading].map(value => {
        const range = cudyrMonthlyIndicatorRange(value + '-01', now);
        return range ? (
          <Reader key={value} month={value} through={range.to} now={now} onRead={onRead} />
        ) : null;
      })}
    </>
  );
};
