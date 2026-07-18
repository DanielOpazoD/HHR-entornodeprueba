// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import '../../../extension/hhr-vitals-center.js';

type Runtime = {
  renderVitalsCenter: (root: HTMLElement, encId: string, view?: string) => void;
};

type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => Runtime;
};

type VitalRecord = {
  recordedAt: string;
  recordedDate: string;
  temperature?: number;
  observations?: string;
  author?: string;
};

const runtimeOwner = () =>
  (globalThis as unknown as { HhrVitalsCenterRuntime: RuntimeOwner }).HhrVitalsCenterRuntime;

const runtimeMessages = {
  VITALS_CENSUS_REQUEST: 'RAYEN_VITALS_CENSUS_REQUEST',
  SCALES_REPORT_REQUEST: 'RAYEN_SCALES_REPORT_REQUEST',
  PATIENT_HEADER_REQUEST: 'RAYEN_PATIENT_HEADER_REQUEST',
};

const temperatureMetric = {
  key: 'temperature',
  label: 'Temperatura',
  unit: '°C',
  text: (record: VitalRecord) =>
    record.temperature == null ? '' : String(record.temperature),
  series: (record: VitalRecord) => record.temperature ?? null,
  status: (record: VitalRecord, cohort: string) => {
    if (cohort !== 'adult') return 'ungraded';
    return Number(record.temperature) >= 38 ? 'alert' : 'normal';
  },
};

const vitalsHelper = {
  VITAL_METRICS: [temperatureMetric],
  parseVitalSigns: (forms: unknown) => (Array.isArray(forms) ? forms : []),
  ageCohort: (birthDate: string) => {
    if (!birthDate) return 'unknown';
    return Number(birthDate.slice(0, 4)) >= 2010 ? 'pediatric' : 'adult';
  },
};

const makeRoot = () => {
  const root = document.createElement('div');
  root.dataset.activeModule = 'vitals';
  root.innerHTML = '<main class="hhr-center-main"></main>';
  document.body.appendChild(root);
  return root;
};

