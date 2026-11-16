// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findOwnerProtectedFileChanges } from '../../../scripts/lib/ownerProtectedFiles.mjs';

const config = {
  neverDelete: ['Formularios/consentimiento.pdf', 'Hospital Salvador/Correos.txt'],
  askOwnerFirst: { 'printables/poster.pdf': 'aaa', 'Rapa.png': 'bbb' },
};
const tree = (changes: Record<string, string | null> = {}) => {
  const blobs = new Map([
    ['Formularios/consentimiento.pdf', 'f1'],
    ['Hospital Salvador/Correos.txt', 'h1'],
    ['printables/poster.pdf', 'aaa'],
    ['Rapa.png', 'bbb'],
    ['src/assets/icon.png', 'ccc'],
  ]);
  for (const [file, blob] of Object.entries(changes)) {
    if (blob === null) blobs.delete(file);
    else blobs.set(file, blob);
  }
  return blobs;
};

describe('owner-protected files (AGENTS.md)', () => {
  it('accepts the recorded tree, new forms and PNGs outside the root', () => {
    expect(findOwnerProtectedFileChanges(config, tree({ 'Formularios/nuevo.pdf': 'n1' }))).toEqual(
      []
    );
  });

  it('rejects deleting a form and says how to restore it', () => {
    expect(
      findOwnerProtectedFileChanges(config, tree({ 'Hospital Salvador/Correos.txt': null }))
    ).toEqual([
      'Hospital Salvador/Correos.txt ya no está en el repositorio. AGENTS.md prohíbe borrar Formularios/ y Hospital Salvador/: restáuralo con git checkout origin/main -- "Hospital Salvador/Correos.txt".',
    ]);
  });

  it('rejects changing, deleting or adding printables and root PNGs without the owner', () => {
    const failures = findOwnerProtectedFileChanges(
      config,
      tree({ 'printables/poster.pdf': 'zzz', 'Rapa.png': null, 'captura.PNG': 'ddd' })
    );
    expect(failures).toHaveLength(3);
    expect(failures[0]).toContain(
      'printables/poster.pdf cambió. AGENTS.md pide preguntar al responsable'
    );
    expect(failures[0]).toContain(
      'registra "printables/poster.pdf": "zzz" en scripts/config/owner-protected-files.json'
    );
    expect(failures[1]).toContain('Rapa.png se borró.');
    expect(failures[1]).toContain('quita "Rapa.png" de scripts/config/owner-protected-files.json');
    expect(failures[2]).toContain('captura.PNG es nuevo.');
    expect(failures[2]).toContain('registra "captura.PNG": "ddd"');
  });
});
