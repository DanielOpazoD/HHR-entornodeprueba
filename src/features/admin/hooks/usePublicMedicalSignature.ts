import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import {
  fetchPublicMedicalHandoffRecord,
  submitPublicMedicalHandoffSignature,
} from '@/services/handoff/publicMedicalSignatureService';

const buildPublicMedicalSignatureQueryKey = (
  date: string | null,
  scope: MedicalHandoffScope,
  token: string | null
) => ['medical-handoff-signature', date, scope, token] as const;

export const usePublicMedicalSignature = (
  date: string | null,
  scope: MedicalHandoffScope,
  token: string | null
) => {
  const queryClient = useQueryClient();
  const queryKey = buildPublicMedicalSignatureQueryKey(date, scope, token);

  const query = useQuery({
    queryKey,
    enabled: Boolean(date && token),
    queryFn: async () => {
      if (!date || !token) {
        throw new Error('Enlace de firma inválido.');
      }
      return fetchPublicMedicalHandoffRecord(date, scope, token);
    },
    staleTime: 60_000,
  });

  const signMutation = useMutation({
    mutationFn: async (doctorName: string) => {
      if (!date || !token) {
        throw new Error('Enlace de firma inválido.');
      }
      return submitPublicMedicalHandoffSignature({
        date,
        scope,
        token,
        doctorName,
      });
    },
    onSuccess: result => {
      queryClient.setQueryData(queryKey, current => {
        const data = current as { record?: DailyRecord; alreadySigned?: boolean } | undefined;
        if (!data?.record) return current;

        const nextRecord: DailyRecord = {
          ...data.record,
          medicalSignatureByScope: {
            ...(data.record.medicalSignatureByScope || {}),
            [scope]: result.signature,
          },
        };

        if (scope === 'all') {
          nextRecord.medicalSignature = result.signature;
        }

        return {
          ...data,
          alreadySigned: true,
          record: nextRecord,
        };
      });
    },
  });

  return {
    record: query.data?.record || null,
    alreadySigned: Boolean(query.data?.alreadySigned),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refresh: () => query.refetch(),
    sign: async (doctorName: string) => signMutation.mutateAsync(doctorName),
    isSigning: signMutation.isPending,
    signError: signMutation.error,
  };
};
