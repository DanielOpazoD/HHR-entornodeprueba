import React, { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';

interface PrescriptionPinGateProps {
  errorMessage: string | null;
  onSubmitPin: (pin: string) => Promise<void>;
}

/**
 * Stand-alone PIN entry shown to QR-flow users before the upload form
 * appears. Authenticated admin/nurse callers bypass this gate entirely.
 */
export const PrescriptionPinGate: React.FC<PrescriptionPinGateProps> = ({
  errorMessage,
  onSubmitPin,
}) => {
  const [pin, setPin] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pin.trim().length < 4) return;
    setIsSubmitting(true);
    try {
      await onSubmitPin(pin.trim());
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-slate-700">
        <KeyRound size={18} />
        <h1 className="text-lg font-semibold">Acceso de subida de receta</h1>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        Ingresa el PIN del servicio de Hospitalizados para subir fotos de receta. Tras 5 intentos
        fallidos el acceso se bloquea por 15 minutos.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">PIN</span>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={pin}
            onChange={event => setPin(event.target.value)}
            disabled={isSubmitting}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:bg-slate-100"
            aria-label="PIN de acceso"
            placeholder="Ej: 4521"
            maxLength={12}
          />
        </label>

        {errorMessage && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {errorMessage}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting || pin.trim().length < 4}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Validando…
            </>
          ) : (
            'Continuar'
          )}
        </button>
      </form>
    </div>
  );
};
