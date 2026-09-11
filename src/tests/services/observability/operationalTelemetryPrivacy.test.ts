import { describe, expect, it } from 'vitest';

import {
  OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN,
  OPERATIONAL_TELEMETRY_FALLBACK_OPERATION,
  OPERATIONAL_TELEMETRY_ISSUE_CODES,
  OPERATIONAL_TELEMETRY_MAX_CONTEXT_KEYS,
  OPERATIONAL_TELEMETRY_MAX_ISSUES,
  OPERATIONAL_TELEMETRY_PROBE_OPERATION,
  classifyOperationalTelemetryIssue,
  normalizeOperationalTelemetryOperation,
  sanitizeOperationalTelemetryContextValues,
  sanitizeOperationalTelemetryEvent,
} from '@/services/observability/operationalTelemetryPrivacy';
import {
  buildOperationalTelemetryAlert,
  parseOperationalTelemetryBody,
  shouldAlertOperationalTelemetry,
} from '@/services/observability/operationalTelemetryIngestPolicy';

const PATIENT = 'Juan Pérez';
const RUT = '12.345.678-9';

const realEvent = () => ({
  category: 'integration' as const,
  status: 'failed' as const,
  operation: 'rayen_sync_run',
  timestamp: '2026-09-11T03:10:00.000Z',
  date: '2026-09-10',
  runtimeState: 'retryable' as const,
  issues: ['Structural persist timeout: el guardado del censo superó los 90 s.'],
  context: { runId: 'run-1', stage: 'persisting_structure', durationMs: 91000, patientCount: 24 },
});

/** Nothing the sanitizer emits may contain an identifier or a free text fragment. */
const expectNoLeak = (value: unknown, ...secrets: string[]) => {
  const serialized = JSON.stringify(value);
  for (const secret of [...secrets, PATIENT, RUT, 'Juan', 'Pérez']) {
    expect(serialized).not.toContain(secret);
  }
};

describe('operational telemetry privacy: operations', () => {
  it('keeps known literals and the controlled probe verbatim', () => {
    for (const operation of [
      'rayen_sync_run',
      'refresh_daily_record',
      'sync_queue_task_failure',
      'export_clinical_document_pdf',
      OPERATIONAL_TELEMETRY_PROBE_OPERATION,
    ]) {
      expect(normalizeOperationalTelemetryOperation(operation)).toBe(operation);
    }
  });

  it('collapses unknown, crafted or non string operations into the generic bucket', () => {
    for (const operation of [
      `save_patient_${RUT}`,
      `${PATIENT} discharge`,
      'operation"; DROP TABLE',
      '',
      '   ',
      undefined,
      null,
      42,
      { toString: () => 'rayen_sync_run' },
    ]) {
      expect(normalizeOperationalTelemetryOperation(operation)).toBe(
        OPERATIONAL_TELEMETRY_FALLBACK_OPERATION
      );
    }
  });

  it('does not reject the event: an unknown operation keeps the failed signal', () => {
    const sanitized = sanitizeOperationalTelemetryEvent({
      category: 'sync',
      status: 'failed',
      operation: `leak_${RUT}`,
      timestamp: '2026-09-11T03:10:00.000Z',
    });

    expect(sanitized.status).toBe('failed');
    expect(sanitized.operation).toBe(OPERATIONAL_TELEMETRY_FALLBACK_OPERATION);
    expectNoLeak(sanitized);
  });
});

