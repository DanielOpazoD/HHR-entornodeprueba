import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RAYEN_SYNC_FAILURE_REASONS, type RayenSyncFailureReason } from '@/types/domain/rayenSync';
import { classifyRayenSnapshotError } from '@/features/rayen-import/domain/rayenSnapshotErrorClassification';
import {
  getRayenImportErrorMessage,
  visibleErrorTechnicalDetail,
} from '@/features/rayen-import/hooks/rayenImportState';
import { RayenImportFlowStatus } from '@/features/rayen-import/components/RayenImportFlowStatus';
import type { RayenFillProgress } from '@/features/rayen-import/hooks/useRayenFillStatus';
import { STRUCTURAL_PERSIST_TIMEOUT_MESSAGE } from '@/features/rayen-import/hooks/rayenSnapshotPersistenceExecution';

/**
 * What a person reads in the sync box and its «Ver detalle»: calm wording, no technical source
 * text. Words of breakdown and raw browser/SDK phrases stay out; the raw text is admin-only.
 */
const PERSON_FACING_FAILURE =
  /no se pud|no pudo|falló|fallaron|¡|\balerta\b|\berror (?:al|de|en|desconocido)\b|failed to fetch|networkerror|load failed|\btimeout\b|\bsnapshot\b/i;

const WRAP =
  'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta. Detalle: ';

/**
 * Real extension texts per cause. Keyed by every failure reason of the domain type, so a new
 * reason fails to compile until someone decides how the capture classifier words it.
 */
const CAPTURE_SAMPLES = {
  ficha_medico_unavailable: [
    'No hay una pestaña de Rayen (Ficha Médico) abierta. Ábrela e inicia sesión.',
    `${WRAP}La sesión clínica de Eloísa no está disponible. Inicia sesión y reintenta.`,
  ],
  snapshot_error: [
    'Ficha Médico y Gestión de Camas no corresponden al mismo establecimiento.',
    `${WRAP}500 en /encounter/list/filter`,
    `${WRAP}TypeError: Cannot read properties of undefined (reading 'id')`,
    '',
  ],
  snapshot_timeout: [
    `${WRAP}Tiempo de espera agotado (Ficha Médico).`,
    'La pestaña de Gestión de Camas no respondió dentro del tiempo esperado.',
  ],
  gestion_camas_unavailable: [
    'Falló la descarga del reporte: Failed to fetch',
    'La sesión de Gestión de Camas venció.',
  ],
  snapshot_network_error: [
    `${WRAP}Failed to fetch`,
    `${WRAP}HTTP 503`,
    'NetworkError when attempting to fetch resource.',
  ],
  ficha_medico_stale: [
    `${WRAP}Recarga la pestaña de Ficha Médico (Cmd+R): el lector cargado es de una versión anterior de la extensión.`,
  ],
  // Not produced by the capture classifier: health and apply paths word these, and the tone test
  // walks their labels and recovery notices.
  extension_unavailable: [],
  extension_incompatible: [],
  apply_failed: [],
  apply_unauthorized: [],
  apply_conflict: [],
} satisfies Record<RayenSyncFailureReason, readonly string[]>;

const rawDetailOf = (sample: string): string =>
  sample.startsWith(WRAP) ? sample.slice(WRAP.length) : sample;

const classifiedCaptures = () => [
  ...RAYEN_SYNC_FAILURE_REASONS.flatMap(reason =>
    CAPTURE_SAMPLES[reason].map(sample => ({
      reason,
      raw: rawDetailOf(sample),
      classified: classifyRayenSnapshotError(sample),
    }))
  ),
  ...(['ficha_main_relay', 'ficha_tab_relay'] as const).map(stage => ({
    reason: 'snapshot_timeout' as RayenSyncFailureReason,
    raw: '',
    classified: classifyRayenSnapshotError('texto de la extensión 123', stage),
  })),
];

