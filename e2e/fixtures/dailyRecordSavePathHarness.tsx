import { useWarmDailyRecordSavePath } from '@/hooks/useWarmDailyRecordSavePath';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createDefaultRepositoryContainer, RepositoryProvider } from '@/services/RepositoryContext';
import {
  useSaveDailyRecordMutation,
  usePatchDailyRecordMutation,
} from '@/hooks/useDailyRecordQuery';
import { setDailyRecordQueryData } from '@/hooks/controllers/dailyRecordQueryController';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';

export async function mountSavePathProbe(date: string) {
  const base = await hospitalDB.dailyRecords.get(date);
  if (!base) throw new Error('Missing synthetic base');
  const record = base;
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  setDailyRecordQueryData(client, date, base);
  const node = document.createElement('div');
  document.body.append(node);
  function Probe() {
    useWarmDailyRecordSavePath();
    const save = useSaveDailyRecordMutation();
    const patch = usePatchDailyRecordMutation(date);
    return (
      <>
        <button
          data-testid="probe-full"
          onClick={() => {
            void save
              .mutateAsync({
                record: { ...record, nursesDayShift: ['OFFLINE SYNTHETIC'] },
                baseRecord: base,
              })
              .catch(() => {});
          }}
        >
          Full save
        </button>
        <button
          data-testid="probe-patch"
          onClick={() => {
            void patch.mutateAsync({ 'beds.R1.pathology': 'OFFLINE SYNTHETIC' }).catch(() => {});
          }}
        >
          Patch
        </button>
      </>
    );
  }
  createRoot(node).render(
    <QueryClientProvider client={client}>
      <RepositoryProvider value={createDefaultRepositoryContainer()}>
        <Probe />
      </RepositoryProvider>
    </QueryClientProvider>
  );
}