describe('operational telemetry privacy: issues', () => {
  it.each([
    ['Structural persist timeout: el guardado superó los 90 s.', 'timeout_issue'],
    ['FirebaseError: Missing or insufficient permissions', 'auth_issue'],
    ['Failed to fetch: backend unavailable', 'unavailable_issue'],
    ['ZodError: invalid daily record schema', 'schema_issue'],
    ['IndexedDB quota exceeded while persisting', 'persistence_issue'],
    ['algo raro pasó', 'unclassified_issue'],
  ])('maps %s to a stable code', (message, code) => {
    expect(classifyOperationalTelemetryIssue(message)).toBe(code);
  });

  it('never lets a patient name or identifier survive inside an issue', () => {
    const hostile = [
      `Error saving ${PATIENT} (${RUT}) in bed R1: timeout`,
      `unclassified_issue ${PATIENT}`,
      `${RUT}`,
      'auth_issue<script>alert(1)</script>',
    ];

    const codes = hostile.map(classifyOperationalTelemetryIssue);

    expect(codes.every(code => OPERATIONAL_TELEMETRY_ISSUE_CODES.includes(code))).toBe(true);
    expectNoLeak(codes);
  });

  it('classifies non string issues instead of forwarding them', () => {
    for (const raw of [undefined, null, 7, { message: PATIENT }, [PATIENT]]) {
      expect(classifyOperationalTelemetryIssue(raw)).toBe('unclassified_issue');
    }
  });

  it('caps the issue list and keeps one code per reported issue', () => {
    const sanitized = sanitizeOperationalTelemetryEvent({
      category: 'sync',
      status: 'failed',
      operation: 'save',
      timestamp: '2026-09-11T03:10:00.000Z',
      issues: Array.from({ length: 50 }, (_value, index) => `timeout number ${index} for ${RUT}`),
    });

    expect(sanitized.issues).toHaveLength(OPERATIONAL_TELEMETRY_MAX_ISSUES);
    expect(new Set(sanitized.issues)).toEqual(new Set(['timeout_issue']));
    expectNoLeak(sanitized);
  });
});

describe('operational telemetry privacy: context', () => {
  it('keeps bounded operational magnitudes including patientCount, count and issueCount', () => {
    const { context, droppedCount } = sanitizeOperationalTelemetryContextValues({
      patientCount: 24,
      count: 3,
      issueCount: 2,
      durationMs: 91000,
      retryCount: 5,
    });

    expect(context).toEqual({
      patientCount: 24,
      count: 3,
      issueCount: 2,
      durationMs: 91000,
      retryCount: 5,
    });
    expect(droppedCount).toBe(0);
  });

  it('drops raw identifiers, free text and nested objects', () => {
    const { context, droppedCount } = sanitizeOperationalTelemetryContextValues({
      runId: 'run-1',
      userId: 'uid-9',
      userUid: 'uid-9',
      documentId: 'doc-1',
      bedId: 'R1',
      episodeKey: '142070',
      encounterId: '142070',
      patientName: PATIENT,
      rut: RUT,
      fileName: `${PATIENT}.pdf`,
      message: `timeout for ${PATIENT}`,
      userSafeMessage: `No se pudo guardar a ${PATIENT}`,
      nested: { patient: { rut: RUT } },
      ids: ['R1', 'R2'],
      patientCount: 24,
    });

    expect(context).toEqual({ patientCount: 24 });
    expect(droppedCount).toBe(14);
    expectNoLeak(context, 'run-1', 'doc-1', 'R1');
  });

  it('refuses a sensitive value smuggled under an allowlisted key', () => {
    const { context } = sanitizeOperationalTelemetryContextValues({
      count: RUT,
      patientCount: 'veinticuatro',
      stage: `persisting_${PATIENT}`,
      reason: PATIENT,
      status: 'boom',
      runtimeState: `retryable ${RUT}`,
      durationMs: Number.NaN,
      issueCount: Number.POSITIVE_INFINITY,
      isOnline: 'true',
    });

    expect(context).toEqual({});
  });

  it('clamps numeric magnitudes so a key cannot carry an arbitrary identifier value', () => {
    const { context } = sanitizeOperationalTelemetryContextValues({
      patientCount: 9_999_999_999,
      count: -40,
      durationMs: 1e12,
      sizeBytes: -1,
      elapsedMs: 12.34567,
    });

    expect(context).toEqual({
      patientCount: 1_000_000,
      count: 0,
      durationMs: 86_400_000,
      sizeBytes: 0,
      elapsedMs: 12.346,
    });
  });

  it('accepts only closed string enums from real producers', () => {
    const { context } = sanitizeOperationalTelemetryContextValues({
      stage: 'persisting_structure',
      reason: 'offline',
      status: 'failed',
      runtimeState: 'blocked',
    });

    expect(context).toEqual({
      stage: 'persisting_structure',
      reason: 'offline',
      status: 'failed',
      runtimeState: 'blocked',
    });
  });

  it('caps the number of kept keys and never reports a raw dropped key name', () => {
    const flood: Record<string, unknown> = {};
    for (let index = 0; index < 60; index += 1) flood[`rut_${RUT}_${index}`] = `${PATIENT}${index}`;

    const sanitized = sanitizeOperationalTelemetryEvent({
      category: 'sync',
      status: 'failed',
      operation: 'save',
      timestamp: '2026-09-11T03:10:00.000Z',
      context: flood,
    });

    expect(sanitized.context).toEqual({});
    expect(sanitized.droppedContextKeys).toHaveLength(OPERATIONAL_TELEMETRY_MAX_CONTEXT_KEYS);
    expect(new Set(sanitized.droppedContextKeys)).toEqual(
      new Set([OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN])
    );
    expectNoLeak(sanitized);
  });

  it('ignores a context that is not a plain object', () => {
    for (const context of [null, undefined, 'patientName=Juan', 42, [PATIENT]]) {
      expect(sanitizeOperationalTelemetryContextValues(context)).toEqual({
        context: {},
        droppedCount: 0,
      });
    }
  });
});

