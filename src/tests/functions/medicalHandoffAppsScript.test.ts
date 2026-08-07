import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

interface AppsScriptContext {
  mergeHhrRows_: (existingRows: unknown[][], incomingRows: Record<string, string>[]) => unknown[][];
}

const loadAppsScriptContext = (): AppsScriptContext => {
  const source = readFileSync(
    path.join(process.cwd(), 'integrations/google-apps-script/medical-handoff/Code.gs'),
    'utf8'
  );
  const context = vm.createContext({});
  vm.runInContext(source, context);
  return context as unknown as AppsScriptContext;
};

describe('medical handoff Apps Script', () => {
  it('updates census fields without erasing handoff text or historical rows', () => {
    const { mergeHhrRows_ } = loadAppsScriptContext();
    const existingRows = [
      [
        'R1',
        'Paciente Uno',
        '52a',
        'Diagnóstico previo',
        'Medicina',
        '',
        'Texto médico',
        'episode:1',
      ],
      [
        'R2',
        'Paciente Egresado',
        '60a',
        'Diagnóstico',
        'Cirugía',
        '',
        'Entrega histórica',
        'episode:2',
      ],
    ];

    const result = mergeHhrRows_(existingRows, [
      {
        stableKey: 'episode:1',
        bed: 'H1C1',
        patientName: 'Paciente Uno',
        age: '52a',
        diagnosis: 'Diagnóstico actualizado',
        specialty: 'Medicina',
        treatingPhysician: 'Dra. Aravena',
      },
      {
        stableKey: 'episode:3',
        bed: 'H2C1',
        patientName: '=IMPORTDATA("https://example.com")',
        age: '40a',
        diagnosis: 'Diagnóstico nuevo',
        specialty: 'Cirugía',
        treatingPhysician: '',
      },
    ]);

    expect(result).toEqual([
      [
        'H1C1',
        'Paciente Uno',
        '52a',
        'Diagnóstico actualizado',
        'Medicina',
        'Dra. Aravena',
        'Texto médico',
        'episode:1',
      ],
      existingRows[1],
      [
        'H2C1',
        '\'=IMPORTDATA("https://example.com")',
        '40a',
        'Diagnóstico nuevo',
        'Cirugía',
        '',
        '',
        'episode:3',
      ],
    ]);
    expect(existingRows[0][3]).toBe('Diagnóstico previo');
  });
});
