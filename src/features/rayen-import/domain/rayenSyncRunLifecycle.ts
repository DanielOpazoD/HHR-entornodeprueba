import type { RayenSyncRun } from './rayenSyncHistory';

type RayenSyncRunPhase = 'active' | 'applied' | 'terminalizing';

interface RayenSyncRunEntry {
  run: RayenSyncRun;
  phase: RayenSyncRunPhase;
}

const MAX_TERMINAL_RUN_IDS = 50;

export interface RayenSyncTerminalClaim {
  runId: string;
  run?: RayenSyncRun;
  previousPhase?: Exclude<RayenSyncRunPhase, 'terminalizing'>;
  restoreActive: boolean;
}

export interface RayenSyncCancellation {
  run: RayenSyncRun;
  disposition: 'cancelled' | 'detached';
}

/**
 * Owns the in-memory lifecycle for correlated Rayen runs.
 *
 * Persisted events remain authoritative. This controller only prevents two asynchronous paths
 * from terminalizing the same run at once and keeps an applied background run completable after
 * the operator starts a newer capture or closes its preview. A failed terminal persistence releases
 * its claim, so an applied retry remains possible; terminal ids only reject late duplicate callbacks
 * within the lifetime of this controller.
 */
export const createRayenSyncRunLifecycle = () => {
  const entries = new Map<string, RayenSyncRunEntry>();
  const terminalClaims = new Set<string>();
  const terminalRunIds = new Set<string>();
  let activeRunId: string | null = null;

  const getActiveRun = (): RayenSyncRun | null =>
    activeRunId ? (entries.get(activeRunId)?.run ?? null) : null;

  const getRun = (runId: string): RayenSyncRun | undefined => entries.get(runId)?.run;

  const start = (run: RayenSyncRun): { superseded?: RayenSyncRun } => {
    let superseded: RayenSyncRun | undefined;
    if (activeRunId) {
      const previous = entries.get(activeRunId);
      if (previous?.phase === 'active') {
        superseded = previous.run;
        entries.delete(activeRunId);
        terminalClaims.delete(activeRunId);
      }
    }
    terminalRunIds.delete(run.id);
    activeRunId = run.id;
    entries.set(run.id, { run, phase: 'active' });
    return superseded ? { superseded } : {};
  };

  const markApplied = (runId: string): void => {
    const entry = entries.get(runId);
    if (entry && entry.phase !== 'terminalizing') entry.phase = 'applied';
  };

  const claimTerminal = (runId: string): RayenSyncTerminalClaim | null => {
    if (terminalClaims.has(runId) || terminalRunIds.has(runId)) return null;
    terminalClaims.add(runId);
    const entry = entries.get(runId);
    const restoreActive = activeRunId === runId;
    const previousPhase = entry?.phase === 'terminalizing' ? undefined : entry?.phase;
    if (restoreActive) activeRunId = null;
    if (entry) entry.phase = 'terminalizing';
    return { runId, run: entry?.run, previousPhase, restoreActive };
  };

  const commitTerminal = (claim: RayenSyncTerminalClaim): void => {
    terminalClaims.delete(claim.runId);
    entries.delete(claim.runId);
    if (activeRunId === claim.runId) activeRunId = null;
    terminalRunIds.add(claim.runId);
    if (terminalRunIds.size > MAX_TERMINAL_RUN_IDS) {
      const oldest = terminalRunIds.values().next().value;
      if (oldest) terminalRunIds.delete(oldest);
    }
  };

  const releaseTerminal = (claim: RayenSyncTerminalClaim): void => {
    terminalClaims.delete(claim.runId);
    const entry = entries.get(claim.runId);
    if (entry && claim.previousPhase) entry.phase = claim.previousPhase;
    if (claim.restoreActive && activeRunId === null && entry) activeRunId = claim.runId;
  };

  const cancelActive = (): RayenSyncCancellation | null => {
    if (!activeRunId) return null;
    const runId = activeRunId;
    activeRunId = null;
    const entry = entries.get(runId);
    if (!entry) return null;
    if (entry.phase === 'applied') {
      return { run: entry.run, disposition: 'detached' };
    }
    entries.delete(runId);
    terminalClaims.delete(runId);
    return { run: entry.run, disposition: 'cancelled' };
  };

  return Object.freeze({
    getActiveRun,
    getRun,
    start,
    markApplied,
    claimTerminal,
    commitTerminal,
    releaseTerminal,
    cancelActive,
  });
};
