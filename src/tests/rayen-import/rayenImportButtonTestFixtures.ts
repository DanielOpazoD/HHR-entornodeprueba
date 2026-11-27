import { vi } from 'vitest';
import { RAYEN_EXTENSION_PROTOCOL_VERSION } from '@/features/rayen-import/bridge/extensionHealthBridge';

/**
 * Shared default hook payloads for `RayenImportButton*.test.tsx`.
 * Keep every clinical scenario override visible inline inside its test.
 */
export const createRayenImportState = (overrides: Record<string, unknown> = {}) => ({
  mode: 'preview',
  // Explícito siempre: sin política confirmada no hay sincronización posible,
  // y ningún caso de prueba debe heredar una confirmación que no declaró.
  policyStatus: 'ready',
  policyBlockReason: null,
  execution: null,
  diff: null,
  isPreviewOpen: false,
  result: null,
  error: null,
  staffingProposal: null,
  isStaffingProposalBusy: false,
  staffingProposalError: null,
  triggerImport: vi.fn(),
  retryClinicalFill: vi.fn(),
  confirm: vi.fn(),
  cancel: vi.fn(),
  confirmStaffingProposal: vi.fn(),
  dismissStaffingProposal: vi.fn(),
  ...overrides,
});

export const createIdleRayenFillProgress = (overrides: Record<string, unknown> = {}) => ({
  running: false,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
  outcome: null,
  attemptId: null,
  staffingOutcome: null,
  ...overrides,
});

export const createReadyRayenExtensionHealth = (overrides: Record<string, unknown> = {}) => ({
  connection: 'ready',
  report: {
    version: '0.48.61',
    protocolVersion: RAYEN_EXTENSION_PROTOCOL_VERSION,
    capabilities: ['sync-preflight-verification'],
    checkedAt: '2026-07-14T05:00:00.000Z',
    fichaMedico: { status: 'ready', message: 'Ficha Médico disponible.' },
    gestionCamas: { status: 'ready', message: 'Gestión de Camas disponible.' },
  },
  message: 'Extensión Eloísa v0.6.0 operativa.',
  canSync: true,
  ...overrides,
});
