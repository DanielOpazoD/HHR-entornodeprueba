import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

interface AppsScriptContext {
  mergeHhrRows_: (existingRows: unknown[][], incomingRows: Record<string, string>[]) => unknown[][];
}

const hashEpisodeStableKey = (episodeId: string): string =>
  `episode-h1:${createHash('sha384').update(episodeId).digest('hex')}`;

const loadAppsScriptContext = (): AppsScriptContext => {
  const source = readFileSync(
    path.join(process.cwd(), 'integrations/google-apps-script/medical-handoff/Code.gs'),
    'utf8'
  );
  const context = vm.createContext({
    Utilities: {
      DigestAlgorithm: { SHA_384: 'SHA_384' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm: string, value: string) =>
        Array.from(createHash('sha384').update(value, 'utf8').digest()).map(byte =>
          byte > 127 ? byte - 256 : byte
        ),
    },
  });
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
        hashEpisodeStableKey('1'),
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
        hashEpisodeStableKey('1'),
      ],
      [
        'R2',
        'Paciente Egresado',
        '60a',
        'Diagnóstico',
        'Cirugía',
        '',
        'Entrega histórica',
        hashEpisodeStableKey('2'),
      ],
      [
        'H2C1',
        '\'=IMPORTDATA("https://example.com")',
        '40a',
        'Diagnóstico nuevo',
        'Cirugía',
        '',
        '',
        hashEpisodeStableKey('3'),
      ],
    ]);
    expect(existingRows[0][3]).toBe('Diagnóstico previo');
  });

  it('escapes formula-like stable keys and matches them again on refresh', () => {
    const { mergeHhrRows_ } = loadAppsScriptContext();
    const incomingRow = {
      stableKey: '-episode',
      bed: 'R1',
      patientName: 'Paciente Uno',
      age: '52a',
      diagnosis: 'Diagnóstico',
      specialty: 'Medicina',
      treatingPhysician: '',
    };

    const first = mergeHhrRows_([], [incomingRow]);
    const second = mergeHhrRows_(first, [{ ...incomingRow, diagnosis: 'Actualizado' }]);

    expect(first[0][7]).toBe("'-episode");
    expect(second).toHaveLength(1);
    expect(second[0][3]).toBe('Actualizado');
  });

  it('migrates even hash-shaped legacy episode keys and preserves the handoff text', () => {
    const { mergeHhrRows_ } = loadAppsScriptContext();
    const episodeId = 'a'.repeat(96);
    const hashedKey = hashEpisodeStableKey(episodeId);
    const existingRows = [
      [
        'R1',
        'Paciente Uno',
        '52a',
        'Diagnóstico previo',
        'Medicina',
        '',
        'Entrega que debe conservarse',
        `episode:${episodeId}`,
      ],
    ];
    const nextRow = {
      stableKey: hashedKey,
      bed: 'H1C1',
      patientName: 'Paciente Uno',
      age: '52a',
      diagnosis: 'Diagnóstico actualizado',
      specialty: 'Medicina',
      treatingPhysician: 'Dra. Aravena',
    };

    const migrated = mergeHhrRows_(existingRows, [nextRow]);
    const refreshedByLegacyClient = mergeHhrRows_(migrated, [
      { ...nextRow, stableKey: `episode:${episodeId}`, diagnosis: 'Segundo cambio' },
    ]);

    expect(migrated).toHaveLength(1);
    expect(migrated[0][6]).toBe('Entrega que debe conservarse');
    expect(migrated[0][7]).toBe(hashedKey);
    expect(refreshedByLegacyClient).toHaveLength(1);
    expect(refreshedByLegacyClient[0][3]).toBe('Segundo cambio');
    expect(refreshedByLegacyClient[0][7]).toBe(hashedKey);
  });

  it('collapses legacy and versioned aliases without losing either handoff note', () => {
    const { mergeHhrRows_ } = loadAppsScriptContext();
    const episodeId = 'episode-with-two-existing-aliases';
    const hashedKey = hashEpisodeStableKey(episodeId);
    const existingRows = [
      ['R1', 'Paciente Uno', '', '', '', '', 'Nota antigua', `episode:${episodeId}`],
      ['H1C1', 'Paciente Uno', '', '', '', '', 'Nota reciente', hashedKey],
    ];

    const result = mergeHhrRows_(existingRows, [
      {
        stableKey: hashedKey,
        bed: 'H1C1',
        patientName: 'Paciente Uno',
        age: '52a',
        diagnosis: 'Diagnóstico vigente',
        specialty: 'Medicina',
        treatingPhysician: 'Dra. Aravena',
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0][6]).toBe('Nota antigua\n\n---\n\nNota reciente');
    expect(result[0][7]).toBe(hashedKey);
  });
});
