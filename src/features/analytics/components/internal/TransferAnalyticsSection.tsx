import React from 'react';
import { Ambulance, Info, Plane, PlaneTakeoff } from 'lucide-react';

import type { DailyRecord } from '@/features/analytics/contracts/analyticsDailyRecordContracts';
import { formatAnalyticsPercent as formatPercent } from '@/features/analytics/controllers/analyticsPercentageController';
import {
  buildTransferAnalytics,
  type TransferAnalytics,
  type TransferAnalyticsCategory,
  type TransferAnalyticsDetail,
} from '@/features/analytics/controllers/transferAnalyticsController';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { TransferTraceabilityModal } from './TransferTraceabilityModal';

interface TransferAnalyticsSectionProps {
  records: DailyRecord[];
}

interface TraceabilitySelection {
  title: string;
  transfers: TransferAnalyticsDetail[];
}

const CountButton: React.FC<{
  value: number;
  label: string;
  tone?: string;
  onClick: () => void;
}> = ({ value, label, tone = 'text-slate-700', onClick }) => (
  <button
    type="button"
    className={`font-semibold tabular-nums underline-offset-2 hover:underline disabled:cursor-default disabled:text-slate-300 disabled:no-underline ${tone}`}
    disabled={value === 0}
    aria-label={`${label}: ${value}. Ver detalle`}
    onClick={onClick}
  >
    {value}
  </button>
);

const TransferModeChart: React.FC<{ analysis: TransferAnalytics }> = ({ analysis }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h4 className="font-bold text-slate-800">Distribución por modalidad</h4>
    <p className="mt-1 text-sm text-slate-500">Porcentaje sobre todos los traslados del período.</p>
    <div
      className="mt-5 flex h-8 overflow-hidden rounded-lg bg-slate-100"
      role="img"
      aria-label={`${formatPercent(analysis.latamPercent)} LATAM, ${formatPercent(analysis.airAmbulancePercent)} avión ambulancia y ${formatPercent(analysis.otherPercent)} otros medios`}
    >
      <div className="bg-sky-500" style={{ width: `${analysis.latamPercent}%` }} />
      <div className="bg-rose-500" style={{ width: `${analysis.airAmbulancePercent}%` }} />
      <div className="bg-slate-400" style={{ width: `${analysis.otherPercent}%` }} />
    </div>
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
      <span className="flex items-center gap-2 text-sky-800">
        <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> LATAM / avión comercial
      </span>
      <span className="flex items-center gap-2 text-rose-800">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Avión ambulancia
      </span>
      <span className="flex items-center gap-2 text-slate-600">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-400" /> Otros medios
      </span>
    </div>
  </div>
);

