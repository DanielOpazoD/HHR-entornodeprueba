import React, { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

export const DicomFullscreenButton: React.FC = () => {
  const button = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = button.current?.closest('.dicom-dialog');
    const update = () => setActive(document.fullscreenElement === dialog);
    document.addEventListener('fullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      if (document.fullscreenElement === dialog)
        void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  const toggle = async () => {
    setError('');
    try {
      const dialog = button.current?.closest<HTMLElement>('.dicom-dialog');
      if (document.fullscreenElement === dialog) await document.exitFullscreen();
      else if (dialog?.requestFullscreen) await dialog.requestFullscreen();
      else setError('Pantalla completa no disponible en este navegador.');
    } catch {
      setError('El navegador no permitió activar pantalla completa.');
    }
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={active ? 'Salir de pantalla completa' : 'Pantalla completa'}
        title={active ? 'Salir de pantalla completa' : 'Pantalla completa'}
        onClick={() => void toggle()}
      >
        {active ? <Minimize size={16} /> : <Maximize size={16} />}
      </button>
      {error && <span role="status">{error}</span>}
    </>
  );
};
