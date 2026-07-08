import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Save } from 'lucide-react';
import type { PrescriptionRecord } from '@/types/prescriptionTypes';
import {
  FALLBACK_DAYS_BACK,
  formatDayLabel,
  formatPatientStatus,
  resolveDayWithBeds,
  todayIso,
  type DailyBedOption,
} from '@/features/prescriptions/components/prescriptionReassignDialogSupport';

interface PrescriptionReassignDialogProps {
  record: PrescriptionRecord;
  onClose: () => void;
  onSubmit: (patch: {
    bedId?: string;
    patientName?: string;
    patientRut?: string;
    clear: boolean;
  }) => Promise<void>;
  /**
   * ISO yyyy-mm-dd of the day whose census is offered as the bed picker.
   * `null` means "use today" — the most common case from the visor.
   */
  selectedDate: string | null;
}

export const PrescriptionReassignDialog: React.FC<PrescriptionReassignDialogProps> = ({
  record,
  onClose,
  onSubmit,
  selectedDate,
}) => {
  const requestedDay = selectedDate ?? todayIso();

  const [bedOptions, setBedOptions] = useState<DailyBedOption[]>([]);
  const [resolvedDay, setResolvedDay] = useState<string | null>(null);
  const [bedsPhase, setBedsPhase] = useState<
    | { kind: 'loading'; day: string }
    | { kind: 'ready'; day: string }
    | { kind: 'error'; day: string; message: string }
  >({ kind: 'loading', day: requestedDay });

  const [selectedBedId, setSelectedBedId] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [manualBedId, setManualBedId] = useState(record.bedId ?? '');
  const [manualPatientName, setManualPatientName] = useState(record.patientName ?? '');
  const [manualPatientRut, setManualPatientRut] = useState(record.patientRut ?? '');
  const [clear, setClear] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBedsPhase({ kind: 'loading', day: requestedDay });
    resolveDayWithBeds(requestedDay)
      .then(({ bedOptions: options, resolvedDay: day }) => {
        if (cancelled) return;
        setBedOptions(options);
        setResolvedDay(day);
        const match = record.bedId ? options.find(option => option.bedId === record.bedId) : null;
        setSelectedBedId(match ? match.bedId : '');
        setBedsPhase({ kind: 'ready', day: requestedDay });
      })
      .catch(caught => {
        if (cancelled) return;
        setBedOptions([]);
        setResolvedDay(null);
        setBedsPhase({
          kind: 'error',
          day: requestedDay,
          message:
            caught instanceof Error ? caught.message : 'No se pudo cargar la base censal del día.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [requestedDay, record.bedId]);

  const dayLabel = useMemo(
    () => formatDayLabel(resolvedDay ?? requestedDay),
    [resolvedDay, requestedDay]
  );

  const usingFallbackDay = !!resolvedDay && resolvedDay !== requestedDay;

  const selectedOption = useMemo(
    () => bedOptions.find(option => option.bedId === selectedBedId) ?? null,
    [bedOptions, selectedBedId]
  );

  const canSubmit =
    !submitting &&
    (clear ||
      (manualMode ? manualBedId.trim().length > 0 : !!selectedOption && bedOptions.length > 0));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (!clear) {
      if (manualMode) {
        if (!manualBedId.trim()) {
          setError('Indica al menos la cama para asignar la receta.');
          return;
        }
      } else if (!selectedOption) {
        setError('Selecciona una cama de la base del día o marca "sin paciente asignado".');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload = clear
        ? { bedId: undefined, patientName: undefined, patientRut: undefined, clear: true }
        : manualMode
          ? {
              bedId: manualBedId.trim(),
              patientName: manualPatientName.trim() || undefined,
              patientRut: manualPatientRut.trim() || undefined,
              clear: false,
            }
          : {
              bedId: selectedOption?.bedId,
              patientName: selectedOption?.patientName || undefined,
              patientRut: selectedOption?.patientRut || undefined,
              clear: false,
            };
      await onSubmit(payload);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar la reasignación.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderBedPicker = () => {
    if (bedsPhase.kind === 'loading') {
      return (
        <p className="mt-1 inline-flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={12} className="animate-spin" /> Cargando camas…
        </p>
      );
    }
    if (bedsPhase.kind === 'error') {
      return <p className="mt-1 text-xs text-red-600">{bedsPhase.message}</p>;
    }
    if (bedOptions.length === 0) {
      return (
        <div className="mt-1 space-y-2">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No se encontraron pacientes activos en los últimos {FALLBACK_DAYS_BACK} días. Marca
            &quot;sin paciente asignado&quot; o ingresa manualmente.
          </p>
          <button
            type="button"
            onClick={() => setManualMode(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Pencil size={12} /> Ingresar manualmente
          </button>
        </div>
      );
    }
    return (
      <>
        <select
          value={selectedBedId}
          onChange={event => setSelectedBedId(event.target.value)}
          disabled={submitting}
          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
        >
          <option value="">— Selecciona una cama —</option>
          {bedOptions.map(option => (
            <option key={option.bedId} value={option.bedId}>
              {option.bedId} · {option.patientName || 'Sin nombre'}
              {option.patientRut ? ` (${option.patientRut})` : ''} ·{' '}
              {formatPatientStatus(option.patientStatus)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setManualMode(true)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
        >
          <Pencil size={11} /> ¿No encuentras la cama? Ingresar manualmente
        </button>
      </>
    );
  };

  const renderManualInputs = () => (
    <div className="space-y-2">
      <label className="block">
        <span className="text-xs text-slate-500">Cama</span>
        <input
          type="text"
          value={manualBedId}
          onChange={event => setManualBedId(event.target.value)}
          disabled={submitting}
          maxLength={32}
          placeholder="Ej: H5C1"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-500">Nombre paciente (opcional)</span>
        <input
          type="text"
          value={manualPatientName}
          onChange={event => setManualPatientName(event.target.value)}
          disabled={submitting}
          maxLength={256}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
        />
      </label>
      <label className="block">
        <span className="text-xs text-slate-500">RUT (opcional)</span>
        <input
          type="text"
          value={manualPatientRut}
          onChange={event => setManualPatientRut(event.target.value)}
          disabled={submitting}
          maxLength={32}
          placeholder="11.111.111-1"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
        />
      </label>
      {bedOptions.length > 0 && (
        <button
          type="button"
          onClick={() => setManualMode(false)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-700"
        >
          ← Volver al selector de camas
        </button>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-slate-500">
        Reasigna la receta usando la base censal de{' '}
        <span className="font-semibold capitalize text-slate-700">{dayLabel}</span>.
        {usingFallbackDay && (
          <span className="ml-1 text-amber-700">
            (no había datos para {formatDayLabel(requestedDay)}; se usó el día más reciente con
            pacientes)
          </span>
        )}
      </p>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={clear}
          onChange={event => setClear(event.target.checked)}
          disabled={submitting}
          className="accent-slate-600"
        />
        Marcar como “sin paciente asignado”
      </label>

      {!clear && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {manualMode ? 'Datos manuales' : 'Cama del día'}
          </span>
          {manualMode ? renderManualInputs() : renderBedPicker()}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Guardando…
            </>
          ) : (
            <>
              <Save size={14} /> Guardar
            </>
          )}
        </button>
      </div>
    </form>
  );
};
