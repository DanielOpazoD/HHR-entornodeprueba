import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNotification } from '@/context/UIContext';
import { requestRayenEncounterNavigation } from '@/features/rayen-import';

interface RayenEncounterButtonProps {
  bedId: string;
  patientName: string;
  clinicalEpisodeId: string;
  routeHint?: 'medical' | 'nurse';
}

export const RayenEncounterButton: React.FC<RayenEncounterButtonProps> = ({
  bedId,
  patientName,
  clinicalEpisodeId,
  routeHint,
}) => {
  const [isOpening, setIsOpening] = useState(false);
  const { success, error: notifyError } = useNotification();

  const handleOpen = async (): Promise<void> => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      const result = await requestRayenEncounterNavigation(clinicalEpisodeId, 8000, routeHint);
      if (result.ok) {
        success(
          'Eloísa abierta',
          result.reused
            ? 'Se activó la pestaña de Ficha Médico en el episodio seleccionado.'
            : 'Se abrió Ficha Médico en el episodio seleccionado.'
        );
      } else {
        notifyError('No se pudo abrir Eloísa', result.error || 'Error de navegación desconocido.');
      }
    } catch (error) {
      notifyError(
        'No se pudo abrir Eloísa',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <button
      type="button"
      data-testid={`rayen-encounter-trigger-${bedId}`}
      onClick={() => void handleOpen()}
      disabled={isOpening}
      aria-busy={isOpening}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-teal-100 bg-teal-50 transition-colors hover:border-teal-200 hover:bg-teal-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-600 disabled:cursor-progress disabled:opacity-60"
      title="Abrir este episodio en Ficha Médico"
      aria-label={`Abrir a ${patientName} en Eloísa`}
    >
      {isOpening ? (
        <Loader2 size={14} className="animate-spin text-teal-700" aria-hidden="true" />
      ) : (
        <img
          src="/images/logos/rayen-mark.png"
          alt=""
          aria-hidden="true"
          className="size-5 object-contain"
        />
      )}
    </button>
  );
};
