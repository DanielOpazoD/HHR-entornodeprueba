import { useEffect, useMemo, useRef, useState } from 'react';
import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import {
  buildCudyrRecoveryPlan,
  CUDYR_RECOVERY_LABELS,
  cudyrRecoveryGuidance,
  type CudyrRecoveryCase,
} from '@/services/cudyr/cudyrRecoveryPlan';

export const CudyrRecoveryPanel = ({
  data,
  onView,
}: {
  data: CudyrReportDataset;
  onView: (key: string) => void;
}) => {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const cases = useMemo(() => buildCudyrRecoveryPlan(data), [data]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const filtered = cases.filter(c =>
    `${c.patientName} ${c.document}`
      .toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es'))
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1));
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { downloadCudyrRecoveryPlan } = await import('@/services/cudyr/cudyrRecoveryWorkbook');
      if (!active.current) return;
      await downloadCudyrRecoveryPlan(
        data,
        cases.filter(c => selected.includes(c.key))
      );
      setMessage('Lista descargada con los datos ya leídos. No se consultó Eloísa.');
    } catch {
      setMessage('No se pudo generar la lista. Intente nuevamente.');
    } finally {
      setBusy(false);
    }
  };
  const openEpisode = async (entry: CudyrRecoveryCase) => {
    if (busy || !entry.canOpenEpisode) return;
    setBusy(true);
    setMessage('');
    try {
      const { requestRayenEncounterNavigation } =
        await import('@/features/rayen-import/clinical-panel');
      if (!active.current) return;
      const result = await requestRayenEncounterNavigation(entry.episodeId);
      setMessage(
        result.ok
          ? 'Ficha abierta para cotejo. Abrirla no recupera ni guarda CUDYR en HHR.'
          : result.error || 'No se pudo abrir la ficha.'
      );
    } catch {
      setMessage('No se pudo abrir la ficha. Compruebe la extensión y la sesión de Eloísa.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="my-3 rounded-lg border border-slate-200 bg-white p-3"
      data-testid="cudyr-recovery-plan"
    >
      <summary className="cursor-pointer font-semibold text-teal-900">
        Preparar búsqueda dirigida · {cases.length} casos con información por cotejar
      </summary>
      <p className="my-2 text-xs text-slate-600">
        Seleccione hasta 20 casos presentes en HHR. Los días en cuna o CMA están excluidos; un
        cambio posterior a cama elegible se analiza por día. Las filas Eloísa sin candidato siguen
        en la conciliación.
      </p>
      <p className="my-2 text-xs text-slate-600">
        No encontrado no significa no aplicado. El turno de fin de mes puede incluir la mañana del
        mes siguiente; conserve la fecha original y el día censal.
      </p>
      <div className="my-3 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          Buscar caso para recuperación
          <input
            className="mt-1 block rounded border p-2"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <button
          type="button"
          disabled={!selected.length || busy}
          className="rounded bg-teal-800 px-3 py-2 text-white disabled:opacity-50"
          onClick={() => void download()}
        >
          Descargar lista de búsqueda ({selected.length}/20)
        </button>
        {!!selected.length && (
          <button type="button" className="underline" onClick={() => setSelected([])}>
            Limpiar selección
          </button>
        )}
      </div>
      {message && (
        <p role="status" className="my-2 text-sm">
          {message}
        </p>
      )}
      <div className="space-y-2">
        {filtered.slice(currentPage * 10, currentPage * 10 + 10).map(entry => (
          <article key={entry.key} className="rounded border bg-slate-50 p-3 text-xs">
            <label className="flex items-start gap-2 font-semibold">
              <input
                type="checkbox"
                checked={selected.includes(entry.key)}
                disabled={!selected.includes(entry.key) && selected.length >= 20}
                onChange={e =>
                  setSelected(previous =>
                    e.target.checked
                      ? [...previous, entry.key]
                      : previous.filter(key => key !== entry.key)
                  )
                }
              />
              {entry.patientName || 'Sin nombre'} · {entry.document || 'Sin documento'}
            </label>
            <p className="mt-1">
              Episodio {entry.episodeId || 'por confirmar'} · {entry.rows.length} días por cotejar
            </p>
            <p className="mt-1 text-amber-950">
              {entry.needs.map(n => CUDYR_RECOVERY_LABELS[n]).join(' · ')}
            </p>
            <p className="my-2">{cudyrRecoveryGuidance(entry)}</p>
            <details>
              <summary className="cursor-pointer underline">Días y contexto HHR</summary>
              <ul className="mt-2 space-y-1">
                {entry.rows.map(({ row }) => (
                  <li key={row.key}>
                    {row.date} · {row.bedId || 'Sin cama'} · {row.diagnosis || 'Sin diagnóstico'} ·{' '}
                    <button type="button" className="underline" onClick={() => onView(row.key)}>
                      Ver contexto del {row.date}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
            <button
              type="button"
              className="mt-2 underline disabled:opacity-50"
              disabled={!entry.canOpenEpisode || busy}
              onClick={() => void openEpisode(entry)}
            >
              Abrir ficha del episodio en Eloísa
            </button>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <p>
          No hay casos con esos criterios en esta lectura. Esto no certifica la completitud del mes.
        </p>
      )}
      <nav
        aria-label="Páginas de búsqueda dirigida"
        className="mt-3 flex items-center justify-between"
      >
        <button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>
          Anterior
        </button>
        <span>
          {currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 10))}
        </span>
        <button
          type="button"
          disabled={(currentPage + 1) * 10 >= filtered.length}
          onClick={() => setPage(currentPage + 1)}
        >
          Siguiente
        </button>
      </nav>
    </details>
  );
};
