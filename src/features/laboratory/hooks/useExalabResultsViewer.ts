import { useEffect, useRef, useState } from 'react';
import type { ExalabExam, LabPatient } from '@/types/domain/labExamTypes';
import { isValidRut, normalizeRut } from '@/utils/rutUtils';
import {
  calendarStampInClinicalTimeZone,
  getClinicalCalendarDateISO,
} from '@/utils/clinicalTimeZone';
import { sessionEpochGuard } from '@/services/session/sessionStorageTransition';
import { useLatestRef } from '@/hooks/useLatestRef';
import { onExalabSessionAvailable } from '../services/exalabExtensionBridge';
import {
  autoConnectExalab,
  connectExalab,
  disconnectExalab,
  exalabStatus,
  fetchExalabPdf,
  searchExalab,
  ExalabRequestError,
  type ExalabSessionStatus,
} from '../services/exalabService';

const LOGIN_NOTICE = 'Abre Exalab e ingresa con ClaveÚnica. HHR se conectará solo.';

const connectedNotice = (expiresAt: number | null) =>
  expiresAt
    ? `Tu sesión Exalab está conectada · vigente hasta las ${calendarStampInClinicalTimeZone(new Date(expiresAt)).hhmm}.`
    : 'Tu sesión Exalab está conectada.';

const isSessionRequired = (failure: unknown) =>
  failure instanceof ExalabRequestError && failure.code === 'SESSION_REQUIRED';

export interface UseExalabResultsViewerParams {
  patients: LabPatient[];
  initialPatientRut?: string;
}

export const useExalabResultsViewer = ({
  patients,
  initialPatientRut,
}: UseExalabResultsViewerParams) => {
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
  const connectedRef = useLatestRef(connected);
  const busyRef = useLatestRef(busy);
  // reconnect also writes it, so a retry in the same action sees the new value before a render.
  const needsLoginRef = useLatestRef(needsLogin);
  const manualPending = useRef(false);

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
    const isSessionShown = sessionEpochGuard();
    active.current = { controller, id };
    setBusy(true);
    setError(null);
    const current = () => !controller.signal.aborted && sequence.current === id && isSessionShown();
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

  const connect = () =>
    void run(async (signal, current) => {
      await connectExalab(signal);
      if (current()) {
        manualPending.current = true;
        setNotice('Completa la conexión en la pestaña de Chrome. HHR la detectará al volver.');
      }
    });

  const check = () =>
    void run(async (signal, current) => {
      const status = await exalabStatus(signal);
      if (current()) {
        applyStatus(status);
        if (!status.connected) setNotice('Conecta tu sesión personal de Exalab.');
      }
    });

  const disconnect = () =>
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
    });

  // The mount effect and its listeners always call the latest action helpers.
  const latest = useLatestRef({ run, reconnect });
  useEffect(() => {
    const controller = new AbortController();
    initialCheck.current = controller;
    const isSessionShown = sessionEpochGuard();
    const current = () => !controller.signal.aborted && isSessionShown();
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
  }, [busyRef, connectedRef, latest]);

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

  return {
    rut,
    from,
    to,
    setFrom,
    setTo,
    connected,
    needsLogin,
    busy,
    error,
    notice,
    exams,
    searchedRange,
    pdf,
    connect,
    check,
    disconnect,
    changePatient,
    search,
    openPdf,
    clearPdf,
  };
};