const fill = {
  running: false,
  outcome: 'idle',
  attemptId: 0,
  done: 0,
  total: 0,
  errors: 0,
  lastCompletedAt: null,
  staffingOutcome: 'idle',
} as unknown as RayenFillProgress;

const renderFailedDetail = (error: string, technicalDetail?: string) => {
  const view = render(
    <RayenImportFlowStatus
      diff={null}
      fill={fill}
      error={error}
      hasPersistedSync={false}
      executionStage={{ type: 'failed' }}
      targetDate="2026-11-13"
      technicalDetail={technicalDetail}
    />
  );
  fireEvent.click(screen.getByText('Ver detalle'));
  const text = screen.getByTestId('rayen-import-error').textContent ?? '';
  view.unmount();
  return text;
};

describe('sync box detail wording', () => {
  it('words every capture cause as a calm remedy and keeps the source text apart', () => {
    const captures = classifiedCaptures();
    expect(new Set(captures.map(capture => capture.reason)).size).toBeGreaterThanOrEqual(6);
    for (const { reason, raw, classified } of captures) {
      expect(classified.reason, raw).toBe(reason);
      expect(classified.message, raw).not.toMatch(PERSON_FACING_FAILURE);
      expect(classified.message, raw).not.toContain('Detalle');
      if (raw) {
        expect(classified.message, raw).not.toContain(raw);
        expect(classified.technicalDetail, raw).toBe(raw);
      }
    }
  });

  it('shows a person the remedy in «Ver detalle», and the source text only when it is passed', () => {
    for (const { raw, classified } of classifiedCaptures()) {
      const personDetail = renderFailedDetail(classified.message);
      expect(personDetail, raw).toBe(`Ver detalle${classified.message}`);
      expect(personDetail, raw).not.toMatch(PERSON_FACING_FAILURE);
    }
    const network = classifyRayenSnapshotError(`${WRAP}Failed to fetch`);
    expect(renderFailedDetail(network.message, network.technicalDetail)).toContain(
      'Detalle técnico: Failed to fetch'
    );
  });

  it('gives the source text only to an administrator, and only next to the message it explains', () => {
    const network = classifyRayenSnapshotError(`${WRAP}Failed to fetch`);
    const state = {
      error: network.message,
      errorTechnicalDetail: { message: network.message, detail: network.technicalDetail! },
    };
    expect(visibleErrorTechnicalDetail(state, false)).toBeNull();
    expect(visibleErrorTechnicalDetail(state, true)).toBe('Failed to fetch');
    expect(
      visibleErrorTechnicalDetail({ ...state, error: 'Otro mensaje posterior.' }, true)
    ).toBeNull();
  });

  it('turns a dropped connection into a remedy and keeps written messages intact', () => {
    expect(getRayenImportErrorMessage(new TypeError('Failed to fetch'))).not.toMatch(
      PERSON_FACING_FAILURE
    );
    expect(getRayenImportErrorMessage({ code: 'functions/unavailable', message: 'x' })).toBe(
      'La conexión se cortó antes de terminar. Vuelve a sincronizar cuando haya conexión.'
    );
    expect(getRayenImportErrorMessage(new Error('Otro motivo escrito'))).toBe(
      'Otro motivo escrito'
    );
    const timeout = Object.assign(new Error(STRUCTURAL_PERSIST_TIMEOUT_MESSAGE), {
      name: 'TimeoutError',
    });
    expect(getRayenImportErrorMessage(timeout)).toBe(
      'El guardado del censo superó los 90 s. Reintenta; si ya se guardó, la próxima sincronización lo confirmará.'
    );
  });
});

const FEATURE = path.resolve(__dirname, '../../features/rayen-import');

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });

/** String literals, template pieces and JSX text: everything a file can put in front of a person. */
const personFacingTexts = (file: string): string[] => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const texts: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node))
      return;
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    )
      texts.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return texts;
};