const makeDependencies = (
  sendMessage: (message: Record<string, unknown>) => Promise<unknown>,
  openVitalsView = vi.fn()
) => ({
  vitalsHelper,
  runtimeMessages,
  currentRouteEncounterId: () => 'route-encounter',
  normalizedText: (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  sendMessage,
  openVitalsView,
});

const record = (
  recordedAt: string,
  temperature: number,
  overrides: Partial<VitalRecord> = {}
): VitalRecord => ({
  recordedAt,
  recordedDate: recordedAt.slice(0, 10),
  temperature,
  ...overrides,
});

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const deferred = () => {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>(next => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('Centro HHR vital-signs runtime', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('fails closed, loads after the parser and before its consumer, and owns the renderers', () => {
    expect(() => runtimeOwner().create({})).toThrow(/Centro de Signos Vitales HHR/);
    expect(Object.isFrozen(runtimeOwner())).toBe(true);

    const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
      content_scripts?: Array<{ js?: string[] }>;
    };
    const scripts =
      manifest.content_scripts?.find(entry => entry.js?.includes('content-prescription-print.js'))
        ?.js || [];
    const contentSource = readFileSync(
      path.resolve('extension/content-prescription-print.js'),
      'utf8'
    );
    const ownerSource = readFileSync(path.resolve('extension/hhr-vitals-center.js'), 'utf8');

    expect(scripts.indexOf('hhr-vitals-center.js')).toBeGreaterThan(
      scripts.indexOf('hhr-vitals.js')
    );
    expect(scripts.indexOf('hhr-vitals-center.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(contentSource).toContain('const vitalsCenterRuntime = vitalsCenterOwner');
    expect(contentSource).toContain('if (!vitalsCenterRuntime) {');
    expect(contentSource).toContain(
      'vitalsCenterRuntime.renderVitalsCenter(root, targetEncId, options.vitalsView || \'overview\')'
    );
    expect(contentSource).toContain(
      "createOperationsCenterModal('vitals', encId, root.__hhrFocusReturnTarget, root"
    );
    expect(contentSource).not.toContain('const vitalsSparklineSvg =');
    expect(contentSource).not.toContain('const renderVitalsCensus =');
    expect(contentSource).not.toContain('const renderVitalsCenter =');
    expect(ownerSource).toContain('const vitalsSparklineSvg =');
    expect(ownerSource).toContain('const renderVitalsCensus =');
    expect(ownerSource).toContain('const renderVitalsCenter =');
    expect(contentSource.split('\n').length).toBeLessThanOrEqual(1_850);
    expect(ownerSource.split('\n').length).toBeLessThanOrEqual(425);
  });

  it('renders the census, keeps no-data and unavailable rows safe, and drills down in the same root', async () => {
    const latest = record('2026-07-18 08:30', 38.2);
    const openVitalsView = vi.fn();
    const sendMessage = vi.fn(async () => ({
      patients: [
        {
          encounterId: '101',
          name: 'Ana Riroroko',
          run: 'RUN 101',
          bed: '12A',
          service: 'Medicina',
          birthDate: '1980-02-03',
          forms: [latest],
        },
        {
          encounterId: '102',
          name: 'Paciente sin tomas',
          run: 'RUN 102',
          bed: '12B',
          service: 'Medicina',
          birthDate: '',
          forms: [],
        },
        {
          encounterId: '103',
          name: 'Paciente no disponible',
          run: 'RUN 103',
          bed: '12C',
          service: 'Medicina',
          unavailableReason: 'Sesión no disponible',
          forms: [],
        },
      ],
    }));
    const root = makeRoot();

    runtimeOwner()
      .create(makeDependencies(sendMessage, openVitalsView))
      .renderVitalsCenter(root, 'fallback', 'overview');
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledWith({
      type: runtimeMessages.VITALS_CENSUS_REQUEST,
      currentEncId: 'route-encounter',
    });
    const rows = root.querySelectorAll<HTMLButtonElement>('.hhr-vitals-patient');
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelector('.hhr-vitals-summary-value')).toHaveClass('is-alert');
    expect(rows[1].textContent).toContain('Sin registros');
    expect(rows[1].querySelector('.hhr-vitals-summary-value strong')?.textContent).toBe('–');
    expect(rows[2].disabled).toBe(true);
    expect(rows[2].textContent).toContain('No disponible');

    rows[0].click();
    expect(openVitalsView).toHaveBeenCalledWith(root, '101', 'detail');
  });

  it('starts scales and patient-header requests in parallel and preserves detail charts and overview navigation', async () => {
    const scales = deferred();
    const patientHeader = deferred();
    const sendMessage = vi.fn((message: Record<string, unknown>) =>
      message.type === runtimeMessages.SCALES_REPORT_REQUEST
        ? scales.promise
        : patientHeader.promise
    );
    const openVitalsView = vi.fn();
    const root = makeRoot();

    runtimeOwner()
      .create(makeDependencies(sendMessage, openVitalsView))
      .renderVitalsCenter(root, '202', 'detail');

    expect(sendMessage.mock.calls.map(call => call[0])).toEqual([
      { type: runtimeMessages.SCALES_REPORT_REQUEST, encId: '202' },
      { type: runtimeMessages.PATIENT_HEADER_REQUEST, encId: '202' },
    ]);
    scales.resolve({
      forms: [
        record('2026-07-18 09:00', 38.4, { observations: 'Control', author: 'Equipo' }),
        record('2026-07-18 08:00', 37.1),
      ],
    });
    await flushPromises();
    expect(root.textContent).toContain('Leyendo signos vitales');
    patientHeader.resolve({ patient: { birthDate: '1980-02-03' } });
    await flushPromises();

    expect(root.querySelector('.hhr-vitals-tile')).toHaveClass('is-alert');
    expect(root.querySelector('.hhr-center-notice')).toBeNull();
    const charts = root.querySelector<HTMLButtonElement>('.hhr-vitals-charts') as HTMLButtonElement;
    expect(charts.hidden).toBe(false);
    charts.click();
    expect(charts.getAttribute('aria-pressed')).toBe('true');
    expect(charts.textContent).toBe('Ocultar gráficas');
    expect(root.querySelector('.hhr-vitals-trend-card svg')).not.toBeNull();
    charts.click();
    expect(charts.getAttribute('aria-pressed')).toBe('false');

    root.querySelector<HTMLButtonElement>('.hhr-vitals-all')?.click();
    expect(openVitalsView).toHaveBeenCalledWith(root, '202', 'overview');
  });

  it.each([
    ['pediatric', '2016-03-04', 'Paciente pediátrico'],
    ['unknown', '', 'Edad no verificable'],
  ])('does not apply adult thresholds to the %s cohort', async (_cohort, birthDate, notice) => {
    const sendMessage = vi.fn(async (message: Record<string, unknown>) =>
      message.type === runtimeMessages.SCALES_REPORT_REQUEST
        ? { forms: [record('2026-07-18 09:00', 39)] }
        : { patient: { birthDate } }
    );
    const root = makeRoot();

    runtimeOwner()
      .create(makeDependencies(sendMessage))
      .renderVitalsCenter(root, '303', 'detail');
    await flushPromises();

    expect(root.querySelector('.hhr-vitals-tile')).toHaveClass('is-ungraded');
    expect(root.querySelector('.hhr-center-notice')?.textContent).toContain(notice);
  });

  it.each(['disconnected', 'module', 'encounter', 'generation'])(
    'ignores a late detail response when the %s stale guard changes',
    async guard => {
      const scales = deferred();
      const patientHeader = deferred();
      const sendMessage = vi.fn((message: Record<string, unknown>) =>
        message.type === runtimeMessages.SCALES_REPORT_REQUEST
          ? scales.promise
          : patientHeader.promise
      );
      const root = makeRoot();
      const content = root.querySelector<HTMLElement>('.hhr-center-main') as HTMLElement;

      runtimeOwner().create(makeDependencies(sendMessage)).renderVitalsCenter(root, '404', 'detail');
      if (guard === 'disconnected') root.remove();
      else if (guard === 'module') root.dataset.activeModule = 'lab';
      else if (guard === 'encounter') root.dataset.selectedEncounterId = '405';
      else root.dataset.vitalsRequestGeneration = '99';

      scales.resolve({ forms: [record('2026-07-18 09:00', 38)] });
      patientHeader.resolve({ patient: { birthDate: '1980-02-03' } });
      await flushPromises();

      expect(content.textContent).toContain('Leyendo signos vitales desde Eloísa');
      expect(content.querySelector('.hhr-vitals-grid')).toBeNull();
    }
  );
});
