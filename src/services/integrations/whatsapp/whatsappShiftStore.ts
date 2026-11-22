import { collection, doc, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';
import type { WeeklyShift } from '@/types/whatsapp';
import { whatsappShiftLogger } from '@/services/integrations/integrationLoggers';

const TURNO_KEYWORDS = ['turno pabellon', 'turno pabellón', 'envío turno', 'envio turno'];

const parseShiftDates = (messageText: string): { startDate: string; endDate: string } | null => {
  const [, start, end] =
    messageText.match(
      /del\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+hasta\s+el\s+(\d{1,2}\/\d{1,2}\/\d{4})/i
    ) ?? [];

  if (!start || !end) {
    return null;
  }

  const [startDay, startMonth, startYear] = start.split('/');
  const [endDay, endMonth, endYear] = end.split('/');
  if (!startDay || !startMonth || !startYear || !endDay || !endMonth || !endYear) {
    return null;
  }

  return {
    startDate: `${startYear}-${startMonth.padStart(2, '0')}-${startDay.padStart(2, '0')}`,
    endDate: `${endYear}-${endMonth.padStart(2, '0')}-${endDay.padStart(2, '0')}`,
  };
};

export const createWhatsAppShiftStore = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) => {
  const getShiftsCollection = () => collection(runtime.getDb(), 'shifts', 'weekly', 'data');

  const subscribeToCurrentShift = (callback: (shift: WeeklyShift | null) => void): (() => void) => {
    const shiftsQuery = query(getShiftsCollection(), orderBy('parsedAt', 'desc'), limit(1));

    return onSnapshot(shiftsQuery, snapshot => {
      const firstDoc = snapshot.docs[0];
      if (snapshot.empty || !firstDoc) {
        callback(null);
        return;
      }

      callback(firstDoc.data() as WeeklyShift);
    });
  };

  const saveManualShift = async (
    messageText: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const lowerMessage = messageText.toLowerCase();
      const hasShiftKeyword = TURNO_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
      if (!hasShiftKeyword) {
        whatsappShiftLogger.info('No se encontró palabra clave de turno');
        return { success: false, error: 'El mensaje no parece ser un turno de pabellón' };
      }

      const parsedDates = parseShiftDates(messageText);
      if (!parsedDates) {
        whatsappShiftLogger.info('No se encontraron fechas en el mensaje de turno');
        return {
          success: false,
          error:
            'No se encontraron fechas en el mensaje (formato: del DD/MM/YYYY hasta el DD/MM/YYYY)',
        };
      }

      const shift: WeeklyShift = {
        ...parsedDates,
        source: 'manual' as const,
        parsedAt: new Date().toISOString(),
        staff: [],
        originalMessage: messageText,
      };

      await setDoc(doc(getShiftsCollection(), shift.startDate), shift);
      return { success: true };
    } catch (error: unknown) {
      whatsappShiftLogger.info('Error saving manual shift', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Error al guardar el turno',
      };
    }
  };

  return {
    subscribeToCurrentShift,
    saveManualShift,
  };
};

const defaultWhatsAppShiftStore = createWhatsAppShiftStore();

export const subscribeToCurrentShift = defaultWhatsAppShiftStore.subscribeToCurrentShift;
export const saveManualShift = defaultWhatsAppShiftStore.saveManualShift;