/**
 * Deployed dialogs: the second part of the calm tone, a unit of its own. Everything else in the
 * folder, including any new file, is part of the box and is checked.
 */
const DIALOGS_PENDING = [
  'ClinicalCribDischargeRepairReview.tsx',
  'EquivalentBedCollisionReview.tsx',
  'NeonatalPlacementReview.tsx',
  'NeonatalSourceChanges.tsx',
  'RayenAdmissionReview.tsx',
  'RayenDayBootstrapButton.tsx',
  'RayenImportDiffReviewParts.tsx',
  'RayenImportPreviewModal.tsx',
  'RayenNursingShiftProposalModal.tsx',
  'RayenPreviousDayReview.tsx',
  'RayenReportEgresoStamp.tsx',
  'RayenStaffingActivity.tsx',
  'RayenSyncCaseDetail.tsx',
  'RayenSyncHistoryModal.tsx',
  'RayenSyncHistorySections.tsx',
  'RayenSyncSessionReportButton.tsx',
  'RayenSyncStructuralReviewDetail.tsx',
  'StaffingBoundaryExclusions.tsx',
];
/** Wording that only the history dialogs show; the box functions of this module are walked by state. */
const HISTORY_WORDING = ['rayenSyncPresentation.ts'];
/** The administrator's technical panel shows raw values on purpose. */
const ADMIN_TECHNICAL = ['RayenSyncTechnicalMetricsPanel.tsx'];

const componentsDirectory = path.join(FEATURE, 'components');
const boxComponentFiles = (excluded: readonly string[]) =>
  sourceFiles(componentsDirectory).filter(file => !excluded.includes(path.basename(file)));

/** Diagnostic prefixes that `getRayenImportErrorMessage` removes before a person reads the text. */
const HIDDEN_DIAGNOSTIC_PREFIXES = ['Structural persist timeout: '];
const shownText = (text: string): string =>
  HIDDEN_DIAGNOSTIC_PREFIXES.reduce(
    (shown, prefix) => (shown.startsWith(prefix) ? shown.slice(prefix.length) : shown),
    text
  );

/** Domain modules whose texts reach the box: capture causes, staffing review, local base check. */
const DOMAIN_FEEDING_BOX = [
  'rayenSnapshotErrorClassification.ts',
  'collectNursingStaffingProposal.ts',
  'rayenStructuralPersistenceBase.ts',
];

describe('sync box source wording', () => {
  it('names only files that exist in the exclusion lists', () => {
    const names = readdirSync(componentsDirectory);
    for (const file of [...DIALOGS_PENDING, ...HISTORY_WORDING, ...ADMIN_TECHNICAL])
      expect(names, file).toContain(file);
  });

  it('keeps breakdown words and raw technical phrases out of every text the box and its hooks write', () => {
    const files = [
      ...sourceFiles(path.join(FEATURE, 'hooks')),
      ...DOMAIN_FEEDING_BOX.map(file => path.join(FEATURE, 'domain', file)),
      ...boxComponentFiles([...DIALOGS_PENDING, ...HISTORY_WORDING, ...ADMIN_TECHNICAL]),
    ];
    expect(files.length).toBeGreaterThan(60);
    const offending = files.flatMap(file =>
      personFacingTexts(file)
        .filter(text => PERSON_FACING_FAILURE.test(shownText(text)))
        .map(text => `${path.relative(FEATURE, file)}: ${text}`)
    );
    expect(offending).toEqual([]);
  });

  it('leaves no loose alarm color classes in any box component', () => {
    const alarmColor = /\b[a-z:-]*(?:red|rose|amber|orange|yellow)-\d{2,3}\b/;
    const offending = boxComponentFiles(DIALOGS_PENDING).flatMap(file => {
      const found = readFileSync(file, 'utf8').match(alarmColor)?.[0];
      return found ? [`${path.basename(file)}: ${found} (use syncTone.ts)`] : [];
    });
    expect(offending).toEqual([]);
  });
});
