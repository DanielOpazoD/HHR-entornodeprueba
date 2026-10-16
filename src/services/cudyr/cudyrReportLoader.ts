import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { applyCudyrFirstNightRecovery } from './cudyrFirstNightRecovery';
import { applyCudyrCensusContinuity } from './cudyrCensusContinuity';
import {
  probeOfficialCudyrReport,
  decodeOfficialCudyrReport,
  saveOfficialCudyrReport,
} from './cudyrOfficialReport';
import { cudyrReportCache } from './cudyrReportCache';
import { applyCudyrCensusApprovals } from './cudyrCensusApproval';
import { loadCudyrVerifiedContexts } from './cudyrVerifiedContextService';
import { applyCudyrVerifiedContexts } from './cudyrVerifiedContext';
import { applyCudyrMonthlyAbsenceLinks } from './cudyrMonthlyAbsenceLinks';
import { loadCudyrCensusSources } from './cudyrCensusSourceService';
import { applyCudyrCensusEvidence } from './cudyrCensusSource';
import { loadCudyrSupplements } from './cudyrSupplementService';
import { applyCudyrMonthlySources } from './cudyrMonthlyProjection';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { readCudyrExclusions } from './cudyrExclusionService';
import { getRecordFromFirestoreDetailed } from '@/services/storage/firestore';
import {
  readCudyrHistory,
  readCudyrCaptures,
  readCudyrEpisodeCaptures,
} from './cudyrHistoryService';
import { readCudyrDischarges, readCudyrDischargeAudit } from './cudyrDischargeService';
import { readPendingCudyrEpisodes } from '@/services/storage/sync/cudyrPendingRead';
import { buildCudyrReport, type CudyrReportInput } from './cudyrReportModel';
import { collectCudyrDailyFacts } from './cudyrReportFacts';
import type { CudyrHistoryCursor } from '@/types/domain/cudyrHistory';
import type { DailyRecordCudyrExportState } from '@/services/contracts/dailyRecordServiceContracts';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

export const cudyrReportDates = (from: string, to: string): string[] => {
  const valid = (date: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date + 'T12:00:00Z')) &&
    new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) === date;
  if (!valid(from) || !valid(to) || from > to) throw new Error('Seleccione un período válido.');
  const count = (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000 + 1;
  if (count > 32) throw new Error('Seleccione como máximo 32 días por reporte.');
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(from + 'T12:00:00Z') + index * 86400000).toISOString().slice(0, 10)
  );
};
export interface CudyrReportLoaderPorts {
  readRecord: (
    date: string,
    options: { source: 'server' }
  ) => Promise<{
    status: 'resolved' | 'failed' | 'missing';
    record: DailyRecordCudyrExportState | null;
    error?: unknown;
  }>;
  readHistory: typeof readCudyrHistory;
  readCaptures: typeof readCudyrCaptures;
  readEpisodeCaptures: typeof readCudyrEpisodeCaptures;
  readDischarges: typeof readCudyrDischarges;
  readAudit: typeof readCudyrDischargeAudit;
  readPending: typeof readPendingCudyrEpisodes;
  readExclusions?: typeof readCudyrExclusions;
  readSupplements?: typeof loadCudyrSupplements;
  readVerifiedContexts?: typeof loadCudyrVerifiedContexts;
  readCensusSources?: typeof loadCudyrCensusSources;
}
export const cudyrReportLoaderPorts: CudyrReportLoaderPorts = {
  readRecord: getRecordFromFirestoreDetailed,
  readHistory: readCudyrHistory,
  readCaptures: readCudyrCaptures,
  readEpisodeCaptures: readCudyrEpisodeCaptures,
  readDischarges: readCudyrDischarges,
  readAudit: readCudyrDischargeAudit,
  readPending: readPendingCudyrEpisodes,
  readExclusions: readCudyrExclusions,
  readSupplements: loadCudyrSupplements,
  readCensusSources: loadCudyrCensusSources,
  readVerifiedContexts: loadCudyrVerifiedContexts,
};

