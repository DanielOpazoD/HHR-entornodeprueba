const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } = require('node:fs');
const { resolve, join } = require('node:path');

const root = resolve(__dirname, '../..');
const checkout = process.env.HHR_HANDOFF_EXTENSION_CHECKOUT;
if (!checkout) {
  throw new Error('Indica el checkout de la extensión en HHR_HANDOFF_EXTENSION_CHECKOUT.');
}
const config = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
const portOffset = Number(process.env.HHR_HANDOFF_PORT_OFFSET ?? 0);
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 1000)
  throw new Error('HHR_HANDOFF_PORT_OFFSET debe ser un entero entre 0 y 1000.');
for (const service of ['auth', 'firestore', 'functions']) {
  const emulator = config.emulators[service];
  emulator.host = '127.0.0.1';
  emulator.port += portOffset;
}
config.emulators.ui.enabled = false;
if (portOffset) config.emulators.hub = { host: '127.0.0.1', port: 4400 + portOffset };
const configPath = join(root, '.env.handoff-local-' + randomBytes(8).toString('hex') + '.json');
const interactive = process.argv.includes('--interactive');
const sharedCensus = process.argv.includes('--censo-compartido');
if (sharedCensus && !interactive) throw new Error('--censo-compartido requiere --interactive.');
const output = join(root, 'output');
if (interactive) mkdirSync(output, { recursive: true });
const env = {
  ...process.env,
  HHR_HANDOFF_LOCAL_KEY: randomBytes(32).toString('hex'),
  HHR_HANDOFF_FUNCTIONS_PORT: String(config.emulators.functions.port),
  HHR_HANDOFF_LOCAL_INTERACTIVE: interactive ? '1' : '',
  HHR_HANDOFF_SHARED_CENSUS: sharedCensus ? '1' : '',
  HHR_HANDOFF_EXTENSION_CHECKOUT: resolve(checkout),
  HHR_HANDOFF_LOCAL_UNPACKED: interactive ? mkdtempSync(join(output, 'handoff-local-')) : '',
};
if (sharedCensus) {
  Object.assign(env, {
    VITE_FIREBASE_API_KEY: 'demo-emulator-only',
    VITE_FIREBASE_AUTH_DOMAIN: 'demo-hhr-handoff.firebaseapp.com',
    VITE_FIREBASE_PROJECT_ID: 'demo-hhr-handoff',
    VITE_FIREBASE_STORAGE_BUCKET: 'demo-hhr-handoff.firebasestorage.app',
    VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef123456',
    VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
    VITE_FIREBASE_API_KEY_B64: '',
    VITE_AUTH_EMULATOR_HOST: 'http://127.0.0.1:' + config.emulators.auth.port,
    VITE_FIRESTORE_EMULATOR_HOST: '127.0.0.1:' + config.emulators.firestore.port,
    VITE_FUNCTIONS_EMULATOR_HOST: '127.0.0.1:' + config.emulators.functions.port,
  });
}
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error('El piloto terminó con estado ' + (result.status ?? result.signal));
};
writeFileSync(configPath, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
try {
  run(
    process.execPath,
    ['scripts/build-nursing-handoff-pilot.mjs'],
    env.HHR_HANDOFF_EXTENSION_CHECKOUT
  );
  run(
    join(root, 'node_modules/.bin/firebase'),
    [
      'emulators:exec',
      '--config',
      configPath,
      '--project',
      'demo-hhr-handoff',
      '--only',
      'auth,firestore,functions',
      'node functions/scripts/smokeNursingHandoffExtension.cjs',
    ],
    root
  );
} finally {
  unlinkSync(configPath);
}
