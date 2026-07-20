import React, { useState } from 'react';

import { useNotification } from '@/context/UIContext';
import { MovementProvenanceBadge } from '@/features/census/components/MovementProvenanceBadge';
import { requestRayenStatisticalDischargeReport } from '@/features/rayen-import';
import type { MovementProvenance } from '@/types/domain/movements';

interface StatisticalDischargeProvenanceBadgeProps {
  provenance: MovementProvenance;
  clinicalEpisodeId: string;
  patientName: string;
}

export const StatisticalDischargeProvenanceBadge: React.FC<
  StatisticalDischargeProvenanceBadgeProps
> = ({ provenance, clinicalEpisodeId, patientName }) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const { success, error: notifyError } = useNotification();

  const download = async (): Promise<void> => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const result = await requestRayenStatisticalDischargeReport(clinicalEpisodeId);
      if (!result.ok) {
        notifyError(
          'No se pudo descargar el egreso',
          result.error || 'Gestión de Camas no entregó el informe asociado.'
        );
        return;
      }
      success('Egreso descargado', `Se descargó el informe estadístico de ${patientName}.`);
    } catch (error) {
      notifyError(
        'No se pudo descargar el egreso',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <MovementProvenanceBadge
      provenance={provenance}
      isBusy={isDownloading}
      onClick={() => void download()}
    />
  );
};
