import React, { useState } from 'react';
import { Loader2, Printer } from 'lucide-react';

import { useNotification } from '@/context/UIContext';
import { requestRayenHospitalizationDocument } from '@/features/rayen-import';

interface ClinicalPanelHistoryPrintButtonProps {
  patientName: string;
  patientRun?: string;
  clinicalEpisodeId: string;
  admissionDate?: string;
  censusDate?: string;
}

export const ClinicalPanelHistoryPrintButton: React.FC<
  ClinicalPanelHistoryPrintButtonProps
> = ({ patientName, patientRun = '', clinicalEpisodeId, admissionDate, censusDate }) => {
  const [isOpening, setIsOpening] = useState(false);
  const { success, error: notifyError } = useNotification();

  const openCompleteHistory = async (): Promise<void> => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      // Equivale directamente a Historial -> Imprimir reporte de historial en Eloísa.
      const result = await requestRayenHospitalizationDocument({
        patientRun,
        ...(admissionDate ? { admissionDate } : {}),
        censusDate,
        clinicalEpisodeId,
        documentType: 'history',
      });
      if (!result.ok || result.opened !== true) {
        notifyError(
          'No se pudo abrir el historial',
          result.error ||
            (result.ok
              ? 'Eloísa respondió, pero el navegador no abrió el reporte de Historial.'
              : 'Eloísa no entregó el reporte oficial de Historial.')
        );
        return;
      }
      success(
        'Historial completo abierto',
        `Eloísa abrió el reporte oficial de Historial de ${patientName} para imprimirlo o guardarlo en PDF.`
      );
    } catch (error) {
      notifyError(
        'No se pudo abrir el historial',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void openCompleteHistory()}
      disabled={isOpening}
      className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white hover:text-medical-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-medical-500 disabled:cursor-progress disabled:opacity-50"
      title="Imprimir historial completo de la hospitalización"
      aria-label={`Imprimir en PDF el historial completo de la hospitalización de ${patientName}`}
    >
      {isOpening ? (
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      ) : (
        <Printer size={13} aria-hidden="true" />
      )}
    </button>
  );
};
