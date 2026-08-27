import { useCallback, useState } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { CudyrResultOption } from '@/domain/cudyr/adminCudyrResult';
import { useAuth } from '@/context/AuthContext';
import { useNotification } from '@/context/UIContext';
import { setAdminCudyrResult } from '@/services/cudyr/adminCudyrResultService';

interface UseAdminCudyrResultInput {
  record: DailyRecord | null;
  readOnly: boolean;
}

export const useAdminCudyrResult = ({ record, readOnly }: UseAdminCudyrResultInput) => {
  const { role } = useAuth();
  const { success, error: notifyError } = useNotification();
  const [adminCudyrMutationKey, setAdminCudyrMutationKey] = useState<string | null>(null);

  const saveAdminCudyrResult = useCallback(
    async ({
      bedId,
      clinicalCrib,
      clinicalEpisodeId,
      category,
    }: {
      bedId: string;
      clinicalCrib: boolean;
      clinicalEpisodeId: string;
      category: CudyrResultOption | null;
    }): Promise<boolean> => {
      if (role !== 'admin' || readOnly || !record || adminCudyrMutationKey) return false;

      if (!record.lastUpdated || !clinicalEpisodeId) {
        notifyError(
          'No se puede ajustar CUDYR',
          'El registro o episodio clínico no tiene una versión verificable. Recarga el censo antes de reintentar.'
        );
        return false;
      }

      const mutationKey = `${bedId}:${clinicalCrib ? 'crib' : 'bed'}`;
      setAdminCudyrMutationKey(mutationKey);
      try {
        await setAdminCudyrResult({
          date: record.date,
          bedId,
          clinicalCrib,
          clinicalEpisodeId,
          category,
          expectedLastUpdated: record.lastUpdated,
        });
        success(
          category ? 'Resultado CUDYR actualizado' : 'Resultado CUDYR eliminado',
          category
            ? `Se guardó la categoría ${category}. El ajuste quedó registrado a nombre del administrador.`
            : 'Se eliminó sólo el resultado CUDYR importado. Braden, Downton y los puntajes locales se conservaron.'
        );
        return true;
      } catch (caughtError) {
        notifyError(
          'No se guardó el ajuste CUDYR',
          caughtError instanceof Error
            ? caughtError.message
            : 'No fue posible confirmar el ajuste administrativo.'
        );
        return false;
      } finally {
        setAdminCudyrMutationKey(null);
      }
    },
    [adminCudyrMutationKey, notifyError, readOnly, record, role, success]
  );

  return {
    saveAdminCudyrResult,
    canAdminAdjustCudyrResult: role === 'admin' && !readOnly,
    adminCudyrMutationKey,
  };
};
