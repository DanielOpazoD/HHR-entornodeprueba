import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import { retryClinicalReadOnce } from './clinicalReadRetry';

type ReadSlot = <T>(operation: () => Promise<T>) => Promise<T>;

type ReaderDeps = Pick<
  ClinicalFillDeps,
  | 'fetchDeviceReport'
  | 'fetchHistoryScales'
  | 'fetchScalesForms'
  | 'extractDeviceItems'
  | 'fetchPatientClinicalBundle'
>;

type DeviceReport = Awaited<ReturnType<ReaderDeps['fetchDeviceReport']>>;
type DeviceRead = {
  entries: NonNullable<DeviceReport['entries']> | [];
  source?: 'json' | 'pdf';
  textItems: Awaited<ReturnType<ReaderDeps['extractDeviceItems']>>;
};

interface ClinicalPatientReadInput {
  encId: string;
  fecha: string;
  lookbackDays: number | undefined;
  deps: ReaderDeps;
  performance: {
    trackRequest: <T>(operation: () => Promise<T>) => Promise<T>;
    recordTimeout: (value: unknown) => void;
    recordRetries: (count: number) => void;
  };
  slots: { devices: ReadSlot; history: ReadSlot; forms: ReadSlot; bundle: ReadSlot };
}

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value });

const settleOnce = async <T>(read: () => Promise<T>): Promise<PromiseSettledResult<T>> => {
  try {
    return fulfilled(await read());
  } catch (reason) {
    return { status: 'rejected', reason };
  }
};

/**
 * Las tres lecturas de Eloísa de un paciente (dispositivos, historial de
 * escalas y formularios). Con la capability `patient-clinical-bundle`, las
 * tres viajan en UN solo mensaje a la extensión; una sección que falle se
 * reintenta una única vez por su canal individual (máximo dos intentos por
 * fuente, igual que el camino legado). Sin la capability, cada fuente usa su
 * canal individual con un reintento propio.
 */
export const readClinicalPatientSources = async ({
  encId,
  fecha,
  lookbackDays,
  deps,
  performance,
  slots,
}: ClinicalPatientReadInput) => {
  const countRetry = () => performance.recordRetries(1);
  const toDeviceRead = async (report: DeviceReport): Promise<DeviceRead> => {
    if (report.error) {
      performance.recordTimeout(report.error);
      throw new Error(report.error);
    }
    if (Array.isArray(report.entries)) {
      return { entries: report.entries, source: report.source, textItems: [] };
    }
    return {
      entries: [],
      source: report.source,
      textItems: report.base64 ? await deps.extractDeviceItems(report.base64) : [],
    };
  };
  const readDevices = () =>
    slots.devices(async () =>
      toDeviceRead(await performance.trackRequest(() => deps.fetchDeviceReport(encId, fecha)))
    );
  const readHistory = () =>
    slots.history(() =>
      performance.trackRequest(() => deps.fetchHistoryScales(encId, fecha, { lookbackDays }))
    );
  const readForms = () =>
    slots.forms(() => performance.trackRequest(() => deps.fetchScalesForms(encId)));

  const bundle = deps.fetchPatientClinicalBundle
    ? await slots.bundle(() =>
        performance.trackRequest(() =>
          deps.fetchPatientClinicalBundle!(encId, fecha, { censusDate: fecha, lookbackDays })
        )
      )
    : null;

  if (!bundle) {
    return Promise.allSettled([
      retryClinicalReadOnce(readDevices, () => false, countRetry),
      retryClinicalReadOnce(readHistory, result => Boolean(result.error), countRetry),
      retryClinicalReadOnce(readForms, result => Boolean(result.error), countRetry),
    ]);
  }

  const devicesResult = ((): Promise<PromiseSettledResult<DeviceRead>> => {
    if (!bundle.devices.error) return settleOnce(() => toDeviceRead(bundle.devices));
    performance.recordTimeout(bundle.devices.error);
    countRetry();
    return settleOnce(readDevices);
  })();
  const historyResult = ((): Promise<
    PromiseSettledResult<Awaited<ReturnType<typeof readHistory>>>
  > => {
    if (!bundle.history.error) return Promise.resolve(fulfilled(bundle.history));
    countRetry();
    return settleOnce(readHistory);
  })();
  const formsResult = ((): Promise<PromiseSettledResult<Awaited<ReturnType<typeof readForms>>>> => {
    if (!bundle.forms.error) return Promise.resolve(fulfilled(bundle.forms));
    countRetry();
    return settleOnce(readForms);
  })();

  return Promise.all([devicesResult, historyResult, formsResult]);
};
