import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  changeLaboratoryJob,
  createCensusLaboratoryJob,
  readCensusLaboratoryState,
  reviewCensusLaboratoryEntry,
  type CensusLabEntry,
  type CensusLabInput,
} from '@/services/laboratory/syslabJobs';
import { onSessionChange } from '@/services/storage/sessionStorageTransition';
import { queryClient as appQueryClient } from '@/config/queryClient';

const INBOX_KEY = ['laboratory', 'census-inbox'] as const;
onSessionChange(() => {
  void appQueryClient.removeQueries({ queryKey: INBOX_KEY });
});

export const useCensusLaboratoryInbox = (input: CensusLabInput, scope: string) => {
  const queryClient = useQueryClient();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const isCurrent = () => alive.current;
  const queryKey = [...INBOX_KEY, scope, input.offset || 0, input.onlyUnread];
  const state = useQuery({
    queryKey,
    queryFn: ({ signal }) => readCensusLaboratoryState(input, () => isCurrent() && !signal.aborted),
    enabled: input.patients.length > 0,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: query =>
      query.state.data?.jobs.some(job => job.status === 'queued' || job.status === 'running')
        ? 5_000
        : false,
  });
  const refresh = () => {
    if (isCurrent()) void queryClient.invalidateQueries({ queryKey: [...INBOX_KEY, scope] });
  };
  const update = useMutation({
    mutationFn: (force: boolean) => createCensusLaboratoryJob({ ...input, force }, isCurrent),
    onSuccess: refresh,
  });
  const jobAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'cancel' | 'retry' }) =>
      changeLaboratoryJob(id, action, isCurrent),
    onSuccess: refresh,
  });
  const review = useMutation({
    mutationFn: (entry: CensusLabEntry) => reviewCensusLaboratoryEntry(entry, isCurrent),
    onSuccess: refresh,
  });
  return { state, update, jobAction, review };
};