const ProviderBreakdown: React.FC<{
  analysis: TransferAnalytics;
  onOpenProvider: (category: TransferAnalyticsCategory, label: string) => void;
}> = ({ analysis, onOpenProvider }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <h4 className="font-bold text-slate-800">Aviones ambulancia por operador</h4>
    <p className="mt-1 text-sm text-slate-500">
      Participación dentro de los {analysis.airAmbulance} traslados aeromédicos identificados.
    </p>
    <div className="mt-5 space-y-4">
      {analysis.providers.map(provider => (
        <div key={provider.key}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-slate-700">{provider.label}</span>
            <button
              type="button"
              className="tabular-nums text-rose-700 underline-offset-2 hover:underline disabled:cursor-default disabled:text-slate-300 disabled:no-underline"
              disabled={provider.count === 0}
              aria-label={`${provider.label}: ${provider.count} (${formatPercent(provider.percentOfAirAmbulance)}). Ver detalle`}
              onClick={() => onOpenProvider(provider.key, provider.label)}
            >
              {provider.count} ({formatPercent(provider.percentOfAirAmbulance)})
            </button>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-rose-500"
              style={{ width: `${provider.percentOfAirAmbulance}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const TransferAnalyticsSection: React.FC<TransferAnalyticsSectionProps> = ({ records }) => {
  const analysis = React.useMemo(() => buildTransferAnalytics(records), [records]);
  const [traceability, setTraceability] = React.useState<TraceabilitySelection | null>(null);

  const openTraceability = React.useCallback(
    (title: string, predicate: (detail: TransferAnalyticsDetail) => boolean) => {
      setTraceability({ title, transfers: analysis.details.filter(predicate) });
    },
    [analysis.details]
  );

  const openProvider = React.useCallback(
    (category: TransferAnalyticsCategory, label: string) => {
      openTraceability(
        `Traslados en avión ambulancia: ${label}`,
        detail => detail.category === category
      );
    },
    [openTraceability]
  );

  if (analysis.totalTransfers === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <PlaneTakeoff className="mx-auto h-10 w-10 text-slate-300" />
        <h3 className="mt-3 font-bold text-slate-700">Sin traslados en el período</h3>
        <p className="mt-1 text-sm text-slate-500">
          No hay traslados activos registrados para las fechas seleccionadas.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5" data-testid="transfer-analytics">
      <div className="rounded-xl border border-sky-200 bg-sky-50 p-5">
        <div className="flex items-start gap-3">
          <PlaneTakeoff className="mt-0.5 h-6 w-6 shrink-0 text-sky-700" />
          <div>
            <h3 className="text-lg font-bold text-slate-800">Análisis de traslados</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Separa traslados en LATAM / avión comercial, avión ambulancia y otros medios durante
              el período seleccionado.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300 hover:shadow-sm"
          onClick={() => openTraceability('Todos los traslados', () => true)}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Traslados totales
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-slate-800">
            {analysis.totalTransfers}
          </div>
          <p className="mt-1 text-xs text-slate-500">Eventos del período</p>
          <span className="mt-2 block text-xs font-semibold text-sky-700">Ver pacientes →</span>
        </button>
        <button
          type="button"
          className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-left transition hover:border-sky-300 hover:shadow-sm"
          onClick={() =>
            openTraceability(
              'Traslados LATAM / avión comercial',
              detail => detail.category === 'latam'
            )
          }
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sky-800">
            <Plane className="h-4 w-4" /> LATAM
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-sky-800">{analysis.latam}</div>
          <p className="mt-1 text-xs text-sky-700">
            {formatPercent(analysis.latamPercent)} del total
          </p>
          <span className="mt-2 block text-xs font-semibold text-sky-700">Ver pacientes →</span>
        </button>
        <button
          type="button"
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-left transition hover:border-rose-300 hover:shadow-sm"
          onClick={() =>
            openTraceability(
              'Traslados en avión ambulancia',
              detail => detail.category !== 'latam' && detail.category !== 'other'
            )
          }
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-rose-800">
            <Ambulance className="h-4 w-4" /> Avión ambulancia
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-rose-800">
            {analysis.airAmbulance}
          </div>
          <p className="mt-1 text-xs text-rose-700">
            {formatPercent(analysis.airAmbulancePercent)} del total
          </p>
          <span className="mt-2 block text-xs font-semibold text-rose-700">Ver pacientes →</span>
        </button>
        <button
          type="button"
          className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-slate-300 hover:shadow-sm"
          onClick={() => openTraceability('Otros medios', detail => detail.category === 'other')}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Otros medios
          </div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-slate-700">
            {analysis.other}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatPercent(analysis.otherPercent)} del total
          </p>
          <span className="mt-2 block text-xs font-semibold text-slate-600">
            Ver valor registrado →
          </span>
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <TransferModeChart analysis={analysis} />
        <ProviderBreakdown analysis={analysis} onOpenProvider={openProvider} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h4 className="font-bold text-slate-800">Traslados por fecha</h4>
        <p className="mt-1 text-sm text-slate-500">Detalle diario del período seleccionado.</p>
        <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-slate-100">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">
                  Fecha
                </th>
                <th scope="col" className="px-3 py-2 text-center">
                  Total
                </th>
                <th scope="col" className="px-3 py-2 text-center">
                  LATAM
                </th>
                <th scope="col" className="px-3 py-2 text-center">
                  Aerocardal
                </th>
                <th scope="col" className="px-3 py-2 text-center">
                  Fuerzas Armadas
                </th>
                <th scope="col" className="px-3 py-2 text-center">
                  Otros
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analysis.daily
                .slice()
                .reverse()
                .map(day => (
                  <tr key={day.date}>
                    <th scope="row" className="px-3 py-2 text-left font-medium text-slate-700">
                      {formatDateDDMMYYYY(day.date)}
                    </th>
                    <td className="px-3 py-2 text-center">
                      <CountButton
                        value={day.total}
                        label={`Traslados del ${formatDateDDMMYYYY(day.date)}`}
                        onClick={() =>
                          openTraceability(
                            `Traslados del ${formatDateDDMMYYYY(day.date)}`,
                            detail => detail.date === day.date
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <CountButton
                        value={day.latam}
                        label={`LATAM del ${formatDateDDMMYYYY(day.date)}`}
                        tone="text-sky-700"
                        onClick={() =>
                          openTraceability(
                            `Traslados LATAM del ${formatDateDDMMYYYY(day.date)}`,
                            detail => detail.date === day.date && detail.category === 'latam'
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <CountButton
                        value={day.aerocardal}
                        label={`Aerocardal del ${formatDateDDMMYYYY(day.date)}`}
                        tone="text-rose-700"
                        onClick={() =>
                          openTraceability(
                            `Traslados Aerocardal del ${formatDateDDMMYYYY(day.date)}`,
                            detail => detail.date === day.date && detail.category === 'aerocardal'
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <CountButton
                        value={day.armedForces}
                        label={`Fuerzas Armadas del ${formatDateDDMMYYYY(day.date)}`}
                        tone="text-indigo-700"
                        onClick={() =>
                          openTraceability(
                            `Traslados FACH / Armada del ${formatDateDDMMYYYY(day.date)}`,
                            detail =>
                              detail.date === day.date &&
                              (detail.category === 'fach' || detail.category === 'armada')
                          )
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <CountButton
                        value={day.other}
                        label={`Otros del ${formatDateDDMMYYYY(day.date)}`}
                        tone="text-slate-600"
                        onClick={() =>
                          openTraceability(
                            `Otros traslados del ${formatDateDDMMYYYY(day.date)}`,
                            detail =>
                              detail.date === day.date &&
                              (detail.category === 'other_air_ambulance' ||
                                detail.category === 'other')
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <p>
          “Avión comercial” se presenta como LATAM para esta operación. Avión ambulancia incluye
          Aerocardal, FACH, Armada y, por defecto, todo registro cuyo medio seleccionado sea “Otro”.
          El texto libre se conserva en el detalle para identificar la empresa o modalidad
          ingresada. Los medios explícitos no aeromédicos se mantienen en “Otros medios”.
        </p>
      </div>

      <TransferTraceabilityModal
        isOpen={traceability !== null}
        title={traceability?.title || 'Detalle de traslados'}
        transfers={traceability?.transfers || []}
        onClose={() => setTraceability(null)}
      />
    </section>
  );
};
