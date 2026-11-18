#!/usr/bin/env node

/**
 * Keeps scripts/config/feature-map.json true: for every feature a person uses, how they reach
 * it, the code entry point and the tests that prove it works. It does not require new files to
 * join the map; it requires that whatever the map cites exists:
 *
 *  - every gate path and test path exists, and a cited test is a test file;
 *  - "owner" is the folder that holds the first gate, where the function's main decision lives,
 *    so an agent knows in one step where to work;
 *  - a test cited as `path › title` contains that exact title as a string literal;
 *  - a cited e2e spec runs in CI or nightly (scripts/config/e2e-test-ownership.json);
 *  - every feature cites at least one test and one visible control;
 *  - a `testId` appears as a string literal, and a `text` appears verbatim, in app code under
 *    src/ (tests, specs and stories excluded);
 *  - every rule is a row of docs/DOMAIN_RULES.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const FEATURE_MAP_PATH = 'scripts/config/feature-map.json';
const OWNERSHIP_PATH = 'scripts/config/e2e-test-ownership.json';
const DOMAIN_RULES_PATH = 'docs/DOMAIN_RULES.md';
const TITLE_SEPARATOR = ' › ';
const PROVING_E2E_LANES = new Set(['ci', 'nightly']);
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const APP_SOURCE = /\.(ts|tsx|js|jsx)$/;

const toPosix = value => value.split(path.sep).join('/');

const isAppSource = relativePath =>
  APP_SOURCE.test(relativePath) &&
  !relativePath.startsWith('src/tests/') &&
  !/\.(test|spec|stories)\./.test(relativePath);

const readAppSources = root => {
  const sources = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.isFile() && isAppSource(toPosix(path.relative(root, absolutePath)))) {
        sources.push(fs.readFileSync(absolutePath, 'utf8'));
      }
    }
  };
  walk(path.join(root, 'src'));
  return sources;
};

const statOf = (root, relativePath) => {
  try {
    return fs.statSync(path.join(root, relativePath));
  } catch {
    return null;
  }
};
const isFile = (root, relativePath) => statOf(root, relativePath)?.isFile() === true;
const isDirectory = (root, relativePath) => statOf(root, relativePath)?.isDirectory() === true;

const quotedIn = (source, value) =>
  ['"', "'", '`'].some(quote => source.includes(`${quote}${value}${quote}`));

const fail = lines => ({ status: 1, stdout: '', stderr: `${lines.join('\n')}\n` });

export const checkFeatureMap = (root = process.cwd(), { mapPath = FEATURE_MAP_PATH } = {}) => {
  let map;
  try {
    map = JSON.parse(fs.readFileSync(path.resolve(root, mapPath), 'utf8'));
  } catch (error) {
    return fail([`[feature-map] No se pudo leer ${mapPath}: ${error.message}`]);
  }
  const features = Array.isArray(map?.features) ? map.features : [];
  if (features.length === 0) {
    return fail([`[feature-map] ${mapPath} no tiene funciones en "features".`]);
  }

  const ownership = JSON.parse(fs.readFileSync(path.join(root, OWNERSHIP_PATH), 'utf8'));
  const laneBySpec = new Map(ownership.specs.map(spec => [spec.file, spec.lane]));
  const domainRules = fs.readFileSync(path.join(root, DOMAIN_RULES_PATH), 'utf8');
  let appSources;
  const appSourcesOnce = () => (appSources ??= readAppSources(root));

  const problems = [];
  const seenIds = new Set();
  for (const [index, feature] of features.entries()) {
    const id = typeof feature?.id === 'string' && feature.id ? feature.id : `#${index + 1}`;
    const report = (problem, fix) => problems.push(`- ${id}: ${problem}\n  ${fix}`);

    if (seenIds.has(id)) report('el id está repetido.', 'Usa un id único por función.');
    seenIds.add(id);
    if (typeof feature?.name !== 'string' || !feature.name.trim()) {
      report('falta "name".', 'Escribe el nombre que ve la persona, en español.');
    }
    if (typeof feature?.reach?.screen !== 'string' || !feature.reach.screen.trim()) {
      report('falta "reach.screen".', 'Di en qué pantalla o menú se llega a la función.');
    }

    const controls = Array.isArray(feature?.reach?.controls) ? feature.reach.controls : [];
    if (controls.length === 0) {
      report(
        'no cita ningún control visible.',
        'Agrega en "reach.controls" un { "testId" } o un { "text" } que la persona use.'
      );
    }
    for (const control of controls) {
      if (typeof control?.testId === 'string') {
        if (!appSourcesOnce().some(source => quotedIn(source, control.testId))) {
          report(
            `el data-testid "${control.testId}" no aparece en el código de src/.`,
            'Corrígelo con el valor literal actual o cita el texto visible del control.'
          );
        }
      } else if (typeof control?.text === 'string' && control.text) {
        if (!appSourcesOnce().some(source => source.includes(control.text))) {
          report(
            `el texto «${control.text}» no aparece en el código de src/.`,
            'Cópialo tal como lo muestra la pantalla, o cita su data-testid.'
          );
        }
      } else {
        report('un control no tiene "testId" ni "text".', 'Cada control lleva uno de los dos.');
      }
    }

    const gate = Array.isArray(feature?.gate) ? feature.gate : [];
    if (gate.length < 1 || gate.length > 3) {
      report(`cita ${gate.length} puertas de código.`, 'Cita de 1 a 3 rutas de entrada en "gate".');
    }
    for (const gatePath of gate) {
      if (!isFile(root, gatePath)) {
        report(
          `la puerta ${gatePath} no existe.`,
          'Si el código se movió, cita su ruta nueva; el mapa sigue al código.'
        );
      }
    }

    const owner = typeof feature?.owner === 'string' ? feature.owner.replace(/\/+$/, '') : '';
    if (!owner) {
      report(
        'falta "owner".',
        'Escribe la carpeta que contiene la primera puerta, donde vive la decisión principal.'
      );
    } else if (!isDirectory(root, owner)) {
      report(
        `la carpeta dueña ${owner} no existe.`,
        'Si el código se movió, cita la carpeta nueva que contiene la primera puerta.'
      );
    } else if (gate.length > 0 && !gate[0].startsWith(`${owner}/`)) {
      report(
        `la primera puerta ${gate[0]} no está dentro de la carpeta dueña ${owner}.`,
        'La primera puerta es la decisión principal: pon en "owner" la carpeta que la contiene.'
      );
    }

    const tests = Array.isArray(feature?.tests) ? feature.tests : [];
    if (tests.length === 0) {
      report(
        'no cita ninguna prueba.',
        'Cita en "tests" la prueba que acredita la función; si no existe, escríbela primero.'
      );
    }
    for (const citation of tests) {
      const separatorAt = citation.indexOf(TITLE_SEPARATOR);
      const testPath = separatorAt === -1 ? citation : citation.slice(0, separatorAt);
      const title = separatorAt === -1 ? '' : citation.slice(separatorAt + TITLE_SEPARATOR.length);
      if (!TEST_FILE.test(testPath)) {
        report(`${testPath} no es un archivo de prueba.`, 'Cita un *.test.* o un *.spec.*.');
        continue;
      }
      if (!isFile(root, testPath)) {
        report(
          `la prueba ${testPath} no existe.`,
          'Si se movió o se unió con otra, cita la ruta que hoy prueba la función.'
        );
        continue;
      }
      if (title && !quotedIn(fs.readFileSync(path.join(root, testPath), 'utf8'), title)) {
        report(
          `${testPath} no tiene una prueba titulada «${title}».`,
          'Copia el título exacto del test(...) actual, o quita el título y cita solo el archivo.'
        );
      }
      if (testPath.startsWith('e2e/')) {
        const lane = laneBySpec.get(testPath);
        if (!PROVING_E2E_LANES.has(lane)) {
          report(
            `${testPath} tiene carril "${lane ?? 'sin registrar'}" en ${OWNERSHIP_PATH}: no corre en CI ni nightly.`,
            'Cita una prueba que corra, o lleva ese spec a un carril automático.'
          );
        }
      }
    }

    for (const rule of Array.isArray(feature?.rules) ? feature.rules : []) {
      if (!new RegExp(`^\\|\\s*${rule.replace(/[-]/g, '\\-')}\\s*\\|`, 'm').test(domainRules)) {
        report(
          `la regla ${rule} no es una fila de ${DOMAIN_RULES_PATH}.`,
          'Usa el identificador exacto del contrato operativo (ID-01, SAVE-01, ...).'
        );
      }
    }
  }

  if (problems.length > 0) {
    return fail([
      `[feature-map] ${mapPath} cita cosas que no son verdad (${problems.length}):`,
      ...problems,
    ]);
  }
  const testCount = features.reduce((total, feature) => total + feature.tests.length, 0);
  return {
    status: 0,
    stdout: `[feature-map] OK: ${features.length} funciones con puerta, control y ${testCount} pruebas verificadas.\n`,
    stderr: '',
  };
};

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { status, stdout, stderr } = checkFeatureMap();
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = status;
}
