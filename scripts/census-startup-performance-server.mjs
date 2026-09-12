// Deliberately do not read dotenv, credential files, or existing dist output.
const environment = process.argv[2];
if (!['development', 'production'].includes(environment)) throw new Error('Invalid environment');
for (const key of Object.keys(process.env)) {
  if (!['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot'].includes(key))
    delete process.env[key];
}
Object.assign(process.env, {
  NODE_ENV: environment,
  VITE_E2E_MODE: 'true',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_PROJECT_ID: 'demo-census-performance',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-census-performance.invalid',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:synthetic',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-census-performance.invalid',
});
const { createServer, build, preview } = await import('vite');
const common = {
  envDir: false,
  mode: environment,
  build: { outDir: 'node_modules/.cache/census-performance-dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4318, strictPort: true },
  preview: { host: '127.0.0.1', port: 4318, strictPort: true },
};
if (environment === 'production') {
  await build(common);
  await preview(common);
} else {
  const server = await createServer(common);
  await server.listen();
}
