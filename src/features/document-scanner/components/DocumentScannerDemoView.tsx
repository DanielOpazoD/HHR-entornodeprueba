import React from 'react';
import {
  Camera,
  Bed,
  Check,
  FileImage,
  FileText,
  Loader2,
  LockKeyhole,
  KeyRound,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useDocumentScannerDemoController } from '../hooks/useDocumentScannerDemoController';
import { DocumentReviewEditor } from './DocumentReviewEditor';

const ScannerProgress = ({ review }: { review: boolean }) => (
  <ol aria-label="Progreso del escaneo" className="grid grid-cols-3 gap-2">
    {[
      { number: 1, label: 'Capturar', active: !review, complete: review },
      { number: 2, label: 'Revisar', active: review, complete: false },
      { number: 3, label: 'Exportar', active: false, complete: false },
    ].map(item => (
      <li key={item.number} className="flex min-w-0 flex-col items-center gap-1.5 text-center">
        <span className="flex w-full items-center gap-1.5" aria-hidden="true">
          <span
            className={`h-px flex-1 ${item.number === 1 ? 'bg-transparent' : 'bg-slate-200'}`}
          />
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
              item.active || item.complete
                ? 'bg-teal-600 text-white'
                : 'border border-slate-300 bg-white text-slate-500'
            }`}
          >
            {item.complete ? <Check size={17} strokeWidth={2.5} /> : item.number}
          </span>
          <span
            className={`h-px flex-1 ${item.number === 3 ? 'bg-transparent' : 'bg-slate-200'}`}
          />
        </span>
        <span
          className={`text-xs font-semibold ${item.active || item.complete ? 'text-teal-700' : 'text-slate-500'}`}
        >
          {item.label}
        </span>
      </li>
    ))}
  </ol>
);

const TechnicalNotice = () => (
  <div className="flex items-start justify-center gap-2 border-t border-slate-200 pt-4 text-xs leading-5 text-amber-700">
    <TriangleAlert size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
    <p>El PDF queda temporalmente en HHR hasta confirmar su carga correcta en Eloísa.</p>
  </div>
);

const ScannerPinGate = ({
  busy,
  errorMessage,
  onSubmit,
}: {
  busy: boolean;
  errorMessage: string | null;
  onSubmit: (pin: string) => Promise<void>;
}) => {
  const [pin, setPin] = React.useState('');
  return (
    <form
      className="space-y-4"
      onSubmit={event => {
        event.preventDefault();
        if (pin.trim().length >= 4) void onSubmit(pin.trim());
      }}
    >
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <KeyRound size={34} />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-slate-900">Acceso al escáner</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Usa el mismo PIN numérico del enlace QR de Recetas.
        </p>
      </div>
      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">PIN</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={12}
          value={pin}
          onChange={event => setPin(event.target.value)}
          disabled={busy}
          aria-label="PIN de acceso"
          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-lg tracking-[0.3em] focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
        />
      </label>
      {errorMessage ? (
        <p
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={busy || pin.trim().length < 4}
        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 font-bold text-white disabled:bg-slate-300"
      >
        {busy ? <Loader2 size={20} className="animate-spin" /> : <LockKeyhole size={19} />}
        {busy ? 'Validando y cargando camas…' : 'Continuar'}
      </button>
    </form>
  );
};

export const DocumentScannerDemoView: React.FC = () => {
  const controller = useDocumentScannerDemoController();
  const localQueueAddress =
    typeof window === 'undefined'
      ? 'localhost/documentos/pendientes-local'
      : `localhost:${window.location.port}/documentos/pendientes-local`;
  const cameraInputRef = React.useRef<HTMLInputElement>(null);
  const galleryInputRef = React.useRef<HTMLInputElement>(null);
  const isReview = Boolean(controller.previewObjectUrl);
  const isAwaitingPin =
    controller.phase === 'awaiting-pin' || controller.phase === 'loading-patients';
  const handleFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length) void controller.startScanning(files);
  };

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-5 text-slate-800 sm:py-8">
      <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xl font-black tracking-tight text-teal-700">HHR</span>
            <span className="h-7 w-px bg-slate-200" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-700">Hospital Hanga Roa</span>
          </div>
          <ShieldCheck size={24} className="text-teal-700" aria-label="Procesamiento protegido" />
        </header>

        <div className="space-y-6 px-5 py-6">
          {isAwaitingPin ? (
            <ScannerPinGate
              busy={controller.phase === 'loading-patients'}
              errorMessage={controller.errorMessage}
              onSubmit={controller.submitPin}
            />
          ) : controller.phase === 'success' ? (
            <section className="space-y-5 text-center">
              <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check size={38} strokeWidth={2.5} />
              </span>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Documento recibido</h1>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Quedó en la bandeja temporal de HHR. No se eliminará hasta que un usuario
                  autenticado confirme en la web que aparece correctamente en Eloísa.
                </p>
                {import.meta.env.DEV ? (
                  <p className="mt-3 rounded-xl bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-700">
                    En el Mac: <strong>{localQueueAddress}</strong>
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={controller.startAnotherDocument}
                className="min-h-12 w-full rounded-xl bg-teal-600 px-4 py-3 font-bold text-white"
              >
                Escanear otro documento
              </button>
            </section>
          ) : (
            <>
              <section className="text-center">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  {isReview ? 'Revisar documento' : 'Escanear documento'}
                </h1>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">
                  {isReview
                    ? `${controller.pageCount} ${controller.pageCount === 1 ? 'página preparada' : 'páginas preparadas'}`
                    : 'Convierte una foto en un documento legible antes de enviarlo.'}
                </p>
              </section>

              <ScannerProgress review={isReview} />

              <label className="block rounded-xl border border-slate-200 bg-slate-50 p-3">
                <span className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-600">
                  <Bed size={16} /> Cama y paciente
                </span>
                <select
                  value={controller.selectedPatientKey}
                  onChange={event => controller.setSelectedPatientKey(event.target.value)}
                  disabled={controller.isBusy}
                  className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100"
                  aria-label="Cama y paciente asociado"
                >
                  <option value="">Seleccionar…</option>
                  {controller.patientOptions.map(option => (
                    <option key={option.key} value={option.key}>
                      {option.bedId} · {option.patientName} · {option.patientRut}
                    </option>
                  ))}
                </select>
                {controller.isPatientOptionsFallback ? (
                  <span className="mt-2 block text-xs text-amber-700">
                    Censo del {controller.patientOptionsSourceDate}; verifica que la cama siga
                    vigente.
                  </span>
                ) : null}
              </label>

              {!isReview ? (
                <section className="space-y-4">
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*,.heic,.heif"
                    capture="environment"
                    className="sr-only"
                    aria-label="Tomar foto del documento"
                    onChange={handleFiles}
                  />
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*,.heic,.heif"
                    multiple
                    className="sr-only"
                    aria-label="Elegir fotos del documento"
                    onChange={handleFiles}
                  />
                  <div className="mx-auto flex h-48 max-w-xs items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
                    <div
                      className="relative flex h-28 w-28 items-center justify-center"
                      aria-hidden="true"
                    >
                      <ScanLine size={112} strokeWidth={1.35} />
                      <FileText size={48} strokeWidth={1.6} className="absolute" />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    disabled={controller.isBusy}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-base font-bold text-white shadow-sm transition-colors hover:bg-teal-700 focus:outline-none focus:ring-4 focus:ring-teal-200 disabled:cursor-wait disabled:bg-teal-300"
                  >
                    {controller.phase === 'opening' ? (
                      <>
                        <Loader2 size={20} className="animate-spin" /> Procesando documento…
                      </>
                    ) : (
                      <>
                        <Camera size={20} /> Abrir cámara
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    disabled={controller.isBusy}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-teal-600 bg-white px-4 py-3 text-base font-bold text-teal-700 transition-colors hover:bg-teal-50 focus:outline-none focus:ring-4 focus:ring-teal-100 disabled:cursor-wait disabled:opacity-60"
                  >
                    <FileImage size={20} /> Elegir fotos
                  </button>
                  <p className="text-center text-xs leading-5 text-slate-500">
                    Puedes seleccionar hasta 12 páginas; JScanify corregirá cada una en este
                    teléfono. La primera carga descarga el procesador y puede tardar.
                  </p>

                  <div className="flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50 p-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-teal-700">
                      <LockKeyhole size={19} aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="text-sm font-bold text-slate-800">Procesamiento privado</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        La imagen se corrige en este dispositivo antes de cualquier futura carga.
                      </p>
                    </div>
                  </div>
                </section>
              ) : (
                <DocumentReviewEditor controller={controller} />
              )}

              {controller.errorMessage ? (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                >
                  {controller.errorMessage}
                </div>
              ) : null}

              <TechnicalNotice />
            </>
          )}
        </div>
      </div>
    </main>
  );
};

export default DocumentScannerDemoView;
