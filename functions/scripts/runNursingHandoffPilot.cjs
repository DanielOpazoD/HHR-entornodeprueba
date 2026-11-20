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
for (const service of ['auth', 'firestore', 'functions'])
  config.emulators[service].host = '127.0.0.1';
config.emulators.ui.enabled = false;
const configPath = join(root, '.env.handoff-local-' + randomBytes(8).toString('hex') + '.json');
const interactive = process.argv.includes('--interactive');
const output = join(root, 'output');
if (interactive) mkdirSync(output, { recursive: true });
const env = {
  ...process.env,
  HHR_HANDOFF_LOCAL_KEY: randomBytes(32).toString('hex'),
  HHR_HANDOFF_LOCAL_INTERACTIVE: interactive ? '1' : '',
  HHR_HANDOFF_EXTENSION_CHECKOUT: resolve(checkout),
  HHR_HANDOFF_LOCAL_UNPACKED: interactive ? mkdtempSync(join(output, 'handoff-local-')) : '',
};
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
