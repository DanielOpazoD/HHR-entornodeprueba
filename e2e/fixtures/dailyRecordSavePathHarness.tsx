import { defaultAuthRuntime } from '@/services/firebase-runtime/authRuntime';
import { useAudit } from '@/hooks/useAudit';
import FunctionsRecoveryNotice from '@/components/ui/FunctionsRecoveryNotice';
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
  // The E2E bootstrap authenticates the UI without Firebase Auth. Supply the same
  // synthetic boundary here; audit delivery and IndexedDB remain the real code.
  defaultAuthRuntime.getCurrentUser = () => ({
    uid: 'synthetic-save-probe',
    email: 'synthetic-save-probe@example.com',
    emailVerified: true,
    isAnonymous: false,
    displayName: 'Synthetic probe',
    phoneNumber: null,
    photoURL: null,
    providerId: 'firebase',
    providerData: [],
    metadata: {},
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => '',
    getIdTokenResult: async () => {
      throw new Error('No remote auth in this probe');
    },
    reload: async () => {},
    toJSON: () => ({}),
  });
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
    const audit = useAudit('synthetic-save-probe@example.com');
    const patch = usePatchDailyRecordMutation(date);
    return (
      <>
        <FunctionsRecoveryNotice />
        <span data-testid="mutation-state">{save.status}</span>
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
            void patch
              .mutateAsync({ 'beds.R1.pathology': 'OFFLINE SYNTHETIC' })
              .then(() =>
                audit.logEvent(
                  'PATIENT_MODIFIED',
                  'patient',
                  'R1',
                  { changes: 'OFFLINE SYNTHETIC' },
                  undefined,
                  date
                )
              )
              .catch(() => {});
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
