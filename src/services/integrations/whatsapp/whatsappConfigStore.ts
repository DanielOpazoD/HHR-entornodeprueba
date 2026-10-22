import { doc, getDoc, setDoc } from 'firebase/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import type { WhatsAppConfig } from '@/types/whatsapp';
import { whatsappConfigLogger } from '@/services/integrations/integrationLoggers';

export const WHATSAPP_CONFIG_READ_ERROR =
  'No se pudo leer la configuración de WhatsApp. Reintenta en unos segundos.';
export const WHATSAPP_CONFIG_SAVE_ERROR =
  'No se pudo guardar la configuración de WhatsApp. Los cambios no se aplicaron.';

export const getDefaultWhatsAppConfig = (): WhatsAppConfig => ({
  enabled: true,
  status: 'disconnected',
  shiftParser: {
    enabled: true,
    sourceGroupId: '',
  },
  handoffNotifications: {
    enabled: true,
    targetGroupId: '',
    autoSendTime: '17:00',
  },
});

export const createWhatsAppConfigStore = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => {
  const getConfigDocRef = () => doc(runtime.getDb(), 'whatsapp', 'config');

  /**
   * Stored config, or the defaults when none was saved yet. A failed read throws: showing
   * defaults instead would let the next save overwrite the real configuration with them.
   */
  const getWhatsAppConfig = async (): Promise<WhatsAppConfig> => {
    let docSnap;
    try {
      docSnap = await getDoc(getConfigDocRef());
    } catch (error) {
      whatsappConfigLogger.info('Failed to get WhatsApp config', error);
      throw new Error(WHATSAPP_CONFIG_READ_ERROR, { cause: error });
    }
    return docSnap.exists() ? (docSnap.data() as WhatsAppConfig) : getDefaultWhatsAppConfig();
  };

  /** Throws when the write fails, so callers never report an unsaved change as saved. */
  const updateWhatsAppConfig = async (config: Partial<WhatsAppConfig>): Promise<void> => {
    try {
      await setDoc(getConfigDocRef(), config, { merge: true });
    } catch (error) {
      whatsappConfigLogger.info('Failed to update WhatsApp config', error);
      throw new Error(WHATSAPP_CONFIG_SAVE_ERROR, { cause: error });
    }
  };

  return {
    getWhatsAppConfig,
    updateWhatsAppConfig,
  };
};

const defaultWhatsAppConfigStore = createWhatsAppConfigStore();

export const getWhatsAppConfig = defaultWhatsAppConfigStore.getWhatsAppConfig;
export const updateWhatsAppConfig = defaultWhatsAppConfigStore.updateWhatsAppConfig;
