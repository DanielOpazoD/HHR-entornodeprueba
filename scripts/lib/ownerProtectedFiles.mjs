import { execFileSync } from 'node:child_process';

export const OWNER_PROTECTED_FILES_CONFIG = 'scripts/config/owner-protected-files.json';

/** printables/ and the PNGs at the repository root: touching them needs the owner's approval. */
const isAskOwnerFirstPath = file => file.startsWith('printables/') || /^[^/]+\.png$/i.test(file);

/** Tracked path → blob id, from the git index (`git ls-files -s -z`). */
export const readTrackedBlobs = (cwd = process.cwd()) =>
  new Map(
    execFileSync('git', ['ls-files', '-s', '-z'], { cwd, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
      .map(entry => {
        const [meta, file] = entry.split('\t');
        return [file, meta.split(' ')[1]];
      })
  );

/**
 * AGENTS.md: Formularios/ and Hospital Salvador/ are never deleted, and printables/ and the root PNGs
 * change only with the owner's approval, recorded as the new blob in the config.
 */
export const findOwnerProtectedFileChanges = (config, trackedBlobs) => {
  const failures = [];
  for (const file of config.neverDelete ?? []) {
    if (!trackedBlobs.has(file)) {
      failures.push(
        `${file} ya no está en el repositorio. AGENTS.md prohíbe borrar Formularios/ y Hospital Salvador/: restáuralo con git checkout origin/main -- "${file}".`
      );
    }
  }
  const approved = config.askOwnerFirst ?? {};
  const askOwner = `AGENTS.md pide preguntar al responsable antes de tocar printables/ o los PNG de la raíz. Sin su aprobación, deshaz el cambio; con ella, `;
  for (const [file, blob] of Object.entries(approved)) {
    const current = trackedBlobs.get(file);
    if (current === blob) continue;
    failures.push(
      current
        ? `${file} cambió. ${askOwner}registra "${file}": "${current}" en ${OWNER_PROTECTED_FILES_CONFIG}.`
        : `${file} se borró. ${askOwner}quita "${file}" de ${OWNER_PROTECTED_FILES_CONFIG}.`
    );
  }
  for (const [file, blob] of trackedBlobs) {
    if (isAskOwnerFirstPath(file) && !(file in approved)) {
      failures.push(
        `${file} es nuevo. ${askOwner}registra "${file}": "${blob}" en ${OWNER_PROTECTED_FILES_CONFIG}.`
      );
    }
  }
  return failures;
};
