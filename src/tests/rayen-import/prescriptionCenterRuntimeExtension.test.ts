// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-center-shell-runtime.js';
import '../../../extension/hhr-prescription-center.js';
import '../../../extension/hhr-hospitalized-documents-center.js';
import '../../../extension/hhr-handoff-center.js';
import '../../../extension/hhr-scores-center.js';
import '../../../extension/hhr-lab-center.js';

type RuntimeOwner = {
  create: (dependencies: Record<string, unknown>) => { open: (...args: unknown[]) => unknown };
};

const dependencies = {
  helper: {},
  runtimeMessages: {},
  currentRouteEncounterId: vi.fn(() => ''),
  prepareCenterModalRoot: vi.fn(),
  runClinicalTransition: vi.fn(),
  normalizedText: vi.fn((value: unknown) => String(value || '')),
  sendMessage: vi.fn(),
  setLiveRegion: vi.fn(),
  attachPatientListFilter: vi.fn(),
  openHospitalizedDocuments: vi.fn(),
  openPrescriptionCenter: vi.fn(),
};

const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
};
const contentSource = readFileSync(path.resolve('extension/content-prescription-print.js'), 'utf8');
const centerShellSource = readFileSync(
  path.resolve('extension/hhr-center-shell-runtime.js'),
  'utf8'
);
const prescriptionSource = readFileSync(
  path.resolve('extension/hhr-prescription-center.js'),
  'utf8'
);
const hospitalizedDocumentsSource = readFileSync(
  path.resolve('extension/hhr-hospitalized-documents-center.js'),
  'utf8'
);
const handoffSource = readFileSync(
  path.resolve('extension/hhr-handoff-center.js'),
  'utf8'
);
const scoresSource = readFileSync(
  path.resolve('extension/hhr-scores-center.js'),
  'utf8'
);
const labCenterSource = readFileSync(path.resolve('extension/hhr-lab-center.js'), 'utf8');
const lineCount = (source: string) => source.split('\n').length;

describe('Centro HHR prescription runtime ownership', () => {
  it('fails closed when either owner is initialized without its required dependencies', () => {
    expect(() => globalThis.HhrPrescriptionCenterRuntime.create({})).toThrow(
      /Centro de Recetas HHR/
    );
    expect(() => globalThis.HhrHospitalizedDocumentsCenterRuntime.create({})).toThrow(
      /Documentos Hospitalizados HHR/
    );
    expect(() => globalThis.HhrHandoffCenterRuntime.create({})).toThrow(
      /Centro de Turno HHR/
    );
    expect(() => globalThis.HhrScoresCenterRuntime.create({})).toThrow(
      /Centro de Scores HHR/
    );
    expect(() => globalThis.HhrLabCenterRuntime.create({})).toThrow(
      /Laboratorio HHR/
    );
    expect(() => globalThis.HhrCenterShellRuntime.create({})).toThrow(
      /shell del Centro HHR/
    );
  });

  it('exposes one immutable open operation per owner', () => {
    const prescription = globalThis.HhrPrescriptionCenterRuntime.create(dependencies);
    const documents = globalThis.HhrHospitalizedDocumentsCenterRuntime.create(dependencies);

    expect(prescription.open).toBeTypeOf('function');
    expect(documents.open).toBeTypeOf('function');
    expect(Object.isFrozen(prescription)).toBe(true);
    expect(Object.isFrozen(documents)).toBe(true);
  });

  it('loads both owners before the Centro HHR orchestrator', () => {
    const fichaEntry = (manifest.content_scripts || []).find(
      entry =>
        entry.matches?.includes('https://fichamedico.rayensalud.cl/*') &&
        entry.js?.includes('content-prescription-print.js')
    );
    const scripts = fichaEntry?.js || [];

    expect(scripts.indexOf('hhr-prescription-center.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-center-shell-runtime.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-hospitalized-documents-center.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-handoff-center.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-scores-center.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-lab-center.js')).toBeGreaterThan(-1);
    expect(scripts.indexOf('hhr-prescription-center.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(scripts.indexOf('hhr-center-shell-runtime.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(scripts.indexOf('hhr-hospitalized-documents-center.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(scripts.indexOf('hhr-handoff-center.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(scripts.indexOf('hhr-scores-center.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(scripts.indexOf('hhr-lab-center.js')).toBeLessThan(
      scripts.indexOf('content-prescription-print.js')
    );
    expect(contentSource).toContain('prescriptionCenterOwner.create({');
    expect(contentSource).toContain('hospitalizedDocumentsCenterOwner.create({');
    expect(contentSource).not.toContain('const createModal = (');
    expect(contentSource).not.toContain('const createHospitalizedDocumentsModal = (');
    expect(contentSource).toContain('handoffCenterOwner.create({');
    expect(contentSource).toContain('scoresCenterOwner.create({');
    expect(contentSource).toContain('!handoffCenterOwner ||');
    expect(contentSource).toContain('!scoresCenterOwner ||');
    expect(contentSource).not.toContain('const renderHandoffCenter =');
    expect(contentSource).not.toContain('const renderScoresCenter =');
    expect(contentSource).toContain('labCenterOwner.create({');
    expect(contentSource).not.toContain('const renderLabCenter =');
    expect(contentSource).not.toContain('const renderLabRequestView =');
    expect(contentSource).toContain('centerShellOwner.create({');
    expect(contentSource).not.toContain('const centerShellMarkup =');
    expect(contentSource).not.toContain('const setupCenterPatientContext =');
  });

  it('keeps the orchestrator and extracted owners inside their bounded size budgets', () => {
    expect(lineCount(contentSource)).toBeLessThanOrEqual(2_750);
    expect(lineCount(centerShellSource)).toBeLessThanOrEqual(400);
    expect(lineCount(prescriptionSource)).toBeLessThanOrEqual(700);
    expect(lineCount(hospitalizedDocumentsSource)).toBeLessThanOrEqual(400);
    expect(lineCount(handoffSource)).toBeLessThanOrEqual(400);
    expect(lineCount(scoresSource)).toBeLessThanOrEqual(600);
    expect(lineCount(labCenterSource)).toBeLessThanOrEqual(850);
  });
});

declare global {
  var HhrPrescriptionCenterRuntime: RuntimeOwner;
  var HhrCenterShellRuntime: RuntimeOwner;
  var HhrHospitalizedDocumentsCenterRuntime: RuntimeOwner;
  var HhrHandoffCenterRuntime: RuntimeOwner;
  var HhrScoresCenterRuntime: RuntimeOwner;
  var HhrLabCenterRuntime: RuntimeOwner;
}
