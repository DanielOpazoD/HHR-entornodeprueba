import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { extensionDirectory } from '@hhr/eloisa-extension/package';

const inventory = root => {
  const files = new Map();
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (name === 'README.md') continue;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.set(name, fs.readFileSync(path.join(root, name)));
      else throw new Error(`Tipo de archivo no permitido en la extensión: ${name}`);
    }
  };
  walk('');
  return files;
};

export const checkExtensionSource = ({ root, sourceRoot = extensionDirectory, write = false }) => {
  const destination = path.join(root, 'extension');
  const expected = inventory(sourceRoot);
  const current = inventory(destination);
  const changed = [...new Set([...expected.keys(), ...current.keys()])].filter(
    name => !expected.get(name)?.equals(current.get(name) ?? Buffer.alloc(0)) || !current.has(name)
  );
  if (write && changed.length) {
    const pending = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=all', '--', 'extension'],
      { cwd: root, encoding: 'utf8' }
    );
    if (pending.trim())
      throw new Error(
        'Guarda las ediciones de extension/ antes de sincronizar; no se sobrescriben cambios pendientes.'
      );
    for (const name of changed) {
      const target = path.join(destination, name);
      if (!expected.has(name)) fs.unlinkSync(target);
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, expected.get(name));
      }
    }
  } else if (changed.length) {
    throw new Error(
      `extension/ difiere de la dependencia fijada (${changed.join(', ')}). Desarrolla en extensioneloisahhr y ejecuta npm run extension:sync tras actualizar su commit.`
    );
  }
  return { files: expected.size, synchronized: changed.length };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(
    JSON.stringify(
      checkExtensionSource({ root: process.cwd(), write: process.argv.includes('--write') })
    )
  );
}
