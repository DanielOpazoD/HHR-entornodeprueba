import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FlaskConical } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { LabPatient } from '@/types/domain/labExamTypes';
import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import {
  calendarStampInClinicalTimeZone,
  getClinicalCalendarDateISO,
} from '@/utils/clinicalTimeZone';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import { onExalabSessionAvailable } from '@/services/laboratory/exalabExtensionBridge';
import {
  autoConnectExalab,
  connectExalab,
  disconnectExalab,
  exalabStatus,
  fetchExalabPdf,
  searchExalab,
  ExalabRequestError,
  type ExalabExam,
  type ExalabSessionStatus,
} from '@/services/laboratory/exalabService';

const inputClass =
  'min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500';
const buttonClass =
  'rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600';
const displayDate = (value: string) => value.split('-').reverse().join('/');
const EXALAB_HOME = 'https://exalab.saludoriente.cl/web_ssmo/index.php';
const LOGIN_NOTICE = 'Abre Exalab e ingresa con ClaveÚnica. HHR se conectará solo.';
const connectedNotice = (expiresAt: number | null) =>
  expiresAt
    ? `Tu sesión Exalab está conectada · vigente hasta las ${calendarStampInClinicalTimeZone(new Date(expiresAt)).hhmm}.`
    : 'Tu sesión Exalab está conectada.';
const isSessionRequired = (failure: unknown) =>
  failure instanceof ExalabRequestError && failure.code === 'SESSION_REQUIRED';

