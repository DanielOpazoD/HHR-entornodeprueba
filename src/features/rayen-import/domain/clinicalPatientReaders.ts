import type { RayenPatientClinicalBundle } from '../contracts/patientClinicalBundle';
import { needsClinicalRead, type ClinicalReadSelection } from '../contracts/clinicalReadSelection';
import type { ClinicalFillDeps } from '../contracts/clinicalFillContracts';
import {
  canRetryClinicalRead,
  decodeClinicalReadRejection,
  retryClinicalReadOnce,
} from './clinicalReadRetry';

type ReadSlot = <T>(operation: () => Promise<T>) => Promise<T>;

type ReaderDeps = Pick<
  ClinicalFillDeps,
  | 'fetchDeviceReport'
  | 'fetchHistoryScales'
  | 'fetchScalesForms'
  | 'extractDeviceItems'
  | 'fetchPatientClinicalBundle'
  | 'signal'
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
  pendingReads?: ClinicalReadSelection;
  performance: {
    trackRequest: <T>(operation: () => Promise<T>) => Promise<T>;
    recordTimeout: (value: unknown) => void;
    recordRetries: (count: number) => void;
  };
  slots: { devices: ReadSlot; history: ReadSlot; forms: ReadSlot; bundle: ReadSlot };
}

const fulfilled = <T>(value: T): PromiseFulfilledResult<T> => ({ status: 'fulfilled', value });

const settleOnce = async <T>(
  read: () => Promise<T>,
  signal?: AbortSignal
): Promise<PromiseSettledResult<T>> => {
  try {
    const value = await read();
    signal?.throwIfAborted();
    return fulfilled(value);
  } catch (reason) {
    signal?.throwIfAborted();
    if (reason && typeof reason === 'object' && 'name' in reason && reason.name === 'AbortError')
      throw reason;
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
const readPatientSources = async ({
  encId,
  fecha,
  lookbackDays,
  deps,
  performance,
  slots,
  pendingReads,
}: ClinicalPatientReadInput) => {
  const countRetry = () => {
    deps.signal?.throwIfAborted();
    performance.recordRetries(1);
  };
  const toDeviceRead = async (report: DeviceReport): Promise<DeviceRead> => {
    if (report.error) {
      performance.recordTimeout(report.error);
      throw Object.assign(new Error(report.error), { errorCode: report.errorCode });
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

  const needs = (source: 'devices' | 'history' | 'forms') =>
    needsClinicalRead(pendingReads, encId, source);
  deps.signal?.throwIfAborted();
  let bundle: RayenPatientClinicalBundle | null = null;
  if (needs('devices') && needs('history') && needs('forms') && deps.fetchPatientClinicalBundle) {
    try {
      bundle = await slots.bundle(() =>
        performance.trackRequest(() =>
          deps.fetchPatientClinicalBundle!(encId, fecha, { censusDate: fecha, lookbackDays })
        )
      );
    } catch (error) {
      deps.signal?.throwIfAborted();
      if (!canRetryClinicalRead(error)) throw error;
      const failure = decodeClinicalReadRejection(error);
      // A lost aggregate response consumed the first attempt for every section.
      // Individual channels get one recovery attempt, never a second full bundle.
      bundle = {
        devices: { base64: '', ...failure },
        history: { events: [], nursingActivity: [], ...failure },
        forms: { forms: [], ...failure },
      };
    }
  }
  deps.signal?.throwIfAborted();

  if (!bundle) {
    const selected = <T>(source: 'devices' | 'history' | 'forms', read: () => Promise<T>) =>
      needs(source)
        ? settleOnce(read, deps.signal)
        : Promise.resolve({ status: 'skipped' } as const);
    const results = await Promise.all([
      selected('devices', () =>
        retryClinicalReadOnce(readDevices, () => false, countRetry, deps.signal)
      ),
      selected('history', () =>
        retryClinicalReadOnce(readHistory, result => Boolean(result.error), countRetry, deps.signal)
      ),
      selected('forms', () =>
        retryClinicalReadOnce(readForms, result => Boolean(result.error), countRetry, deps.signal)
      ),
    ]);
    deps.signal?.throwIfAborted();
    return results;
  }

  const devicesResult = (async (): Promise<PromiseSettledResult<DeviceRead>> => {
    // Transport success is not usable evidence until PDF/JSON normalization succeeds.
    // A failed parser gets the same single, isolated retry as a failed section.
    const first = await settleOnce(() => toDeviceRead(bundle.devices), deps.signal);
    if (first.status === 'fulfilled' || !canRetryClinicalRead(first.reason)) return first;
    countRetry();
    return settleOnce(readDevices, deps.signal);
  })();
  const historyResult = (async (): Promise<
    PromiseSettledResult<Awaited<ReturnType<typeof readHistory>>>
  > => {
    if (!bundle.history.error || !canRetryClinicalRead(bundle.history))
      return fulfilled(bundle.history);
    countRetry();
    return settleOnce(readHistory, deps.signal);
  })();
  const formsResult = (async (): Promise<
    PromiseSettledResult<Awaited<ReturnType<typeof readForms>>>
  > => {
    if (!bundle.forms.error || !canRetryClinicalRead(bundle.forms)) return fulfilled(bundle.forms);
    countRetry();
    return settleOnce(readForms, deps.signal);
  })();

  const results = await Promise.all([devicesResult, historyResult, formsResult]);
  deps.signal?.throwIfAborted();
  return results;
};

export const readClinicalPatientSources = async (input: ClinicalPatientReadInput) => {
  try {
    return await readPatientSources(input);
  } catch (reason) {
    if (!input.deps.signal?.aborted || reason !== input.deps.signal.reason) throw reason;
    // Preserve the runner's settled-results contract without exposing late successes.
    const cancelled = { status: 'rejected' as const, reason: input.deps.signal.reason ?? reason };
    return [cancelled, cancelled, cancelled] as const;
  }
};
