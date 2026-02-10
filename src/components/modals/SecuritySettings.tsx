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
            {/* PIN Configuration */}
            <div className="p-3 bg-white/50 rounded-xl border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-orange-50 text-orange-600 rounded-lg">
                            {hasPin ? <ShieldCheck size={18} /> : <Lock size={18} />}
                        </div>
                        <div>
                            <p className="text-sm font-bold text-slate-700">Código PIN (4 Dígitos)</p>
                            <p className="text-[10px] text-slate-500">
                                {hasPin ? 'PIN Configurado y Activo' : 'Sin PIN configurado'}
                            </p>
                        </div>
                    </div>
                </div>

                {!isEditingPin ? (
                    <button
                        onClick={() => setIsEditingPin(true)}
                        className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold text-xs"
                    >
                        {hasPin ? 'Cambiar PIN Existente' : 'Configurar Nuevo PIN'}
                    </button>
                ) : (
                    <div className="flex gap-2">
                        <input
                            type="text"
                            maxLength={4}
                            placeholder="0000"
                            value={newPin}
                            onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, ''))}
                            className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-center font-mono font-bold tracking-widest"
                            autoFocus
                        />
                        <button
                            onClick={handlePinSave}
                            disabled={newPin.length !== 4}
                            className="px-4 bg-orange-500 text-white rounded-lg font-bold text-xs disabled:opacity-50"
                        >
                            Guardar
                        </button>
                        <button
                            onClick={() => setIsEditingPin(false)}
                            className="px-3 bg-slate-200 text-slate-600 rounded-lg font-bold text-xs"
                        >
                            Cancelar
                        </button>
                    </div>
                )}
            </div>

            {/* Lock Settings - Only visible if PIN is set */}
            {hasPin && (
                <>
                    {/* Lock on Startup */}
                    <div className="flex items-center justify-between p-3 bg-white/50 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                                <Lock size={18} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-700">Bloquear al Iniciar</p>
                                <p className="text-[10px] text-slate-500">Pedir PIN al abrir la app</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setLockOnStartup(!config.lockOnStartup)}
                            className={`w-12 h-6 rounded-full transition-all relative ${config.lockOnStartup ? 'bg-medical-600' : 'bg-slate-300'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${config.lockOnStartup ? 'left-7' : 'left-1'}`} />
                        </button>
                    </div>

                    {/* Inactivity Timeout */}
                    <div className="p-3 bg-white/50 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                                <Clock size={18} />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-700">Tiempo de Inactividad</p>
                                <p className="text-[10px] text-slate-500">Bloquear automáticamente tras:</p>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            {[0, 15, 30, 60].map((mins) => (
                                <button
                                    key={mins}
                                    onClick={() => setInactivityTimeout(mins)}
                                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${config.inactivityTimeoutMinutes === mins
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
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
