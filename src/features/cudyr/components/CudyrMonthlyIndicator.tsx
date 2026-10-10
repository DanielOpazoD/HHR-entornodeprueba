import { useEffect, useState } from 'react';
import { ChartNoAxesCombined } from 'lucide-react';
import { useCudyrReport } from '../hooks/useCudyrReport';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import {
  buildCudyrMonthlyIndicator,
  cudyrMonthlyIndicatorRange,
} from '@/services/cudyr/cudyrMonthlyIndicator';

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
  const range = date ? cudyrMonthlyIndicatorRange(date, now) : null;
  return (
    <section
      aria-label="Cumplimiento CUDYR mensual"
      className="census-toolbar-card min-h-20 rounded-xl border border-slate-200/80 bg-white px-3 py-1.5 pr-10"
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
        <ChartNoAxesCombined size={12} className="text-teal-600" aria-hidden="true" />
        CUDYR · {date.slice(0, 7).split('-').reverse().join('/')}
      </div>
      {range ? (
        <MonthlyResult key={range.to} through={range.to} now={now} />
      ) : (
        <p className="mt-2 text-xs text-slate-500">Sin días anteriores evaluables</p>
      )}
    </section>
  );
};

const MonthlyResult = ({ through, now }: { through: string; now: Date }) => {
  const { record, bootstrapPhase } = useDailyRecordData();
  const { data, busy, error } = useCudyrReport(
    through,
    undefined,
    {
      date: record?.date || '',
      version: record
        ? `present:${record.lastUpdated || ''}:${record.rayenSync?.at || ''}:${record.cudyrUpdatedAt || ''}`
        : bootstrapPhase === 'confirmed_empty'
          ? 'missing'
          : '',
    },
    true
  );
  const summary = data && buildCudyrMonthlyIndicator(data, now);
  if (!summary)
    return (
      <p role="status" className="mt-2 text-xs text-slate-500">
        {error ? 'No se pudo leer CUDYR' : 'Leyendo CUDYR…'}
      </p>
    );
  return (
    <div aria-live="polite">
      <div className="mt-0.5 flex items-baseline gap-2">
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
        · {error ? 'Copia local · sin verificar' : busy ? 'Verificando…' : summary.quality}
      </p>
    </div>
  );
};
