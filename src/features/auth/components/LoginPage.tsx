import React, { useState, useCallback } from 'react';
import { signInWithGoogle, signInAnonymouslyForPassport } from '@/services/auth/authService';
import {
    parsePassportFile,
    validatePassport,
    storePassportLocally
} from '@/services/auth/passportService';
import { AlertCircle, Loader2, Palette } from 'lucide-react';
import { saveAppSetting } from '@/services';

interface LoginPageProps {
    onLoginSuccess: () => void;
    /** If true, shows a simplified message for shared census access */
    isSharedCensusMode?: boolean;
}

// Google Icon SVG Component
const GoogleIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
);

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, isSharedCensusMode = false }) => {
    const [error, setError] = useState<string | null>(null);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [isPassportLoading, setIsPassportLoading] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<'auto' | 'day' | 'night'>('auto');
    const [_isDragging, setIsDragging] = useState(false);

    const _fileInputRef = React.useRef<HTMLInputElement>(null);

    const handleGoogleSignIn = async () => {
        setError(null);
        setIsGoogleLoading(true);

        try {
            await signInWithGoogle();
            onLoginSuccess();
        } catch (err: unknown) {
            console.error('[LoginPage] Google sign-in failed', err);

            // Safer error handling without 'any'
            const errorMessage = err instanceof Error ? err.message : String(err);
            const errorCode = (err as { code?: string })?.code;

            // If it's a COOP or network error, we'll show a more helpful message
            const isPopupIssue = errorCode === 'auth/network-request-failed' ||
                errorMessage.includes('INTERNAL ASSERTION') ||
                errorCode === 'auth/popup-blocked';

            if (isPopupIssue) {
                setError('El navegador bloqueó la conexión segura. Intenta con el botón de "Acceso Alternativo" abajo.');
            } else {
                setError(errorMessage || 'Error al iniciar sesión con Google');
            }
        } finally {
            setIsGoogleLoading(false);
        }
    };


    // ========== PASSPORT HANDLING ==========
    const handlePassportFile = useCallback(async (file: File) => {
        setError(null);
        setIsPassportLoading(true);

        try {
            const passport = await parsePassportFile(file);

            if (!passport) {
                setError('Archivo pasaporte inválido (.hhr)');
                return;
            }

            const result = await validatePassport(passport);

            if (!result.valid) {
                setError(result.error || 'Pasaporte inválido.');
                return;
            }

            await storePassportLocally(passport);
            await saveAppSetting('hhr_offline_user', result.user);
            localStorage.setItem('hhr_offline_user', JSON.stringify(result.user));

            // Trigger login immediately for a fast offline experience
            onLoginSuccess();

            // Fire anonymous sign-in in the background (don't await it to avoid blocking)
            signInAnonymouslyForPassport().catch(err =>
                console.warn('[LoginPage] Background anonymous sign-in failed:', err)
            );
        } catch (err) {
            console.error('[LoginPage] Passport error:', err);
            setError('Error al procesar el pasaporte.');
        } finally {
            setIsPassportLoading(false);
        }
    }, [onLoginSuccess]);

    const _handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handlePassportFile(file);
        }
    };

    const _handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.hhr')) {
            handlePassportFile(file);
        } else {
            setError('Por favor, suba un archivo .hhr válido.');
        }
    }, [handlePassportFile]);

    const _handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const _handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const isAnyLoading = isGoogleLoading || isPassportLoading;
    const currentHour = new Date().getHours();
    const isAutoDayWindow = currentHour >= 8 && currentHour < 20;
    const isDayGradient = backgroundMode === 'auto' ? isAutoDayWindow : backgroundMode === 'day';
    const loginBackgroundClass = isDayGradient
        ? 'bg-[linear-gradient(180deg,_#39b5e8_0%,_#58c0ea_35%,_#7acde9_68%,_#a7dbe7_100%)]'
        : 'bg-[linear-gradient(140deg,_#020617_0%,_#0f172a_34%,_#1e293b_64%,_#334155_84%,_#94a3b8_100%)]';

    const toggleBackgroundMode = () => {
        setBackgroundMode(prev => {
            if (prev === 'auto') return 'day';
            if (prev === 'day') return 'night';
            return 'auto';
        });
    };

    const backgroundModeLabel =
        backgroundMode === 'auto'
            ? `Automático (${isAutoDayWindow ? 'Día' : 'Noche'})`
            : backgroundMode === 'day'
                ? 'Manual: Día'
                : 'Manual: Noche';

    return (
        <div className={`min-h-screen ${loginBackgroundClass} flex items-center justify-center p-4 relative overflow-hidden`}>
            <button
                type="button"
                onClick={toggleBackgroundMode}
                className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-white/35 bg-black/15 px-3 py-1.5 text-[11px] font-medium text-white/90 backdrop-blur-sm transition hover:bg-black/25"
                title="Cambiar modo de fondo"
            >
                <Palette className="h-3.5 w-3.5" />
                {backgroundModeLabel}
            </button>
            <div className="w-full max-w-sm">
                {/* Logo/Header */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-24 h-24 bg-white rounded-2xl shadow-xl mb-6 p-2">
                        <img
                            src="/images/logos/logo_HHR.svg"
                            alt="Hospital Hanga Roa"
                            className="w-full h-full object-contain"
                        />
                    </div>
                    <h1 className="text-3xl font-bold text-white mb-2">Hospital Hanga Roa</h1>
                    <p className="text-medical-200">Sistema Estadístico de Hospitalizados</p>
                </div>

                {/* Login Card */}
                <div className="bg-white rounded-3xl shadow-2xl p-10 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-medical-400 to-medical-600"></div>

                    <h2 className="text-xl font-bold text-slate-800 mb-2 text-center text-balance">
                        {isSharedCensusMode ? 'Acceso al Censo Compartido' : 'Acceso al Sistema'}
                    </h2>
                    {isSharedCensusMode && (
                        <p className="text-sm text-slate-500 mb-6 text-center">
                            Inicia sesión con tu correo autorizado para ver el censo diario.
                        </p>
                    )}
                    {!isSharedCensusMode && <div className="mb-8" />}

                    {/* Google Sign In Button */}
                    <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={isAnyLoading}
                        className="w-full bg-white hover:bg-slate-50 disabled:bg-slate-100 border-2 border-slate-200 text-slate-700 font-bold py-4 px-4 rounded-2xl transition-all flex items-center justify-center gap-3 shadow-sm hover:shadow-md hover:border-medical-300 active:scale-[0.98]"
                    >
                        {isGoogleLoading ? (
                            <Loader2 className="w-6 h-6 animate-spin text-medical-600" />
                        ) : (
                            <>
                                <GoogleIcon className="w-6 h-6" />
                                Ingresar con Google
                            </>
                        )}
                    </button>


                    {/* Error Message */}
                    {error && (
                        <div className="mt-6 animate-fade-in">
                            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-red-700 text-sm text-balance">
                                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                                <span>{error}</span>
                            </div>
                            <div className="mt-2 text-center">
                                <button
                                    onClick={async () => {
                                        if (confirm('Esto cerrará sesión y borrará la caché local para solucionar problemas de carga. ¿Continuar?')) {
                                            // Unregister all service workers to clear stale code
                                            if ('serviceWorker' in navigator) {
                                                const registrations = await navigator.serviceWorker.getRegistrations();
                                                for (const registration of registrations) {
                                                    await registration.unregister();
                                                }
                                            }

                                            const dbs = await window.indexedDB.databases();
                                            dbs.forEach(db => window.indexedDB.deleteDatabase(db.name || ''));
                                            localStorage.clear();
                                            sessionStorage.clear();
                                            window.location.reload();
                                        }
                                    }}
                                    className="text-[10px] text-slate-400 hover:text-medical-600 underline font-medium uppercase tracking-wider"
                                >
                                    ¿Problemas de conexión? Realizar Hard Reset
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Passport Offline Access - HIDDEN
                    <div className="mt-10 flex flex-col items-center">
                        <div
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current?.click()}
                            className={`p-4 rounded-full transition-all cursor-pointer border-2
                                ${isDragging
                                    ? 'bg-medical-50 border-medical-400 scale-110'
                                    : 'bg-slate-50 border-transparent hover:bg-slate-100 hover:border-slate-200'
                                }
                                ${isPassportLoading ? 'opacity-50 pointer-events-none' : ''}
                            `}
                            title="Acceso Offline con Pasaporte (.hhr)"
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".hhr"
                                onChange={handleFileSelect}
                                className="hidden"
                            />
                            {isPassportLoading ? (
                                <Loader2 className="w-6 h-6 text-medical-500 animate-spin" />
                            ) : (
                                <FileKey className={`w-6 h-6 ${isDragging ? 'text-medical-600' : 'text-slate-400'}`} />
                            )}
                        </div>
                        <p className="mt-2 text-[10px] text-slate-400 font-medium">MODO OFFLINE</p>
                    </div>
                    */}
                </div>

                {/* Version/Footer */}
                <div className="text-center mt-8 space-y-1">
                    <p className="text-medical-200/60 text-[10px] uppercase tracking-widest font-bold">
                        V 3.0
                    </p>
                    <p className="text-medical-300/40 text-[9px]">
                        Desarrollo: daniel.opazo@hospitalhangaroa.cl
                    </p>
                    <p className="text-medical-300/40 text-[9px]">
                        Rapa Nui, Chile
                    </p>
                </div>
            </div>
        </div>
    );
};
