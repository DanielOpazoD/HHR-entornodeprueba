#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const collectDeployedFunctionNames = payload => {
  const endpoints = Array.isArray(payload) ? payload : payload?.result;
  if (!Array.isArray(endpoints)) return new Set();
  return new Set(
    endpoints
      .map(endpoint => (endpoint && typeof endpoint === 'object' ? endpoint.id : null))
      .filter(id => typeof id === 'string' && id.length > 0)
  );
};

export const findMissingFirebaseFunctions = (payload, requiredNames) => {
  const deployed = collectDeployedFunctionNames(payload);
  return requiredNames.filter(required => !deployed.has(required));
};

const main = () => {
  const [, , evidencePath, ...requiredNames] = process.argv;
  if (!evidencePath || requiredNames.length === 0) {
    console.error(
      'Usage: check-deployed-firebase-functions.mjs <functions-list.json> <required-function...>'
    );
    process.exit(2);
  }
  const payload = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  const missing = findMissingFirebaseFunctions(payload, requiredNames);
  if (missing.length > 0) {
    console.error(`[firebase-deploy] Missing deployed functions: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`[firebase-deploy] Verified deployed functions: ${requiredNames.join(', ')}`);
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
