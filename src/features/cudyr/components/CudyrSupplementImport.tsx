import { useAuth } from '@/context/AuthContext';
import { useEffect, useRef, useState } from 'react';
import { readCudyrSupplementFile } from '@/services/cudyr/cudyrSupplementFile';
import { importCudyrSupplement, supplementMonths } from '@/services/cudyr/cudyrSupplementService';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

type Preview = Awaited<ReturnType<typeof readCudyrSupplementFile>>;
const CudyrSupplementImportSession = ({
  from,
  to,
  onSaved,
}: {
  from: string;
  to: string;
  onSaved: () => void;
}) => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [confirmed, setConfirmed] = useState(false);
  const active = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const owner = useRef({ key: getStoredSessionOwnerKey(), generation: getSessionGeneration() });
  const current = () =>
    owner.current.key === getStoredSessionOwnerKey() &&
    owner.current.generation === getSessionGeneration();
  useEffect(() => () => active.current?.abort(), []);
  const select = async (file: File) => {
    if (locked.current) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    setPreview(null);
    setConfirmed(false);
    try {
      const next = await readCudyrSupplementFile(file, controller.signal);
      if (!controller.signal.aborted && current()) {
        if (!supplementMonths(from, to).includes(next.report.month))
          throw new Error(
            'El archivo corresponde a otro mes. Consulte ese período antes de importarlo.'
          );
        setPreview(next);
      }
    } catch (e) {
      if (!controller.signal.aborted && current())
        setError(e instanceof Error ? e.message : 'No se pudo leer el archivo.');
    } finally {
      if (!controller.signal.aborted && current()) setBusy(false);
    }
  };
  const save = async () => {
    if (!preview || !confirmed || locked.current || !current()) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await importCudyrSupplement(preview);
      if (!current()) return;
      if (!result.persisted) throw new Error('Sin confirmación del servidor.');
      setPreview(null);
      setConfirmed(false);
      setMessage(
        result.status === 'already-recorded'
          ? 'Este archivo ya estaba guardado.'
          : 'Respaldo guardado.'
      );
      onSaved();
    } catch {
      if (current())
        setError(
          'No se confirmó el guardado. Puede reintentar; se conserva la misma operación para evitar duplicados.'
        );
    } finally {
      locked.current = false;
      if (current()) setBusy(false);
    }
  };
  return (
    <div className="mt-4 space-y-3 border-t pt-4 text-sm">
      <label className="block font-medium">
        Agregar informe mensual de Eloísa
        <input
          type="file"
          accept=".xls,.xlsx"
          disabled={busy}
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void select(file);
          }}
          className="mt-2 block max-w-full text-xs"
        />
      </label>
      <p className="text-xs text-slate-500">
        XLS/XLSX original, hasta 256 KiB. El archivo y su versión quedarán conservados en HHR.
      </p>
      {busy && <p role="status">Procesando…</p>}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-teal-800">
          {message}
        </p>
      )}
      {preview && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <p>
            <strong>{preview.file.name}</strong> · {preview.report.month} ·{' '}
            {preview.report.patients.length} filas de pacientes ·{' '}
            {
              preview.report.patients.flatMap(p => p.days).filter(d => d.state === 'category')
                .length
            }{' '}
            celdas con categoría
          </p>
          <p>{preview.report.generatedLabel || 'Impresión sin fecha informada'}</p>
          <p className="text-xs">
            Ejemplo fuente: {preview.report.patients[0].patientName} ·{' '}
            {preview.report.patients[0].document || 'Sin documento'} ·{' '}
            {preview.report.patients[0].diagnosis || 'Sin diagnóstico'}
          </p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={e => setConfirmed(e.target.checked)}
            />
            He revisado el archivo y el mes. Guardar como respaldo consultivo, sin modificar el
            cálculo principal.
          </label>
          <button
            type="button"
            disabled={busy || !confirmed}
            onClick={() => void save()}
            className="rounded-lg bg-teal-700 px-3 py-2 font-medium text-white disabled:opacity-40"
          >
            Guardar respaldo
          </button>
        </div>
      )}
    </div>
  );
};

/** A new authorized session gets a fresh preview; old in-flight operations retain their guard. */
export const CudyrSupplementImport = (props: { from: string; to: string; onSaved: () => void }) => {
  const { currentUser, role } = useAuth();
  const key = [currentUser?.uid, role, getStoredSessionOwnerKey(), getSessionGeneration()].join(
    ':'
  );
  return <CudyrSupplementImportSession key={key} {...props} />;
};
