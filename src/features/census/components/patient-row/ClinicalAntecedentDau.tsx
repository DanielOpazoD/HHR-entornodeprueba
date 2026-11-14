import { useEffect, useRef, useState } from 'react';
import { FileDown } from 'lucide-react';
import type { ClinicalActionResult } from '@/features/rayen-import';
import { ClinicalAntecedentDauLogin } from './ClinicalAntecedentDauLogin';
import { buttonClassName } from '@/components/ui/base/buttonStyles';

type DownloadState =
  | { kind: 'idle' | 'downloading' }
  | { kind: 'login'; auth: NonNullable<ClinicalActionResult['auth']>; message?: string }
  | { kind: 'error'; message: string; auth?: NonNullable<ClinicalActionResult['auth']> };

export const ClinicalAntecedentDau = ({
  request,
}: {
  request: (
    signal: AbortSignal
  ) => Promise<Pick<ClinicalActionResult, 'opened' | 'error' | 'auth'>>;
}) => {
  const pending = useRef<AbortController | null>(null);
  const [state, setState] = useState<DownloadState>({ kind: 'idle' });
  useEffect(() => () => pending.current?.abort(), []);
  const download = async (): Promise<void> => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setState({ kind: 'downloading' });
    try {
      const result = await request(controller.signal);
      if (controller.signal.aborted) return;
      if (result.auth?.reason === 'profile')
        setState({
          kind: 'error',
          auth: result.auth,
          message: result.error || 'El perfil no permite verificar el DAU seleccionado.',
        });
      else if (result.auth) setState({ kind: 'login', auth: result.auth });
      else if (result.opened) setState({ kind: 'idle' });
      else
        setState({
          kind: 'error',
          message: result.error || 'No se pudo descargar el DAU oficial. Reintenta.',
        });
    } catch {
      if (!controller.signal.aborted)
        setState({ kind: 'error', message: 'No se pudo descargar el DAU oficial. Reintenta.' });
    } finally {
      if (!controller.signal.aborted) {
        pending.current = null;
      }
    }
  };
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => void download()}
        disabled={state.kind === 'downloading' || state.kind === 'login'}
        className={buttonClassName('ghost', 'xs', '-ml-2')}
      >
        <FileDown size={12} aria-hidden="true" />
        {state.kind === 'downloading' ? 'Descargando DAU…' : 'Descargar DAU oficial (PDF)'}
      </button>
      {state.kind === 'login' && (
        <ClinicalAntecedentDauLogin
          auth={state.auth}
          onComplete={() => void download()}
          onCancel={() =>
            setState(state.message ? { kind: 'error', message: state.message } : { kind: 'idle' })
          }
        />
      )}
      {state.kind === 'error' && (
        <div>
          <p role="alert" className="text-amber-800">
            {state.message}
          </p>
          {state.auth && (
            <button
              type="button"
              className={buttonClassName('ghost', 'xs', '-ml-2 mt-1')}
              onClick={() => {
                if (state.auth)
                  setState({ kind: 'login', auth: state.auth, message: state.message });
              }}
            >
              Iniciar sesión con otro perfil
            </button>
          )}
        </div>
      )}
    </div>
  );
};
