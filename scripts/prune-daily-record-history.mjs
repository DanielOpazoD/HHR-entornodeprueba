#!/usr/bin/env node

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { runDailyRecordHistoryPrune } = require('../functions/lib/pruneDailyRecordHistory');

export const parsePruneHistoryArgs = (args, env = process.env) => {
  let project;
  let apply = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project' && project === undefined) project = args[++index];
    else if (arg === '--apply' && !apply) apply = true;
    else throw new Error('Usage: prune-daily-record-history.mjs --project hhr-pruebas [--apply]');
  }
  if (!project || !/^[a-z][a-z0-9-]+$/.test(project)) {
    throw new Error('An explicit --project hhr-pruebas is required (or an emulator project).');
  }
  if (project !== 'hhr-pruebas' && !env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Only --project hhr-pruebas is allowed outside the Firestore emulator.');
  }
  return { project, apply };
};

export const runPruneHistoryCli = async ({
  args = process.argv.slice(2),
  env = process.env,
  openFirestore = async project => {
    // Resolve the Admin SDK from Functions' declared dependencies, without appContext defaults.
    const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));
    const { initializeApp, applicationDefault, deleteApp } = functionsRequire('firebase-admin/app');
    const { getFirestore } = functionsRequire('firebase-admin/firestore');
    const app = initializeApp(
      { projectId: project, credential: applicationDefault() },
      'history-prune-cli'
    );
    const firestore = getFirestore(app);
    return { firestore, close: () => deleteApp(app) };
  },
  log = counts => console.log(JSON.stringify(counts)),
} = {}) => {
  const { project, apply } = parsePruneHistoryArgs(args, env);
  const { firestore, close } = await openFirestore(project);
  try {
    const counts = await runDailyRecordHistoryPrune({ firestore, apply });
    log({ dryRun: !apply, ...counts });
    return counts;
  } finally {
    await close();
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  runPruneHistoryCli().catch(() => {
    console.error(
      'History prune failed. Use --project hhr-pruebas [--apply]; check ADC or emulator configuration.'
    );
    process.exitCode = 1;
  });
}