export const ExalabResultsViewerModal = ({
  onClose,
  patients,
  initialPatientRut,
  sourceSelector,
}: {
  onClose: () => void;
  patients: LabPatient[];
  initialPatientRut?: string;
  sourceSelector: ReactNode;
}) => {
  const [rut, setRut] = useState(initialPatientRut || patients[0]?.rut || '');
  const [to, setTo] = useState(() => getClinicalCalendarDateISO());
  const [from, setFrom] = useState(() => `${getClinicalCalendarDateISO().slice(0, 4)}-01-01`);
  const [connected, setConnected] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('Comprobando tu sesión Exalab…');
  const [exams, setExams] = useState<ExalabExam[]>([]);
  const [searchedRange, setSearchedRange] = useState<{ from: string; to: string } | null>(null);
  const [pdf, setPdf] = useState<{ exam: ExalabExam; url: string } | null>(null);
  const active = useRef<{ controller: AbortController; id: number } | null>(null);
  const sequence = useRef(0);
  const pdfUrl = useRef<string | null>(null);
  const initialCheck = useRef<AbortController | null>(null);
  const connectedRef = useRef(false);
  const busyRef = useRef(false);
  const needsLoginRef = useRef(false);
  const manualPending = useRef(false);
  connectedRef.current = connected;
  busyRef.current = busy;
  needsLoginRef.current = needsLogin;
  const applyStatus = (status: ExalabSessionStatus) => {
    setConnected(status.connected);
    if (status.connected) {
      setNeedsLogin(false);
      manualPending.current = false;
      setNotice(connectedNotice(status.expiresAt));
    }
  };
  /**
   * Silent reconnection through the extension (one-time consent per PC). True when connected;
   * otherwise leaves the state that tells the person what is missing.
   */
  const reconnect = async (signal: AbortSignal, current: () => boolean): Promise<boolean> => {
    setNotice('Conectando con tu sesión de Exalab…');
    const outcome = await autoConnectExalab(signal);
    if (!current()) return false;
    if (outcome === 'connected') {
      const status = await exalabStatus(signal);
      if (current()) applyStatus(status);
      return status.connected;
    }
    setConnected(false);
    const login = outcome === 'no_session' || outcome === 'rejected';
    needsLoginRef.current = login;
    setNeedsLogin(login);
    setNotice(login ? LOGIN_NOTICE : 'Conecta tu sesión personal de Exalab.');
    return false;
  };
  const clearPdf = () => {
    if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current);
    pdfUrl.current = null;
    setPdf(null);
  };
  const run = async (operation: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    initialCheck.current?.abort();
    active.current?.controller.abort();
    const controller = new AbortController();
    const id = ++sequence.current;
    const epoch = getSessionEpoch();
    active.current = { controller, id };
    setBusy(true);
    setError(null);
    const current = () =>
      !controller.signal.aborted && sequence.current === id && getSessionEpoch() === epoch;
    let reconnected = false;
    try {
      try {
        await operation(controller.signal, current);
      } catch (failure) {
        // One silent reconnection per action, then the same action once more; never a loop.
        if (!isSessionRequired(failure) || !current()) throw failure;
        reconnected = true;
        if (!(await reconnect(controller.signal, current)) || !current()) throw failure;
        await operation(controller.signal, current);
      }
    } catch (failure) {
      if (current()) {
        if (isSessionRequired(failure)) {
          setConnected(false);
          if (!reconnected) setNotice('Conecta o renueva tu sesión personal de Exalab.');
        }
        // The login notice already says what to do; repeating it as an alert adds nothing.
        if (!(reconnected && isSessionRequired(failure) && needsLoginRef.current))
          setError(
            failure instanceof Error ? failure.message : 'No se pudo completar la consulta Exalab.'
          );
      }
    } finally {
      if (current()) setBusy(false);
    }
  };
  const check = () =>
    run(async (signal, current) => {
      const status = await exalabStatus(signal);
      if (current()) {
        applyStatus(status);
        if (!status.connected) setNotice('Conecta tu sesión personal de Exalab.');
      }
    });
  // The mount effect and its listeners always call the latest action helpers.
  const latest = useRef({ run, reconnect });
  latest.current = { run, reconnect };
  useEffect(() => {
    const controller = new AbortController();
    initialCheck.current = controller;
    const epoch = getSessionEpoch();
    const current = () => !controller.signal.aborted && epoch === getSessionEpoch();
    void (async () => {
      try {
        const status = await exalabStatus(controller.signal).catch(failure => {
          if (isSessionRequired(failure)) return { connected: false, expiresAt: null };
          throw failure;
        });
        if (!current()) return;
        if (status.connected) applyStatus(status);
        else await latest.current.reconnect(controller.signal, current);
      } catch (failure) {
        if (current()) {
          setNotice('Conecta tu sesión personal de Exalab.');
          if (!isSessionRequired(failure))
            setError(failure instanceof Error ? failure.message : 'No se pudo comprobar Exalab.');
        }
      }
    })();
    // A new Exalab login in this browser reconnects by itself while the panel is open.
    const stopListening = onExalabSessionAvailable(() => {
      if (!connectedRef.current && !busyRef.current)
        void latest.current.run(async (signal, current) => {
          await latest.current.reconnect(signal, current);
        });
    });
    // Back from the consent tab: confirm the new connection without asking for a click.
    const onFocus = () => {
      if (manualPending.current && !connectedRef.current && !busyRef.current)
        void latest.current.run(async (signal, current) => {
          const status = await exalabStatus(signal);
          if (current()) applyStatus(status);
        });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      stopListening();
      window.removeEventListener('focus', onFocus);
      controller.abort();
      active.current?.controller.abort();
      if (pdfUrl.current) URL.revokeObjectURL(pdfUrl.current);
    };
  }, []);
  const changePatient = (value: string) => {
    active.current?.controller.abort();
    sequence.current++;
    setBusy(false);
    setRut(value);
    setExams([]);
    setSearchedRange(null);
    setError(null);
    clearPdf();
  };
  const search = () => {
    if (!/^[\d.]+-[\dkK]$/.test(rut.trim()) || !isValidRut(rut)) {
      setError('Introduce un RUT válido con dígito verificador.');
      return;
    }
    if (!from || !to || from > to) {
      setError('Selecciona un período válido.');
      return;
    }
    const clean = normalizeRut(rut);
    const canonical = `${clean.slice(0, -1)}-${clean.slice(-1)}`;
    void run(async (signal, current) => {
      const data = await searchExalab(canonical, from, to, signal);
      if (current()) {
        clearPdf();
        setExams(data);
        setSearchedRange({ from, to });
        setConnected(true);
      }
    });
  };
  const openPdf = (exam: ExalabExam) =>
    void run(async (signal, current) => {
      const blob = await fetchExalabPdf(exam.link, signal);
      if (current()) {
        clearPdf();
        const url = URL.createObjectURL(blob);
        pdfUrl.current = url;
        setPdf({ exam, url });
      }
    });
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      variant="white"
      size="full"
      dataModule="laboratory"
      dataTestId="exalab-results-viewer-modal"
      title="Laboratorio / Exalab"
      icon={<FlaskConical size={16} />}
      headerIconColor="text-emerald-600"
      bodyClassName="max-h-[90vh] overflow-y-auto p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap">{sourceSelector}</div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">Exámenes de otros centros · SSMO</p>
          <p role="status" className="text-xs text-slate-600">
            {notice}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {needsLogin && !connected ? (
            <a className={buttonClass} href={EXALAB_HOME} target="_blank" rel="noopener noreferrer">
              Abrir Exalab
            </a>
          ) : null}
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() =>
              void run(async (signal, current) => {
                await connectExalab(signal);
                if (current()) {
                  manualPending.current = true;
                  setNotice(
                    'Completa la conexión en la pestaña de Chrome. HHR la detectará al volver.'
                  );
                }
              })
            }
          >
            {connected ? 'Renovar sesión' : 'Conectar Exalab'}
          </button>
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => void check()}
          >
            Comprobar sesión
          </button>
          {connected ? (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                void run(async (signal, current) => {
                  await disconnectExalab(signal);
                  if (current()) {
                    setConnected(false);
                    setNeedsLogin(false);
                    setNotice('Tu sesión Exalab se desconectó.');
                    setExams([]);
                    setSearchedRange(null);
                    clearPdf();
                  }
                })
              }
            >
              Desconectar
            </button>
          ) : null}
        </div>
      </div>
      <form
        onSubmit={event => {
          event.preventDefault();
          search();
        }}
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">
          Paciente del censo
          <select
            className={inputClass}
            value={patients.some(patient => patient.rut === rut) ? rut : ''}
            onChange={event => changePatient(event.target.value)}
          >
            <option value="">RUT externo</option>
            {patients.map(patient => (
              <option key={patient.bedId} value={patient.rut}>
                {patient.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">
          RUT del paciente
          <input
            className={inputClass}
            value={rut}
            onChange={event => changePatient(event.target.value)}
            placeholder="12.345.678-5"
            autoComplete="off"
            required
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">
          Desde · fecha del informe Exalab
          <input
            className={inputClass}
            type="date"
            value={from}
            max={to || undefined}
            onChange={event => setFrom(event.target.value)}
            required
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-700">
          Hasta · fecha del informe Exalab
          <input
            className={inputClass}
            type="date"
            value={to}
            min={from || undefined}
            onChange={event => setTo(event.target.value)}
            required
          />
        </label>
        <button type="submit" className={buttonClass} disabled={busy || !connected || !rut}>
          {busy ? 'Consultando…' : 'Buscar en Exalab'}
        </button>
      </form>
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {error}
        </p>
      ) : null}
      {pdf ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className={buttonClass} onClick={clearPdf}>
              Volver a los informes
            </button>
            <span className="text-sm text-slate-600">
              {pdf.exam.laboratory} · Folio {pdf.exam.id}
            </span>
            <a className={buttonClass} href={pdf.url} download={`Exalab_${pdf.exam.id}.pdf`}>
              Descargar PDF original
            </a>
          </div>
          <iframe
            src={pdf.url}
            title={`PDF Exalab folio ${pdf.exam.id}`}
            className="h-[65vh] w-full rounded-lg border border-slate-200"
          />
        </div>
      ) : searchedRange ? (
        <div>
          {exams[0] ? (
            <p className="mb-1 text-sm font-semibold text-slate-800">
              {exams[0].patientName} · {exams[0].rut}
            </p>
          ) : null}
          <p className="mb-2 text-xs text-slate-600">
            {exams.length} informe(s) · {displayDate(searchedRange.from)}–
            {displayDate(searchedRange.to)} · Fechas y horas informadas por Exalab
          </p>
          {exams.length ? (
            <div className="overflow-x-auto">
              <table className="block w-full text-left text-sm sm:table">
                <thead className="hidden sm:table-header-group">
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    {['Fecha y hora de origen', 'Centro', 'Folio / exámenes', 'Informe'].map(
                      label => (
                        <th key={label} scope="col" className="p-2">
                          {label}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="grid gap-3 sm:table-row-group">
                  {exams.map(exam => (
                    <tr
                      key={exam.link}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-lg border border-slate-200 p-3 sm:table-row sm:rounded-none sm:border-0 sm:border-b sm:border-slate-100 sm:p-0"
                    >
                      <td className="col-start-1 row-start-2 block whitespace-nowrap sm:table-cell sm:p-2">
                        {displayDate(exam.date)}
                        <br />
                        <span className="text-xs text-slate-500">{exam.time}</span>
                      </td>
                      <td className="col-span-2 row-start-1 block font-semibold sm:table-cell sm:p-2 sm:font-normal">
                        {exam.laboratory}
                      </td>
                      <td className="col-start-1 row-start-3 block max-w-md sm:table-cell sm:p-2">
                        <span className="font-semibold">
                          <span className="sm:hidden">Folio </span>
                          {exam.id}
                        </span>
                        <p className="break-words text-xs text-slate-600">{exam.exams}</p>
                      </td>
                      <td className="col-start-2 row-span-2 row-start-2 block self-center sm:table-cell sm:p-2">
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={busy}
                          onClick={() => openPdf(exam)}
                        >
                          Ver PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-slate-500">
              Exalab no informó exámenes en este período.
            </p>
          )}
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">
          Selecciona el paciente y el período para consultar Exalab.
        </p>
      )}
    </BaseModal>
  );
};
