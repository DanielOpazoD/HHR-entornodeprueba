import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import type { WhatsAppLog } from '@/features/whatsapp/types/whatsapp';
import { whatsappLoggingLogger } from '@/services/integrations/integrationLoggers';

export const createWhatsAppLoggingStore = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => {
  const logWhatsAppOperation = async (
    log: Omit<WhatsAppLog, 'id' | 'timestamp'>
  ): Promise<void> => {
    try {
      await addDoc(collection(runtime.getDb(), 'whatsappLogs'), {
        ...log,
        timestamp: Timestamp.now(),
      });
    } catch (_error) {
      whatsappLoggingLogger.info('Error logging WhatsApp operation', _error);
    }
  };

  return {
    logWhatsAppOperation,
  };
};

const defaultWhatsAppLoggingStore = createWhatsAppLoggingStore();

export const logWhatsAppOperation = defaultWhatsAppLoggingStore.logWhatsAppOperation;
