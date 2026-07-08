import React, { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { useSecurity } from '@/context/SecurityContext';
import { useManagedTimeout } from '@/hooks/useManagedTimeout';

export const PinLockScreen: React.FC = () => {
  const { isLocked, unlock, config } = useSecurity();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const setManagedTimeout = useManagedTimeout();

  const verifyPin = React.useCallback(
    (enteredPin: string) => {
      if (unlock(enteredPin)) {
        setPin('');
        setError(false);
      } else {
        setError(true);
        setShake(true);
        setManagedTimeout(() => {
          setPin('');
          setError(false);
          setShake(false);
        }, 500);
      }
    },
    [unlock, setManagedTimeout]
  );

  const handleNumberClick = React.useCallback(
    (num: string) => {
      if (pin.length < 4) {
        const newPin = pin + num;
        setPin(newPin);
        setError(false);

        if (newPin.length === 4) {
          verifyPin(newPin);
        }
      }
    },
    [pin, verifyPin]
  );

  const handleDelete = React.useCallback(() => {
    setPin(prev => prev.slice(0, -1));
    setError(false);
  }, []);

  React.useEffect(() => {
    if (!isLocked) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleNumberClick(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLocked, handleDelete, handleNumberClick]);

  const getMessage = () =>
    config.lockOnStartup ? 'Privacidad local activada' : 'Pantalla protegida por inactividad';

  if (!isLocked) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/95 backdrop-blur-md">
      <div
        className={`flex w-full max-w-sm flex-col items-center rounded-3xl bg-white p-8 shadow-2xl ${
          shake ? 'animate-shake' : ''
        }`}
      >
        <div className="mb-6 rounded-full bg-blue-100 p-4">
          {error ? (
            <AlertCircle className="h-8 w-8 text-red-500" />
          ) : (
            <Lock className="h-8 w-8 text-blue-600" />
          )}
        </div>

        <h2 className="mb-2 text-2xl font-bold text-slate-800">{getMessage()}</h2>
        <p className="mb-2 text-center text-sm text-slate-500">
          Ingrese su PIN local de 4 dígitos para volver a ver esta pantalla.
        </p>
        <p className="mb-8 text-center text-[11px] leading-relaxed text-slate-400">
          Este bloqueo es solo de privacidad local y no reemplaza login, sesión ni permisos.
        </p>

        <div className="mb-8 flex gap-4">
          {[0, 1, 2, 3].map(i => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full transition-all duration-200 ${
                pin.length > i ? (error ? 'bg-red-500' : 'scale-110 bg-blue-600') : 'bg-slate-200'
              }`}
            />
          ))}
        </div>

        <div className="grid w-full grid-cols-3 gap-4 px-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleNumberClick(num.toString())}
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-transparent bg-slate-100 text-2xl font-semibold text-slate-700 outline-none transition-all hover:border-slate-200 hover:bg-white hover:shadow-lg active:scale-95"
            >
              {num}
            </button>
          ))}

          <div />

          <button
            onClick={() => handleNumberClick('0')}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-transparent bg-slate-100 text-2xl font-semibold text-slate-700 outline-none transition-all hover:border-slate-200 hover:bg-white hover:shadow-lg active:scale-95"
          >
            0
          </button>

          <button
            onClick={handleDelete}
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full text-slate-400 outline-none transition-all hover:bg-slate-50 hover:text-slate-600 active:scale-95"
          >
            <span className="text-sm font-bold tracking-wide">BORRAR</span>
          </button>
        </div>

        {error && (
          <p className="mt-6 animate-pulse text-sm font-medium text-red-500">PIN incorrecto</p>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>
    </div>
  );
};
