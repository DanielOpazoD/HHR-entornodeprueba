import { useLayoutEffect, useRef } from 'react';
import type { NursingLogoutPrompt } from '@/hooks/useNursingHandoffLogout';

export default function NursingHandoffLogoutDialog({ choose }: NursingLogoutPrompt) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="unsent-nursing-title"
      onCancel={event => {
        event.preventDefault();
        choose('cancel');
      }}
      className="max-w-md rounded-xl p-6 text-slate-900 shadow-xl backdrop:bg-slate-950/40"
    >
      <h2 id="unsent-nursing-title" className="font-semibold">
        Entrega de turno sin enviar
      </h2>
      <p className="my-3 text-sm">
        La entrega de enfermería sigue en este equipo y aún no se confirmó su envío.
      </p>
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => choose('retry')}>
          Reintentar
        </button>
        <button type="button" onClick={() => choose('leave')}>
          Salir igual (queda guardado en este equipo)
        </button>
        <button type="button" onClick={() => choose('cancel')} autoFocus>
          Cancelar
        </button>
      </div>
    </dialog>
  );
}
