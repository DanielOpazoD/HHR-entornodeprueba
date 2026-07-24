import React from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Loader2, TriangleAlert } from 'lucide-react';
import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { DocumentScannerQueueView } from './DocumentScannerQueueView';

const getLocalQueueCredentials = (): { email: string; accessPhrase: string } => {
  const email = import.meta.env.VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_EMAIL?.trim();
  const accessPhrase = import.meta.env.VITE_DOCUMENT_SCANNER_LOCAL_QUEUE_PASSWORD;
  if (!email || !accessPhrase) {
    throw new Error(
      'Configura las credenciales locales del escáner antes de abrir la bandeja emulada.'
    );
  }
  return { email, accessPhrase };
};

export const DocumentScannerLocalQueueView: React.FC = () => {
  const enabled = import.meta.env.DEV && Boolean(import.meta.env.VITE_AUTH_EMULATOR_HOST);
  const [status, setStatus] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      setStatus('error');
      setErrorMessage('La bandeja local solo está disponible con Firebase Auth emulado.');
      return;
    }
    let cancelled = false;
    const authenticate = async () => {
      try {
        await defaultAuthRuntime.ready;
        const credentials = getLocalQueueCredentials();
        if (defaultAuthRuntime.getCurrentUser()?.email !== credentials.email) {
          await signInWithEmailAndPassword(
            defaultAuthRuntime.auth,
            credentials.email,
            credentials.accessPhrase
          );
        }
        if (!cancelled) setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'No se pudo iniciar la sesión ficticia de la bandeja local.'
        );
        setStatus('error');
      }
    };
    void authenticate();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (status === 'ready') return <DocumentScannerQueueView />;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-5">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {status === 'loading' ? (
          <>
            <Loader2 size={30} className="mx-auto animate-spin text-teal-700" />
            <p className="mt-3 font-semibold text-slate-700">Abriendo bandeja HHR local…</p>
          </>
        ) : (
          <>
            <TriangleAlert size={30} className="mx-auto text-red-700" />
            <p role="alert" className="mt-3 text-sm text-red-700">
              {errorMessage}
            </p>
          </>
        )}
      </div>
    </main>
  );
};
