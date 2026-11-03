import { fetchDicomInstance } from './mmradDicomService';
import { DicomTicketExpiredError } from './dicomLoadState';
import {
  normalizeDicomPatientId,
  type DicomInstance,
  type DicomSeries,
  type DicomStudy,
} from './dicomTypes';

/** Requests the open study again for the same link and patient (`fetchDicomStudy`). */
export type DicomStudyReopen = (signal: AbortSignal) => Promise<DicomStudy>;

const waitFor = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });

/**
 * Instance tickets end with the viewer's share access (about 9 minutes for Universitas). When the
 * server reports an authentic ticket as expired, the open study is requested once more, shared by
 * every waiting cut, and its tickets replace the current ones only if it is the same study of the
 * same patient and still lists every known series and SOP instance. Each generation of tickets
 * gets at most one renewal; any other outcome keeps the existing fatal error. Callers still
 * verify every original's identity before using it.
 */
export const createDicomTicketRenewal = (study: DicomStudy, reopen?: DicomStudyReopen) => {
  const key = (series: DicomSeries, instance: DicomInstance) => `${series.uid}/${instance.uid}`;
  let tickets = new Map(
    study.series.flatMap(series =>
      series.instances.map(instance => [key(series, instance), instance.ticket] as const)
    )
  );
  let generation = 0;
  // Highest generation whose tickets already used their single renewal.
  let attempted = -1;
  let renewal: Promise<boolean> | undefined;
  const lifetime = new AbortController();
  const ticketOf = (series: DicomSeries, instance: DicomInstance): string => {
    const ticket = tickets.get(key(series, instance));
    if (!ticket) throw new Error('Original ajeno al estudio verificado.');
    return ticket;
  };
  const adopt = (renewed: DicomStudy): boolean => {
    if (
      renewed.uid !== study.uid ||
      normalizeDicomPatientId(renewed.patientId || '') !== normalizeDicomPatientId(study.patientId)
    )
      return false;
    const next = new Map<string, string>();
    for (const series of study.series) {
      const match = renewed.series.find(item => item.uid === series.uid);
      const fresh = new Map(match?.instances.map(item => [item.uid, item.ticket]));
      for (const instance of series.instances) {
        const ticket = fresh.get(instance.uid);
        if (typeof ticket !== 'string' || !ticket) return false;
        next.set(key(series, instance), ticket);
      }
    }
    tickets = next;
    generation++;
    return true;
  };
  const renew = (from: number): Promise<boolean> => {
    if (from < generation) return Promise.resolve(true);
    if (renewal) return renewal;
    if (!reopen || attempted >= from || lifetime.signal.aborted) return Promise.resolve(false);
    attempted = from;
    renewal = reopen(lifetime.signal)
      .then(adopt)
      .catch(() => false)
      .finally(() => {
        renewal = undefined;
      });
    return renewal;
  };
  const fetch = async (
    series: DicomSeries,
    instance: DicomInstance,
    signal: AbortSignal,
    timing?: Parameters<typeof fetchDicomInstance>[2],
    maxBytes?: number
  ): Promise<Uint8Array> => {
    const used = generation;
    try {
      return await fetchDicomInstance(ticketOf(series, instance), signal, timing, maxBytes);
    } catch (error) {
      if (!(error instanceof DicomTicketExpiredError)) throw error;
      signal.throwIfAborted();
      if (!(await waitFor(renew(used), signal))) throw error;
      const renewed = generation;
      try {
        return await fetchDicomInstance(ticketOf(series, instance), signal, timing, maxBytes);
      } catch (retryError) {
        // Fresh tickets that already read as expired are never renewed again.
        if (retryError instanceof DicomTicketExpiredError) attempted = Math.max(attempted, renewed);
        throw retryError;
      }
    }
  };
  return { fetch, dispose: () => lifetime.abort() };
};
