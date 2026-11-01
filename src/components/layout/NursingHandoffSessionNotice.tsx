import React, { useState } from 'react';
import { useRetainedNursingHandoffOwners } from '@/hooks/useNursingHandoffLogout';

export default function NursingHandoffSessionNotice({ uid }: { uid: string }) {
  const owners = useRetainedNursingHandoffOwners(uid);
  const [dismissed, setDismissed] = useState(false);
  if (!owners.length || dismissed) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-slate-800 shadow-md"
    >
      Hay una entrega de turno de {owners.join(', ')} sin enviar en este equipo.
      <button
        type="button"
        aria-label="Cerrar aviso de entrega pendiente"
        onClick={() => setDismissed(true)}
        className="ml-3 underline"
      >
        Cerrar
      </button>
    </div>
  );
}
