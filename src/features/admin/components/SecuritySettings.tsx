import React, { useState } from 'react';
import { Lock, Clock, ShieldCheck } from 'lucide-react';
import { useSecurity } from '@/context/SecurityContext';

export const SecuritySettings: React.FC = () => {
  const { config, setPin, setLockOnStartup, setInactivityTimeout, hasPin } = useSecurity();
  const [newPin, setNewPin] = useState('');
  const [isEditingPin, setIsEditingPin] = useState(false);

  const handlePinSave = () => {
    if (newPin.length === 4) {
      setPin(newPin);
      setIsEditingPin(false);
      setNewPin('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3">
        <p className="text-xs font-semibold text-amber-900">Bloqueo rápido local</p>
        <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
          Este PIN solo protege visualmente la pantalla en este navegador/dispositivo. No reemplaza
          login, sesión, logout ni permisos clínicos.
        </p>
      </div>

      <div className="rounded-xl border border-slate-100 bg-white/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-50 p-2 text-orange-600">
              {hasPin ? <ShieldCheck size={18} /> : <Lock size={18} />}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-700">PIN local (4 dígitos)</p>
              <p className="text-[10px] text-slate-500">
                {hasPin
                  ? 'Bloqueo rápido configurado en este navegador'
                  : 'Sin PIN local configurado'}
              </p>
            </div>
          </div>
        </div>

        {!isEditingPin ? (
          <button
            onClick={() => setIsEditingPin(true)}
            className="w-full rounded-lg bg-slate-100 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200"
          >
            {hasPin ? 'Cambiar PIN local' : 'Configurar PIN local'}
          </button>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              maxLength={4}
              placeholder="0000"
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/[^0-9]/g, ''))}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center font-mono font-bold tracking-widest"
              autoFocus
            />
            <button
              onClick={handlePinSave}
              disabled={newPin.length !== 4}
              className="rounded-lg bg-orange-500 px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              Guardar
            </button>
            <button
              onClick={() => setIsEditingPin(false)}
              className="rounded-lg bg-slate-200 px-3 text-xs font-bold text-slate-600"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {hasPin && (
        <>
          <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-white/50 p-3">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                <Lock size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Pedir PIN local al abrir</p>
                <p className="text-[10px] text-slate-500">
                  Bloquea esta pantalla al iniciar en este navegador
                </p>
              </div>
            </div>
            <button
              onClick={() => setLockOnStartup(!config.lockOnStartup)}
              className={`relative h-6 w-12 rounded-full transition-all ${
                config.lockOnStartup ? 'bg-medical-600' : 'bg-slate-300'
              }`}
            >
              <div
                className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-all ${
                  config.lockOnStartup ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

          <div className="rounded-xl border border-slate-100 bg-white/50 p-3">
            <div className="mb-3 flex items-center gap-3">
              <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                <Clock size={18} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Bloqueo por inactividad</p>
                <p className="text-[10px] text-slate-500">
                  Oculta esta pantalla automáticamente tras:
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              {[0, 15, 30, 60].map(mins => (
                <button
                  key={mins}
                  onClick={() => setInactivityTimeout(mins)}
                  className={`flex-1 rounded-lg border py-1.5 text-xs font-bold transition-all ${
                    config.inactivityTimeoutMinutes === mins
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                  }`}
                >
                  {mins === 0 ? 'Nunca' : `${mins}m`}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
