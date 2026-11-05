import React, { useState } from 'react';
import type { PatientFluidBalance } from '@/types/domain/fluidBalance';

const PERIODS = [
  { key: 'total', label: '24 horas', hours: '08:00–07:59 del día siguiente' },
  { key: 'day', label: 'Día', hours: '08:00–19:59' },
  { key: 'night', label: 'Noche', hours: '20:00–07:59 del día siguiente' },
] as const;

export const FluidBalanceDetail: React.FC<{
  balance?: PatientFluidBalance;
  censusDate?: string;
}> = ({ balance, censusDate }) => {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('total');
  if (!balance || (censusDate && balance.censusDate !== censusDate)) {
    return (
      <p className="text-xs text-slate-500">
        Ingresos y diuresis sin datos sincronizados para este día.
      </p>
    );
  }
  const selected =
    period === 'total'
      ? {
          intakeMl: balance.day.intakeMl + balance.night.intakeMl,
          urineOutputMl: balance.day.urineOutputMl + balance.night.urineOutputMl,
          records: balance.day.records + balance.night.records,
        }
      : balance[period];
  const format = (value: number) => value.toLocaleString('es-CL', { maximumFractionDigits: 2 });
  return (
    <section aria-label="Ingresos y diuresis" className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-600">
          Ingresos y diuresis · {balance.censusDate}
        </h3>
        <div role="group" aria-label="Período de balance" className="flex gap-1">
          {PERIODS.map(option => (
            <button
              key={option.key}
              type="button"
              aria-pressed={period === option.key}
              onClick={() => setPeriod(option.key)}
              className={`rounded px-2 py-1 text-xs ${period === option.key ? 'bg-slate-700 text-white' : 'bg-slate-50 text-slate-600'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        {PERIODS.find(option => option.key === period)?.hours} · Rapa Nui
      </p>
      {selected.records === 0 ? (
        <p className="mt-2 text-xs text-slate-500">
          Sin registros de ingresos o diuresis en este período.
        </p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-3 text-center text-sm tabular-nums">
          <div>
            <dt className="text-xs text-slate-500">Ingresos</dt>
            <dd className="font-semibold">{format(selected.intakeMl)} ml</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Diuresis</dt>
            <dd className="font-semibold">{format(selected.urineOutputMl)} ml</dd>
          </div>
        </dl>
      )}
      <p className="mt-2 text-[10px] text-slate-400">
        Registros sincronizados de Eloísa. Egresos: solo diuresis.
      </p>
    </section>
  );
};
