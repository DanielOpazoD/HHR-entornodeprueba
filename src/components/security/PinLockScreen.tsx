import React, { useState } from 'react';
import { Lock, AlertCircle } from 'lucide-react';
import { useSecurity } from '@/context/SecurityContext';

export const PinLockScreen: React.FC = () => {
    const { isLocked, unlock, config } = useSecurity();
    const [pin, setPin] = useState('');
    const [error, setError] = useState(false);
    const [shake, setShake] = useState(false);



    const verifyPin = React.useCallback((enteredPin: string) => {
        if (unlock(enteredPin)) {
            setPin('');
            setError(false);
        } else {
            setError(true);
            setShake(true);
            setTimeout(() => {
                setPin('');
                setError(false); // Clear error when dots clear
                setShake(false);
            }, 500);
        }
    }, [unlock]);

    const handleNumberClick = React.useCallback((num: string) => {
        if (pin.length < 4) {
            const newPin = pin + num;
            setPin(newPin);
            setError(false);

            // Auto-submit on 4th digit
            if (newPin.length === 4) {
                verifyPin(newPin);
            }
        }
    }, [pin, verifyPin]);

    const handleDelete = React.useCallback(() => {
        setPin(prev => prev.slice(0, -1));
        setError(false);
    }, []);

    // Keyboard support
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
    }, [isLocked, handleNumberClick, handleDelete]); // Proper dependencies now

    // Determine lock reason message
    const getMessage = () => {
        if (config.lockOnStartup) return "Sistema Bloqueado";
        return "Sesión Bloqueada por Inactividad";
    };

    if (!isLocked) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-slate-900/95 backdrop-blur-md flex items-center justify-center">
            <div className={`bg-white p-8 rounded-3xl shadow-2xl w-full max-w-sm flex flex-col items-center ${shake ? 'animate-shake' : ''}`}>
                <div className="bg-blue-100 p-4 rounded-full mb-6">
                    {error ? <AlertCircle className="w-8 h-8 text-red-500" /> : <Lock className="w-8 h-8 text-blue-600" />}
                </div>

                <h2 className="text-2xl font-bold text-slate-800 mb-2">{getMessage()}</h2>
                <p className="text-slate-500 mb-8 text-sm text-center">
                    Ingrese su PIN de 4 dígitos para continuar
                </p>

                {/* PIN Display Dots */}
                <div className="flex gap-4 mb-8">
                    {[0, 1, 2, 3].map((i) => (
                        <div
                            key={i}
                            className={`w-4 h-4 rounded-full transition-all duration-200 ${pin.length > i
                                ? error ? 'bg-red-500' : 'bg-blue-600 scale-110'
                                : 'bg-slate-200'
                                }`}
                        />
                    ))}
                </div>

                {/* Number Pad */}
                <div className="grid grid-cols-3 gap-4 w-full px-4">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                        <button
                            key={num}
                            onClick={() => handleNumberClick(num.toString())}
                            className="h-16 w-16 mx-auto rounded-full bg-slate-100 hover:bg-white hover:shadow-lg border border-transparent hover:border-slate-200 text-2xl font-semibold text-slate-700 transition-all active:scale-95 flex items-center justify-center outline-none"
                        >
                            {num}
                        </button>
                    ))}

                    <div /> {/* Spacer */}

                    <button
                        onClick={() => handleNumberClick('0')}
                        className="h-16 w-16 mx-auto rounded-full bg-slate-100 hover:bg-white hover:shadow-lg border border-transparent hover:border-slate-200 text-2xl font-semibold text-slate-700 transition-all active:scale-95 flex items-center justify-center outline-none"
                    >
                        0
                    </button>

                    <button
                        onClick={handleDelete}
                        className="h-16 w-16 mx-auto rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all active:scale-95 flex items-center justify-center outline-none"
                    >
                        <span className="text-sm font-bold tracking-wide">BORRAR</span>
                    </button>
                </div>

                {error && <p className="text-red-500 text-sm mt-6 font-medium animate-pulse">PIN Incorrecto</p>}
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
