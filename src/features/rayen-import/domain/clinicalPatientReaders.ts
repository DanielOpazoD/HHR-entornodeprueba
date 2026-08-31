import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import { retryClinicalReadOnce } from './clinicalReadRetry';

type ReadSlot = <T>(operation: () => Promise<T>) => Promise<T>;

interface ClinicalPatientReadInput {
  encId: string;
  fecha: string;
  lookbackDays: number | undefined;
  deps: Pick<
    ClinicalFillDeps,
    'fetchDeviceReport' | 'fetchHistoryScales' | 'fetchScalesForms' | 'extractDeviceItems'
  >;
  performance: {
    trackRequest: <T>(operation: () => Promise<T>) => Promise<T>;
    recordTimeout: (value: unknown) => void;
    recordRetries: (count: number) => void;
  };
  slots: { devices: ReadSlot; history: ReadSlot; forms: ReadSlot };
}

/**
 * Las tres lecturas de Eloísa de un paciente (dispositivos, historial de
 * escalas y formularios), cada una en su compuerta de concurrencia y con un
 * único reintento ante falla transitoria (ver clinicalReadRetry).
 */
export const readClinicalPatientSources = ({
  encId,
  fecha,
  lookbackDays,
  deps,
  performance,
  slots,
}: ClinicalPatientReadInput) => {
  const countRetry = () => performance.recordRetries(1);
  const readDevices = () =>
    slots.devices(async () => {
      const { entries, base64, error, source } = await performance.trackRequest(() =>
        deps.fetchDeviceReport(encId, fecha)
      );
      if (error) {
        performance.recordTimeout(error);
        throw new Error(error);
      }
      if (Array.isArray(entries)) {
        return {
          entries,
          source,
          textItems: [] as Awaited<ReturnType<typeof deps.extractDeviceItems>>,
        };
      }
      return {
        entries: [],
        source,
        textItems: base64 ? await deps.extractDeviceItems(base64) : [],
      };
    });
  const readHistory = () =>
    slots.history(() =>
      performance.trackRequest(() => deps.fetchHistoryScales(encId, fecha, { lookbackDays }))
    );
  const readForms = () =>
    slots.forms(() => performance.trackRequest(() => deps.fetchScalesForms(encId)));

  return Promise.allSettled([
    retryClinicalReadOnce(readDevices, () => false, countRetry),
    retryClinicalReadOnce(readHistory, result => Boolean(result.error), countRetry),
    retryClinicalReadOnce(readForms, result => Boolean(result.error), countRetry),
  ]);
};