describe('operational telemetry privacy: whole event', () => {
  it('sanitizes a real failed rayen run without losing the operational signal', () => {
    const sanitized = sanitizeOperationalTelemetryEvent(realEvent());

    expect(sanitized).toEqual({
      category: 'integration',
      status: 'failed',
      operation: 'rayen_sync_run',
      timestamp: '2026-09-11T03:10:00.000Z',
      date: '2026-09-10',
      runtimeState: 'retryable',
      issues: ['timeout_issue'],
      context: { stage: 'persisting_structure', durationMs: 91000, patientCount: 24 },
      droppedContextKeys: [OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN],
    });
    expectNoLeak(sanitized, 'run-1', 'Structural persist timeout');
  });

  it('degrades every unknown field of a hostile event without throwing', () => {
    const sanitized = sanitizeOperationalTelemetryEvent({
      category: `patients_of_${PATIENT}`,
      status: 'exfiltrate',
      operation: `read_patient_${RUT}`,
      timestamp: `2026-09-11T03:10:00.000Z ${PATIENT}`,
      date: `2026-09-10 ${RUT}`,
      runtimeState: `blocked ${PATIENT}`,
      issues: [PATIENT, { rut: RUT }],
      context: { note: PATIENT, patientCount: 24 },
      droppedContextKeys: [PATIENT, RUT],
    });

    expect(sanitized).toEqual({
      category: 'integration',
      status: 'degraded',
      operation: OPERATIONAL_TELEMETRY_FALLBACK_OPERATION,
      timestamp: '',
      date: undefined,
      runtimeState: undefined,
      issues: ['unclassified_issue', 'unclassified_issue'],
      context: { patientCount: 24 },
      droppedContextKeys: [OPERATIONAL_TELEMETRY_DROPPED_KEY_TOKEN],
    });
    expectNoLeak(sanitized);
  });

  it('normalizes the timestamp instead of forwarding the raw string', () => {
    expect(
      sanitizeOperationalTelemetryEvent({ timestamp: '2026-09-11T00:10:00+02:00' }).timestamp
    ).toBe('2026-09-10T22:10:00.000Z');
    expect(sanitizeOperationalTelemetryEvent({ timestamp: PATIENT }).timestamp).toBe('');
    expect(sanitizeOperationalTelemetryEvent({}).timestamp).toBe('');
  });

  it('is idempotent, so the adapter and the ingest can both run it', () => {
    for (const input of [
      realEvent(),
      { category: 'x', status: 'y', operation: PATIENT, timestamp: RUT, issues: [PATIENT] },
      {
        category: 'sync',
        status: 'failed',
        operation: 'save',
        timestamp: '2026-09-11T03:10:00.000Z',
        context: { runId: 'run-1', userId: 'uid-1', count: 2 },
      },
    ]) {
      const once = sanitizeOperationalTelemetryEvent(input);
      expect(sanitizeOperationalTelemetryEvent(once)).toEqual(once);
      expect(sanitizeOperationalTelemetryEvent(sanitizeOperationalTelemetryEvent(once))).toEqual(
        once
      );
    }
  });

  it('keeps patientCount stable across repeated sanitizing of a sanitized payload', () => {
    const first = sanitizeOperationalTelemetryEvent(realEvent());
    const second = sanitizeOperationalTelemetryEvent(first);

    expect(second.context.patientCount).toBe(24);
    expect(second.droppedContextKeys).toEqual(first.droppedContextKeys);
  });

  it('produces a payload far below the 8 KB ingest cap even from a hostile event', () => {
    const flood: Record<string, unknown> = {};
    for (let index = 0; index < 200; index += 1) flood[`k${index}`] = 'x'.repeat(500);

    const payload = JSON.stringify(
      sanitizeOperationalTelemetryEvent({
        category: 'sync',
        status: 'failed',
        operation: 'x'.repeat(5000),
        timestamp: '2026-09-11T03:10:00.000Z',
        issues: Array.from({ length: 200 }, () => 'y'.repeat(500)),
        context: flood,
      })
    );

    expect(payload.length).toBeLessThan(8 * 1024);
    expect(payload).not.toContain('xxxx');
    expect(payload).not.toContain('yyyy');
  });
});

