import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const VIEW_CONTRACTS_PATH = 'src/features/census/components/patient-row/patientRowViewContracts.ts';
const PUBLIC_CONTRACTS_PATH = 'src/features/census/components/patient-row/patientRowContracts.ts';
const SCAN_ROOTS = ['src/features/census/components', 'src/features/census/controllers'];
const INTERNAL_CONTRACT_FILES = new Set([
  PUBLIC_CONTRACTS_PATH,
  VIEW_CONTRACTS_PATH,
  'src/features/census/components/patient-row/patientRowDataContracts.ts',
  'src/features/census/components/patient-row/patientRowInputViewContracts.ts',
  'src/features/census/components/patient-row/patientRowMainViewContracts.ts',
  'src/features/census/components/patient-row/patientRowShellViewContracts.ts',
]);

const listSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap(entry => {
    const path = `${directory}/${entry}`;
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return listSourceFiles(path);
    }

    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });

describe('Patient row view contracts governance', () => {
  it('keeps patientRowViewContracts as a compatibility barrel', () => {
    const content = readFileSync(VIEW_CONTRACTS_PATH, 'utf8');

    expect(content).not.toMatch(/export interface\s+/);
    expect(content).toMatch(/export type \{[^}]*PatientInputCellsProps/s);
    expect(content).toMatch(/export type \{[^}]*PatientMainRowViewProps/s);
    expect(content).toMatch(/export type \{[^}]*PatientRowModalsProps/s);
  });

  it('exposes patient-row view contracts from the stable public contract barrel', () => {
    const content = readFileSync(PUBLIC_CONTRACTS_PATH, 'utf8');

    expect(content).toMatch(/export type \{[^}]*PatientInputCellsProps/s);
    expect(content).toMatch(/export type \{[^}]*PatientMainRowViewProps/s);
    expect(content).toMatch(/export type \{[^}]*PatientRowModalsProps/s);
  });

  it('exposes patient-device callbacks from the stable public contract barrel', () => {
    const content = readFileSync(PUBLIC_CONTRACTS_PATH, 'utf8');

    expect(content).toMatch(/export interface PatientDeviceCallbacks/);
    expect(content).toContain('onDevicesChange: (devices: string[]) => void;');
    expect(content).toContain('onDeviceBundleChange?: (fields: PatientRowPatientPatch) => void;');
  });

  it('keeps census row consumers on the stable patientRowContracts barrel', () => {
    const forbiddenImports = [
      'patient-row/patientRowDataContracts',
      'patient-row/patientRowViewContracts',
      './patientRowDataContracts',
      './patientRowViewContracts',
    ];

    const offenders = SCAN_ROOTS.flatMap(listSourceFiles).filter(path => {
      if (INTERNAL_CONTRACT_FILES.has(path)) {
        return false;
      }

      const content = readFileSync(path, 'utf8');
      return forbiddenImports.some(importPath => content.includes(importPath));
    });

    expect(offenders).toEqual([]);
  });
});
