import { useEffect, useRef, useState } from 'react';
import { BaseModal } from '@/components/shared/BaseModal';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import {
  monthlyRecoveryPeriod,
  recoverCudyrMonthlyReports,
  type MonthlyRecoveryProgress,
  type MonthlyRecoveryResult,
} from '@/services/cudyr/cudyrMonthlyRecovery';

/** Complementary source recovery; it never changes eligibility or clinical observations. */
export const CudyrMonthlyRecovery = ({
  month,
  onSaved,
  compact = false,
}: {
  month: string;
  onSaved: () => void;
  compact?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<MonthlyRecoveryProgress[]>([]);
  const [result, setResult] = useState<MonthlyRecoveryResult | null>(null);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  const period = monthlyRecoveryPeriod(month);
  const [closed, setClosed] = useState(
    () => resolveCudyrPendingStatus(period.last).phase === 'overdue'
  );
  useEffect(() => {
    const update = () => {
      const next = resolveCudyrPendingStatus(period.last).phase === 'overdue';
      setClosed(next);
      return next;
    };
    if (update()) return;
    const timer = setInterval(() => {
      if (update()) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [period.last]);
  const start = async () => {
    if (active.current || !closed) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setResult(null);
    setProgress([]);
    try {
      const value = await recoverCudyrMonthlyReports(month, controller.signal, item => {
        if (!controller.signal.aborted)
          setProgress(previous => [
            ...previous.filter(p => p.reportMonth !== item.reportMonth),
            item,
          ]);
      });
      if (!controller.signal.aborted) {
        setResult(value);
        onSaved();
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : 'No se pudo consultar el archivo.');
    } finally {
      if (active.current === controller) active.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const content = (
    <>
      <p className="mt-3 text-slate-600">
        Guarda los censos diarios y los informes CUDYR de {month}, incluida la mañana del
        {period.next}. Reutiliza los respaldos confirmados en Firebase.
      </p>
      <p className="mt-2 text-amber-800">
        Concilia pacientes y turnos con los datos guardados. Autor y hora se conservan cuando
        existen. La aprobación oficial del mes se realiza por separado.
      </p>
      <button
        type="button"
        onClick={() => void start()}
        disabled={busy || !closed}
        className="mt-3 rounded-lg border border-teal-700 px-3 py-2 font-medium text-teal-800 disabled:opacity-50"
      >
        {busy ? 'Recuperando…' : 'Completar y verificar mes'}
      </button>
      {busy && (
        <button
          type="button"
          disabled={active.current?.signal.aborted}
          className="ml-3 text-slate-600 underline disabled:opacity-50"
          onClick={() => {
            active.current?.abort();
            setError(
              'Deteniendo: se espera la respuesta del guardado en curso antes de permitir otro intento.'
            );
          }}
        >
          Detener
        </button>
      )}
      {!closed && (
        <p className="mt-2 text-slate-500">
          Disponible cuando cierre el último turno, al mediodía del primer día del mes siguiente.
        </p>
      )}
      <div role="status" className="mt-2 max-h-40 overflow-y-auto text-xs text-slate-600">
        {progress.map(p => (
          <p key={p.reportMonth}>
            {p.reportMonth} ·{' '}
            {
              {
                reading: 'Consultando Eloísa',
                reused: 'Respaldo reutilizado de Firebase',
                saved: 'Guardado en Firebase',
                failed: 'Consulta o guardado incompleto; puede reintentarse',
              }[p.status]
            }
          </p>
        ))}
      </div>
      {result && (
        <p className="mt-2 text-slate-600">
          {result.recovered} informes guardados · {result.reused} reutilizados ·{' '}
          {result.failures.length} consultas pendientes. Resultados y elegibilidad se informan por
          separado.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      )}
      {result?.verificationError && (
        <p role="status" className="text-amber-800">
          {result.verificationError}
        </p>
      )}
      {result?.verificationResult && (
        <div className="mt-3 space-y-2">
          <p>
            Informes CUDYR verificados: {result.reports.length}/2 · Censos HHR disponibles:{' '}
            {result.verificationResult.daysAvailable}/{result.verificationResult.expectedDays}.
            Censos cotejados con Eloísa: {result.verificationResult.censusVerified}/
            {result.verificationResult.expectedDays}.
          </p>
          <p>
            {result.verificationResult.checks.filter(c => c.state === 'found').length} categorías en
            fuente · {result.verificationResult.checks.filter(c => c.state === 'empty').length}{' '}
            celdas consultadas sin categoría · {result.verificationResult.unresolved} casos por
            cotejar.
          </p>
          {result.verificationResult.censusIncomplete && (
            <p className="text-amber-800">
              Faltan censos o hubo lecturas incompletas. No se acredita el universo del mes.
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-teal-800">
              Ver comprobaciones del informe
            </summary>
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr>
                    <th>Fecha Eloísa</th>
                    <th>Paciente</th>
                    <th>Categoría</th>
                    <th>Comprobación</th>
                  </tr>
                </thead>
                <tbody>
                  {result.verificationResult.checks.map(c => (
                    <tr key={c.key} className="border-t">
                      <td className="p-1 whitespace-nowrap">{c.date}</td>
                      <td className="p-1">{c.patientName}</td>
                      <td className="p-1">{c.result}</td>
                      <td className="p-1">{c.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </>
  );
  if (compact)
    return (
      <>
        <button
          type="button"
          disabled={!closed}
          title={!closed ? 'Disponible al cerrar el último turno del mes.' : undefined}
          className="inline-flex items-center rounded-lg border border-teal-700 bg-white px-3 py-2 text-sm font-medium text-teal-800 disabled:opacity-40"
          onClick={() => {
            setOpen(true);
            if (!busy) void start();
          }}
        >
          {busy ? 'Ver progreso del mes' : 'Completar y verificar mes'}
        </button>
        <BaseModal
          isOpen={open}
          onClose={() => setOpen(false)}
          title={`Recuperación del mes · ${month}`}
          size="lg"
        >
          <div className="text-sm" data-testid="cudyr-monthly-recovery">
            {content}
          </div>
        </BaseModal>
      </>
    );
  return (
    <details
      className="rounded-xl border border-slate-200 bg-white p-4 text-sm"
      data-testid="cudyr-monthly-recovery"
    >
      <summary className="cursor-pointer font-medium">Recuperación histórica del mes</summary>
      {content}
    </details>
  );
};
