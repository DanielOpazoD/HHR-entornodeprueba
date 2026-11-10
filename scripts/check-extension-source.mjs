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
    const listed = changed.slice(0, 10).join(', ');
    const rest = changed.length > 10 ? ` y ${changed.length - 10} más` : '';
    throw new Error(
      `extension/ difiere del commit de @hhr/eloisa-extension fijado en package.json. Arreglo: ejecuta npm ci para instalar ese commit y después npm run extension:sync. La extensión se desarrolla en DanielOpazoD/extensioneloisahhr; extension/ no se edita a mano. Archivos distintos (${changed.length}): ${listed}${rest}.`
    );
  }
  return { files: expected.size, synchronized: changed.length };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(
      JSON.stringify(
        checkExtensionSource({ root: process.cwd(), write: process.argv.includes('--write') })
      )
    );
  } catch (error) {
    console.error(`[extension-source] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
