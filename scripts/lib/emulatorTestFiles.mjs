import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const folders = {
  'src/tests/emulator': 'vitest.emulator.config.ts',
  'src/tests/emulator-ui': 'vitest.emulator-ui.config.ts',
};
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function emulatorTestCommand(args, root = process.cwd()) {
  const separator = args.indexOf('--');
  const files = separator < 0 ? args : args.slice(0, separator);
  const options = separator < 0 ? [] : args.slice(separator + 1);
  if (!files.length)
    throw new Error('Indica un archivo en src/tests/emulator/ o src/tests/emulator-ui/.');
  const groups = new Map();
  for (const file of files) {
    const relative = path.relative(root, path.resolve(root, file));
    const folder = Object.keys(folders).find(candidate => relative.startsWith(`${candidate}/`));
    if (
      !folder ||
      !/\.test\.tsx?$/.test(relative) ||
      !fs.statSync(path.resolve(root, file), { throwIfNoEntry: false })?.isFile()
    ) {
      throw new Error(
        `Ruta inválida: ${file}. Usa archivos .test.ts o .test.tsx existentes en src/tests/emulator/ o src/tests/emulator-ui/.`
      );
    }
    const group = groups.get(folder) ?? [];
    group.push(relative);
    groups.set(folder, group);
  }
  return [...groups]
    .map(
      ([folder, paths]) =>
        `RUN_FIRESTORE_EMULATOR_TESTS=1 ./node_modules/.bin/vitest run -c ${folders[folder]} ${[...paths, ...options].map(quote).join(' ')}`
    )
    .join(' && ');
}

// A listening emulator can still be compiling its initial rules. Wait for that
// work before Vitest starts its existing per-test and hook timeouts.
export async function prepareFirestoreRules() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!/^127\.0\.0\.1:\d+$/.test(host ?? '')) {
    throw new Error('La preparación requiere FIRESTORE_EMULATOR_HOST local.');
  }
  const response = await fetch(
    `http://${host}/emulator/v1/projects/demo-hhr-emulator-file:securityRules`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: {
          files: [{ name: 'firestore.rules', content: fs.readFileSync('firestore.rules', 'utf8') }],
        },
      }),
    }
  );
  if (!response.ok)
    throw new Error(`No se prepararon las reglas del emulador: HTTP ${response.status}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === '--prepare') await prepareFirestoreRules();
    else if (process.argv[2] === '--command')
      console.log(emulatorTestCommand(process.argv.slice(3)));
    else throw new Error('Usa npm run test:emulator:file -- <ruta>.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
