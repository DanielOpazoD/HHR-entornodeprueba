import { useState } from 'react';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export function NursingHandoffDemoPairing() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const issue = async () => {
    setBusy(true);
    setCode('');
    setError('');
    try {
      const functions = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
      const { httpsCallable } = await import('firebase/functions');
      const result = await httpsCallable<{ action: 'issue' }, { code: string }>(
        functions,
        'nursingHandoffExtension'
      )({ action: 'issue' });
      setCode(result.data.code);
    } catch {
      setError('No se pudo generar el código. Revisa la sesión de enfermería de pruebas.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm print:hidden">
      <button className="rounded border px-2 py-1" type="button" disabled={busy} onClick={issue}>
        Vincular Eloísa (pruebas)
      </button>
      {code && <input aria-label="Código de vinculación de un solo uso" readOnly value={code} />}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