/** Only HHR persisted data is read. No extension, Eloísa request or write is available to this loader. */
export const loadCudyrReport = async (
  from: string,
  to: string,
  signal?: AbortSignal,
  ports = cudyrReportLoaderPorts
) => {
  const dates = cudyrReportDates(from, to);
  const generation = getSessionGeneration();
  const owner = getStoredSessionOwnerKey();
  const check = () => {
    signal?.throwIfAborted();
    if (generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió; vuelva a abrir el reporte.');
  };
  // A closed official month is served as one saved projection. No Eloísa request is made.
  const native = ports === cudyrReportLoaderPorts;
  const scope = owner && generation ? `${owner}:${generation}` : '';
  const month = from.slice(0, 7);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
    .toISOString()
    .slice(0, 10);
  let sourceVersion = '';
  if (
    native &&
    from === month + '-01' &&
    to <= last &&
    resolveCudyrPendingStatus(last).phase === 'overdue'
  ) {
    const cached = scope
      ? cudyrReportCache(loadCudyrReport, scope, true).get(from, last)
      : undefined;
    let reply;
    try {
      reply = await probeOfficialCudyrReport(month, cached);
    } catch (error) {
      check();
      // The hook retains the last good copy and reports failed remote verification.
      if (cached?.officialSnapshot) throw error;
      // An unavailable optional archive must not block ordinary Firebase reads.
    }
    check();
    sourceVersion = reply?.sourceVersion || '';
    if (reply && reply.state !== 'missing') {
      let saved;
      try {
        saved = await decodeOfficialCudyrReport(reply, cached);
      } catch (error) {
        if (reply.state !== 'unchanged') throw error;
        const authoritative = await probeOfficialCudyrReport(month);
        check();
        if (authoritative.state === 'missing')
          throw new Error('El informe cambió; vuelva a cargar el mes.');
        saved = await decodeOfficialCudyrReport(authoritative);
      }
      check();
      if (saved) {
        const cache = cudyrReportCache(loadCudyrReport, scope, Boolean(scope));
        cache.put(saved);
        return cache.get(from, to)!;
      }
    }
  }
  const records: DailyRecordCudyrExportState[] = [];
  const input: CudyrReportInput = {
    from,
    to,
    generatedAt: new Date().toISOString(),
    records,
    sourcePolicy: 'eloisa_only',
    observations: [],
    captures: [],
    corrections: [],
    dischargeAudit: [],
    coverage: [],
    issues: [],
    pending: [],
  };
  // Bounded concurrency for daily server reads. Failed days are distinct from absent censuses.
  for (let index = 0; index < dates.length; index += 3) {
    check();
    const results = await Promise.all(
      dates.slice(index, index + 3).map(async date => ({
        date,
        result: await ports.readRecord(date, { source: 'server' }),
      }))
    );
    check();
    for (const { date, result } of results) {
      if (result.record) records.push(result.record);
      input.coverage.push({
        date,
        state: result.status === 'failed' ? 'error' : result.record ? 'disponible' : 'sin_censo',
        lastSyncedAt: result.record?.rayenSync?.at || '',
        runId: result.record?.rayenSync?.runId || '',
        recordVersion: result.record
          ? `present:${result.record.lastUpdated || ''}:${result.record.rayenSync?.at || ''}:${result.record.cudyrUpdatedAt || ''}`
          : 'missing',
      });
    }
  }
  const pages = async <T, Cursor>(
    read: (cursor?: Cursor) => Promise<{ rows: T[]; next: Cursor | null }>
  ): Promise<T[]> => {
    const result: T[] = [];
    const cursors = new Set<string>();
    let cursor: Cursor | undefined;
    do {
      check();
      const page = await read(cursor);
      check();
      result.push(...page.rows);
      if (!page.next) return result;
      const key = JSON.stringify(page.next);
      if (cursors.has(key) || cursors.size >= 1000)
        throw new Error('La paginación del archivo no pudo completarse.');
      cursors.add(key);
      cursor = page.next;
    } while (cursor !== undefined);
    return result;
  };
  const collect = async (label: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      check();
      input.issues.push(label + ': lectura incompleta. Vuelva a cargar el período.');
    }
  };
  await collect('Historial CUDYR', async () => {
    input.observations = await pages(async (cursor?: CudyrHistoryCursor) => {
      const page = await ports.readHistory({ from, to, limit: 100, ...(cursor ? { cursor } : {}) });
      return { rows: page.observations, next: page.nextCursor };
    });
  });
  await collect('Capturas del período', async () => {
    input.captures = await pages(async (cursor?: CudyrHistoryCursor) => {
      const page = await ports.readCaptures({
        kind: 'captures',
        from,
        to,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      return { rows: page.captures, next: page.nextCursor };
    });
  });
  const episodes = [
    ...new Set(
      [
        ...records.flatMap(collectCudyrDailyFacts).map(fact => fact.patient.clinicalEpisodeId),
        ...input.observations.map(item => item.evaluation.clinicalEpisodeId),
        ...input.captures.map(item => item.capture.clinicalEpisodeId),
      ].filter((id): id is string => Boolean(id))
    ),
  ];
  for (let index = 0; index < episodes.length; index += 30) {
    const clinicalEpisodeIds = episodes.slice(index, index + 30);
    await collect('Contexto histórico de camas', async () => {
      const receipts = await pages(async (cursor?: CudyrHistoryCursor) => {
        const page = await ports.readEpisodeCaptures({
          kind: 'episode-captures',
          clinicalEpisodeIds,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        return { rows: page.captures, next: page.nextCursor };
      });
      input.captures = [
        ...new Map([...input.captures, ...receipts].map(item => [item.id, item])).values(),
      ];
    });
    await collect('Altas reales verificadas', async () => {
      check();
      const page = await ports.readDischarges({
        kind: 'discharge-corrections',
        clinicalEpisodeIds,
      });
      check();
      input.corrections.push(...page.corrections);
    });
  }
  // Audit is fetched only for episodes that have a correction, including withdrawn dates.
  for (const correction of input.corrections)
    await collect('Auditoría de altas', async () => {
      const entries = await pages(async (cursor?: string) => {
        const page = await ports.readAudit({
          kind: 'discharge-audit',
          clinicalEpisodeId: correction.clinicalEpisodeId,
          limit: 100,
          ...(cursor ? { cursor } : {}),
        });
        return { rows: page.entries, next: page.nextCursor };
      });
      input.dischargeAudit.push(...entries);
    });
  await collect('Pendientes de este dispositivo', async () => {
    input.pending = await ports.readPending();
  });
  if (ports.readExclusions) {
    input.exclusions = [];
    for (const month of new Set(dates.map(date => date.slice(0, 7))))
      await collect('Exclusiones diarias', async () => {
        input.exclusions!.push(...(await ports.readExclusions!(month, signal)));
      });
  }
  check();
  let supplements: Awaited<ReturnType<typeof loadCudyrSupplements>> = [];
  if (ports.readSupplements)
    await collect('Informes mensuales Eloísa', async () => {
      supplements = await ports.readSupplements!(
        from,
        getNextDay(to),
        signal || new AbortController().signal
      );
    });
  check();
  let censusSources: Awaited<ReturnType<typeof loadCudyrCensusSources>> = [];
  if (ports.readCensusSources)
    await collect('Censo histórico Eloísa', async () => {
      censusSources = await ports.readCensusSources!(
        from,
        getNextDay(to),
        signal || new AbortController().signal
      );
    });
  check();
  let reviews: Awaited<ReturnType<typeof loadCudyrVerifiedContexts>> = [];
  if (ports.readVerifiedContexts)
    await collect('Conciliaciones documentales', async () => {
      reviews = await ports.readVerifiedContexts!(from, to, signal || new AbortController().signal);
    });
  check();
  input.generatedAt = new Date().toISOString();
  const dataset = applyCudyrCensusEvidence(
    applyCudyrMonthlyAbsenceLinks(
      applyCudyrVerifiedContexts(
        applyCudyrFirstNightRecovery(
          applyCudyrMonthlySources(
            applyCudyrCensusContinuity(
              buildCudyrReport(input),
              new Set(
                reviews.flatMap(review => review.reconstructedDays?.map(day => day.date) || [])
              )
            ),
            supplements
          ),
          supplements.map(source => source.report)
        ),
        supplements,
        reviews
      ),
      supplements
    ),
    censusSources
  );
  const approved = await applyCudyrCensusApprovals(dataset, reviews);
  check();
  if (native && sourceVersion) {
    try {
      const saved = await saveOfficialCudyrReport(approved, sourceVersion, signal);
      check();
      return saved;
    } catch (error) {
      check();
      if (
        error &&
        typeof error === 'object' &&
        (('code' in error && String(error.code).endsWith('aborted')) ||
          ('name' in error && error.name === 'AbortError'))
      )
        throw error;
      // Clinical reads remain usable if this account cannot publish a derived report.
      console.warn(
        'CUDYR: no se pudo guardar la copia mensual oficial.',
        error instanceof Error ? error.name : 'error'
      );
    }
  }
  return approved;
};
