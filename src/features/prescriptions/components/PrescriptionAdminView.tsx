import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  QrCode,
  RefreshCw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { setPrescriptionAccessPin } from '@/features/prescriptions/services/prescriptionAccessService';
import {
  buildPrescriptionsUploadUrl,
  renderPrescriptionsUploadQrDataUrl,
} from '@/features/prescriptions/services/prescriptionQrCodeService';
import { writeClipboardText } from '@/shared/runtime/browserClipboardRuntime';

const QR_PIXEL_SIZE = 360;

type PinPhase = 'idle' | 'submitting' | 'success' | 'error';

const validatePinShape = (pin: string): string | null => {
  if (pin.length < 4) return 'El PIN debe tener al menos 4 caracteres.';
  if (pin.length > 12) return 'El PIN debe tener como máximo 12 caracteres.';
  if (!/^\d+$/.test(pin))
    return 'El PIN debe contener solo dígitos (mejor para entrada en celular).';
  return null;
};

export const PrescriptionAdminView: React.FC = () => {
  const auth = useAuth();
  const isAdmin = auth.role === 'admin';
  const canAccessConfig = isAdmin || auth.role === 'nurse_hospital';

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const uploadUrl = buildPrescriptionsUploadUrl(origin);

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    []
  );

  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinPhase, setPinPhase] = useState<PinPhase>('idle');
  const [pinMessage, setPinMessage] = useState<string | null>(null);

  const generateQr = useCallback(async () => {
    if (!origin) return;
    setQrLoading(true);
    setQrError(null);
    try {
      const dataUrl = await renderPrescriptionsUploadQrDataUrl({
        origin,
        size: QR_PIXEL_SIZE,
      });
      setQrDataUrl(dataUrl);
    } catch (error) {
      setQrError(error instanceof Error ? error.message : 'No se pudo generar el QR.');
    } finally {
      setQrLoading(false);
    }
  }, [origin]);

  useEffect(() => {
    void generateQr();
  }, [generateQr]);

  const handleCopyUrl = useCallback(async () => {
    try {
      await writeClipboardText(uploadUrl);
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write rejected (rare). The button just stays in idle state.
    }
  }, [uploadUrl]);

  const handleDownload = useCallback(() => {
    if (!qrDataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = qrDataUrl;
    anchor.download = 'qr-recetas-hospitalizados.png';
    anchor.click();
  }, [qrDataUrl]);

  const handlePinSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setPinMessage(null);
      const shapeError = validatePinShape(pin);
      if (shapeError) {
        setPinPhase('error');
        setPinMessage(shapeError);
        return;
      }
      if (pin !== pinConfirm) {
        setPinPhase('error');
        setPinMessage('Los PIN ingresados no coinciden.');
        return;
      }
      setPinPhase('submitting');
      try {
        await setPrescriptionAccessPin({ newPin: pin });
        setPinPhase('success');
        setPinMessage(
          'PIN actualizado. El nuevo PIN aplica de inmediato a quienes escaneen el QR.'
        );
        setPin('');
        setPinConfirm('');
      } catch (error) {
        setPinPhase('error');
        setPinMessage(
          error instanceof Error ? error.message : 'No se pudo guardar el PIN. Reintenta.'
        );
      }
    },
    [pin, pinConfirm]
  );

  if (!canAccessConfig) {
    return (
      <main data-module="prescriptions-admin" className="min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-amber-900">
          <ShieldAlert size={32} className="mx-auto mb-2 text-amber-700" />
          <h1 className="text-lg font-semibold">Acceso restringido</h1>
          <p className="mt-1 text-sm">
            Esta sección está disponible solo para administradores y enfermería.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      data-module="prescriptions-admin"
      className="min-h-screen bg-slate-100 px-4 py-8 print:bg-white"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        <header>
          <a
            href="/"
            className="mb-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Volver al censo diario
          </a>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
            Hospitalizados · Recetas
          </p>
          <h1 className="text-xl font-bold text-slate-800">Configuración de respaldo de recetas</h1>
          <p className="text-xs text-slate-500">
            {isAdmin
              ? 'Administra el QR físico que se imprime en sala y el PIN compartido para subir recetas vía celular.'
              : 'Consulta, copia o descarga el QR físico que se imprime en sala para subir recetas vía celular.'}
          </p>
        </header>

        <section
          aria-label="QR físico"
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div className="mb-3 flex items-center gap-2 text-slate-700">
            <QrCode size={18} />
            <h2 className="text-base font-semibold">QR físico de subida</h2>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Imprime este código y pégalo en sala. Al escanearlo se abre la pantalla de carga (se
            exigirá el PIN). El destino apunta siempre a este dominio:{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px]">{uploadUrl}</code>
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
            <div className="flex h-[180px] w-[180px] items-center justify-center rounded-xl border border-slate-200 bg-white">
              {qrLoading ? (
                <Loader2 size={28} className="animate-spin text-slate-400" />
              ) : qrError ? (
                <p className="px-2 text-center text-xs text-red-700">{qrError}</p>
              ) : qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt="QR para subir fotos de receta"
                  width={180}
                  height={180}
                  className="block"
                />
              ) : null}
            </div>

            <div className="flex flex-1 flex-col gap-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={!qrDataUrl || qrLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Download size={14} /> Descargar PNG
              </button>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                {copied ? (
                  <>
                    <Check size={14} className="text-emerald-600" /> Copiado
                  </>
                ) : (
                  <>
                    <Copy size={14} /> Copiar URL
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => void generateQr()}
                disabled={qrLoading}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw size={14} /> Regenerar
              </button>
            </div>
          </div>
        </section>

        {isAdmin && (
          <section
            aria-label="PIN de acceso"
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="mb-3 flex items-center gap-2 text-slate-700">
              <KeyRound size={18} />
              <h2 className="text-base font-semibold">PIN de acceso</h2>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              El PIN se entrega al equipo clínico. Cualquiera con el QR + PIN puede subir fotos.
              Tras 5 fallos consecutivos el acceso se bloquea automáticamente por 15 minutos. Cambia
              el PIN periódicamente.
            </p>

            <form onSubmit={handlePinSubmit} className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Nuevo PIN
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={event => setPin(event.target.value)}
                  disabled={pinPhase === 'submitting'}
                  maxLength={12}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Confirmar PIN
                </span>
                <input
                  type="password"
                  inputMode="numeric"
                  value={pinConfirm}
                  onChange={event => setPinConfirm(event.target.value)}
                  disabled={pinPhase === 'submitting'}
                  maxLength={12}
                  autoComplete="new-password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
                />
              </label>

              {pinMessage && (
                <p
                  role="status"
                  className={`rounded-md border px-3 py-2 text-sm ${
                    pinPhase === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-red-200 bg-red-50 text-red-700'
                  }`}
                >
                  {pinMessage}
                </p>
              )}

              <button
                type="submit"
                disabled={pinPhase === 'submitting' || !pin || !pinConfirm}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {pinPhase === 'submitting' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Guardando…
                  </>
                ) : (
                  <>
                    <Save size={16} /> Guardar PIN
                  </>
                )}
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
};

export default PrescriptionAdminView;
