import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

export type InventoryInput = {
  files: Record<string, string>;
  scripts: Record<string, string>;
  aggregateIds: string[];
};

export const repositoryInventory = (): InventoryInput => {
  const names = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0');
  const files: Record<string, string> = {};
  for (const name of names) {
    if (
      /^(src|e2e|netlify|functions|extension|scripts|\.github|\.husky)\//.test(name) ||
      /^(vite|vitest|playwright).*config\./.test(name) ||
      ['package.json', 'netlify.toml'].includes(name)
    ) {
      if (fs.existsSync(name) && fs.lstatSync(name).isFile()) {
        files[name] = fs.readFileSync(name, 'utf8');
      }
    }
  }
  const scripts = JSON.parse(files['package.json']).scripts;
  const aggregateIds = JSON.parse(
    files['scripts/config/guardrail-governance.json']
  ).qualityAggregate.checks.map((entry: { id: string }) => entry.id);
  return { files, scripts, aggregateIds };
};

// Conservative textual inventory: even a comment or a basename reference excludes a control.
// A package alias definition alone is harmless; any other package script invoking it counts
// as an external consumer (even if that caller is currently unused). Follow nested npm aliases
// and pre/post hooks. Whole-aggregate invocations are allowed: the reduced gate repeats them.
// The scope configuration declares policy, rather than consuming the controls.
// Matrix/dynamic commands count every literal alias present in the file. Unresolved dynamic
// commands exclude every control: when unsure, retain full validation.
export const inventoryToolingControls = ({ files, scripts, aggregateIds }: InventoryInput) => {
  const controls = Object.keys(files).filter(file => /^scripts\/check-[^/]+\.mjs$/.test(file));
  const expand = (command: string, seen = new Set<string>()): string => {
    let result = command;
    for (const match of command.matchAll(/npm\s+(?:--prefix\s+[^\s]+\s+)?run\s+([\w:-]+)/g)) {
      const name = match[1];
      if (['check:quality', 'check:quality:group'].includes(name) || seen.has(name)) continue;
      seen.add(name);
      for (const alias of [name, `pre${name}`, `post${name}`]) {
        if (scripts[alias]) result += `\n${expand(scripts[alias], seen)}`;
      }
    }
    return result;
  };
  const aggregate = aggregateIds.map(id => expand(scripts[id] || '')).join('\n');
  const protectedFiles = new Set<string>();
  const protect = (file: string) => {
    if (protectedFiles.has(file)) return;
    protectedFiles.add(file);
    for (const imported of ts.preProcessFile(files[file] || '').importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), imported.fileName)
      );
      for (const candidate of [target, `${target}.mjs`, `${target}.json`]) {
        if (candidate in files) protect(candidate);
      }
    }
  };
  protect('scripts/check-quality-aggregate.mjs');
  protect('scripts/classify-ci-change-scope.mjs');
  const consumers = Object.entries(files).filter(
    ([file]) =>
      !['package.json', 'scripts/config/ci-change-scope.json'].includes(file) &&
      !/^src\/tests\/(scripts|build)\//.test(file)
  );
  const expandedConsumers = consumers.map(([file, content]) => {
    let command = content;
    if (/npm\s+run\s+\$/.test(content)) {
      const aliases = Object.keys(scripts).filter(alias => content.includes(alias));
      command += aliases.length
        ? aliases.map(alias => `\nnpm run ${alias}`).join('')
        : controls.join('\n');
    }
    return [file, expand(command)];
  });
  // Ignore definitions themselves; only npm invocations in another script are consumers.
  for (const [name, command] of Object.entries(scripts)) {
    expandedConsumers.push([`package.json#${name}`, expand(command).slice(command.length)]);
  }
  return controls.sort().map(control => {
    const basename = path.posix.basename(control);
    const reasons: string[] = [];
    if (!aggregate.includes(control)) reasons.push('not_in_aggregate');
    if (protectedFiles.has(control)) reasons.push('aggregate_or_classifier_dependency');
    for (const [file, content] of expandedConsumers) {
      if (file !== control && content.includes(basename))
        reasons.push(`external_reference:${file}`);
    }
    return { control, reasons };
  });
};

export const assertToolingControls = (controls: string[], input = repositoryInventory()) => {
  const inventory = inventoryToolingControls(input);
  for (const control of controls) {
    const entry = inventory.find(item => item.control === control);
    if (!entry || entry.reasons.length) {
      throw new Error(`${control}: ${entry?.reasons.join(', ') || 'not_a_repository_control'}`);
    }
  }
};
