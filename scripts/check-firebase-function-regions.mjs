#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Verifica (name@region) exactos en la salida de `firebase functions:list --json`.
 * Complementa a check-deployed-firebase-functions.mjs, que es agnóstico de
 * región: aquí se prueba que una función viva SOLO donde el código la declara.
 *
 * `firebase functions:delete` puede terminar con exit 0 aunque el borrado
 * falle (el error queda en el reporte, no en el código de salida), así que la
 * única evidencia fiable de que una copia huérfana desapareció es LISTAR
 * después y comprobar su ausencia. Fail-closed ante un payload inesperado.
 */
const parseSpec = spec => {
  const at = typeof spec === 'string' ? spec.lastIndexOf('@') : -1;
  if (at <= 0 || at === spec.length - 1) return null;
  return { id: spec.slice(0, at), region: spec.slice(at + 1) };
};

export const collectDeployedFunctionLocations = payload => {
  const endpoints = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(endpoints)) return new Set();
  return new Set(
    endpoints
      .filter(
        endpoint =>
          endpoint &&
          typeof endpoint === 'object' &&
          typeof endpoint.id === 'string' &&
          endpoint.id.length > 0 &&
          typeof endpoint.region === 'string' &&
          endpoint.region.length > 0
      )
      .map(endpoint => `${endpoint.id}@${endpoint.region}`)
  );
};

/** Specs requeridos que faltan y specs prohibidos que siguen presentes. */
export const evaluateFirebaseFunctionRegions = (payload, requiredSpecs, forbiddenSpecs) => {
  const deployed = collectDeployedFunctionLocations(payload);
  const invalid = [...requiredSpecs, ...forbiddenSpecs].filter(spec => !parseSpec(spec));
  return {
    invalid,
    missing: requiredSpecs.filter(spec => parseSpec(spec) && !deployed.has(spec)),
    lingering: forbiddenSpecs.filter(spec => parseSpec(spec) && deployed.has(spec)),
  };
};

const main = () => {
  const [, , evidencePath, ...specs] = process.argv;
  const requiredSpecs = specs.filter(spec => !spec.startsWith('!'));
  const forbiddenSpecs = specs.filter(spec => spec.startsWith('!')).map(spec => spec.slice(1));
  if (!evidencePath || requiredSpecs.length + forbiddenSpecs.length === 0) {
    console.error(
      'Usage: check-firebase-function-regions.mjs <functions-list.json> <name@region | !name@region ...>'
    );
    process.exit(2);
  }
  const payload = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const { invalid, missing, lingering } = evaluateFirebaseFunctionRegions(
    payload,
    requiredSpecs,
    forbiddenSpecs
  );
  if (invalid.length > 0) {
    console.error(`[firebase-deploy] Invalid name@region specs: ${invalid.join(', ')}`);
    process.exit(2);
  }
  if (missing.length > 0) {
    console.error(`[firebase-deploy] Missing deployed functions by region: ${missing.join(', ')}`);
  }
  if (lingering.length > 0) {
    console.error(
      `[firebase-deploy] Retired copies still deployed (delete did not take effect): ${lingering.join(', ')}`
    );
  }
  if (missing.length > 0 || lingering.length > 0) process.exit(1);
  console.log(
    `[firebase-deploy] Verified regions: present ${requiredSpecs.join(', ')}; absent ${forbiddenSpecs.join(', ') || '(none)'}`
  );
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
