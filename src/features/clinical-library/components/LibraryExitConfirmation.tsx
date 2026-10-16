import React, { useEffect, useRef } from 'react';

export const LibraryExitConfirmation: React.FC<{
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
}> = ({ onCancel, onConfirm, title = '¿Salir del MEDIF?' }) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <section
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="medif-exit-title"
      aria-describedby="medif-exit-description"
      className="m-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
    >
      <h3 id="medif-exit-title" className="text-sm font-bold text-slate-800">
        {title}
      </h3>
      <p id="medif-exit-description" className="mt-2 text-sm text-slate-600">
        Los datos del formulario están en esta sesión. Guarda un borrador JSON antes de salir si
        quieres retomarlos.
      </p>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-medical-600"
        >
          Seguir editando
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-md bg-medical-600 px-3 py-2 text-sm font-semibold text-white hover:bg-medical-700 focus-visible:outline-2 focus-visible:outline-medical-600"
        >
          Salir y descartar
        </button>
      </div>
    </section>
  );
};