describe('operational telemetry privacy: ingest and alert surface', () => {
  it('applies the same gate to a hand-crafted POST that never went through the adapter', () => {
    const result = parseOperationalTelemetryBody(
      JSON.stringify({
        source: 'hhr_operational_telemetry',
        event: {
          category: 'integration',
          status: 'failed',
          operation: `exfiltrate_${RUT}`,
          timestamp: '2026-09-11T03:10:00.000Z',
          runtimeState: `blocked ${PATIENT}`,
          issues: [`FirebaseError: no se pudo guardar a ${PATIENT} (${RUT})`],
          context: { runId: 'run-1', patientName: PATIENT, bedId: 'R1', patientCount: 24 },
        },
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.operation).toBe(OPERATIONAL_TELEMETRY_FALLBACK_OPERATION);
    expect(result.event.status).toBe('failed');
    expect(result.event.issues).toEqual(['persistence_issue']);
    expect(result.event.context).toEqual({ patientCount: 24 });
    expectNoLeak(result.event, 'run-1', 'R1');
  });

  it('labels the controlled probe and tells the reader detailed errors stay on the device', () => {
    const probe = sanitizeOperationalTelemetryEvent({
      category: 'integration',
      status: 'failed',
      operation: OPERATIONAL_TELEMETRY_PROBE_OPERATION,
      timestamp: '2026-09-11T16:00:00.000Z',
    });

    expect(shouldAlertOperationalTelemetry(probe)).toBe(true);

    const { subject, body } = buildOperationalTelemetryAlert(probe, 'HHR');

    expect(subject).toContain('PRUEBA CONTROLADA');
    expect(subject).toContain(OPERATIONAL_TELEMETRY_PROBE_OPERATION);
    expect(body).toContain('PRUEBA CONTROLADA del canal de alertas');
    expect(body).toContain('los mensajes de error detallados NO salen del dispositivo');
    expect(body).toContain('claves de contexto descartadas: 0');
  });

  it('mails only codes and counts for a real failure, never the raw incident text', () => {
    const sanitized = sanitizeOperationalTelemetryEvent(realEvent());
    const { subject, body } = buildOperationalTelemetryAlert(sanitized, 'https://hhr.test');

    expect(subject).toBe('[HHR] FALLO · rayen_sync_run · 2026-09-10');
    expect(body).toContain('- timeout_issue');
    expect(body).toContain('- patientCount: 24');
    expect(body).toContain('claves de contexto descartadas: 1');
    expect(body).not.toContain('Structural persist timeout');
    expectNoLeak(body, 'run-1');
  });
});
