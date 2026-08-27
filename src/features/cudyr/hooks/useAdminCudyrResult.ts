import { useCallback, useState } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type {
  AdminCudyrResultAdjustment,
  CudyrResultOption,
} from '@/domain/cudyr/adminCudyrResult';
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

  const saveAdminCudyrResults = useCallback(
    async (adjustments: AdminCudyrResultAdjustment[]): Promise<boolean> => {
      if (role !== 'admin' || readOnly || !record || adminCudyrMutationKey) return false;

      if (
        adjustments.length === 0 ||
        !record.lastUpdated ||
        adjustments.some(adjustment => !adjustment.clinicalEpisodeId)
      ) {
        notifyError(
          'No se puede ajustar CUDYR',
          'El registro o episodio clínico no tiene una versión verificable. Recarga el censo antes de reintentar.'
        );
        return false;
      }

      const mutationKey =
        adjustments.length === 1
          ? `${adjustments[0].bedId}:${adjustments[0].clinicalCrib ? 'crib' : 'bed'}`
          : 'bulk';
      setAdminCudyrMutationKey(mutationKey);
      try {
        const response = await setAdminCudyrResult({
          date: record.date,
          adjustments,
          expectedLastUpdated: record.lastUpdated,
        });
        const isSingle = adjustments.length === 1;
        const category = isSingle ? adjustments[0].category : null;
        success(
          isSingle
            ? category
              ? 'Resultado CUDYR actualizado'
              : 'Resultado CUDYR eliminado'
            : 'Resultados CUDYR eliminados',
          isSingle && category
            ? `Se guardó la categoría ${category}. El ajuste quedó registrado a nombre del administrador.`
            : `${response.changedCount} ${response.changedCount === 1 ? 'resultado importado eliminado' : 'resultados importados eliminados'} en una sola operación. Braden, Downton y los puntajes locales se conservaron.`
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

  const saveAdminCudyrResult = useCallback(
    (adjustment: {
      bedId: string;
      clinicalCrib: boolean;
      clinicalEpisodeId: string;
      category: CudyrResultOption | null;
    }) => saveAdminCudyrResults([adjustment]),
    [saveAdminCudyrResults]
  );

  return {
    saveAdminCudyrResult,
    saveAdminCudyrResults,
    canAdminAdjustCudyrResult: role === 'admin' && !readOnly,
    adminCudyrMutationKey,
  };
};
