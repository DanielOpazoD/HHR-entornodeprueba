import type { FirebaseRuntimeConfigDiagnostics } from '@/services/auth/firebaseAuthConfigPolicy';
import {
  createBlockedNotice,
  createDegradedNotice,
  type OperationalNotice,
} from '@/shared/feedback/operationalNoticePolicy';

export type FirebaseStartupWarningCopy = {
  title: string;
  summary: string;
  steps: string[];
  footnote: string;
};

const DEFAULT_WARNING_STEPS = [
  'Revisa en Netlify la variable VITE_FIREBASE_API_KEY (o VITE_FIREBASE_API_KEY_B64).',
  'Si usarás ingreso alternativo, confirma también VITE_FIREBASE_AUTH_DOMAIN.',
  'Vuelve a desplegar el sitio para aplicar los cambios.',
];

export const getFirebaseStartupWarningCopy = (
  diagnostics?: FirebaseRuntimeConfigDiagnostics
): FirebaseStartupWarningCopy => ({
  title: diagnostics?.hasBlockingIssue
    ? 'Configuración de acceso incompleta'
    : 'Configuración de acceso con advertencias',
  summary:
    diagnostics?.summary ||
    'La aplicación no puede iniciarse porque falta parte de la configuración de Firebase.',
  steps:
    diagnostics?.issues.map(issue => `${issue.summary} ${issue.action}`) || DEFAULT_WARNING_STEPS,
  footnote: diagnostics?.hasBlockingIssue
    ? 'Esta validación evita que la app quede cargando indefinidamente cuando la configuración del entorno está incompleta.'
    : 'La app puede seguir funcionando, pero algunas formas de ingreso o recuperación podrían no estar disponibles.',
});

export const getFirebaseStartupFailureMessage = (
  diagnostics?: FirebaseRuntimeConfigDiagnostics
): string =>
  diagnostics?.summary ||
  'No se pudo iniciar la conexión principal del sistema. Revisa la configuración de Firebase del entorno.';

const REQUIRED_FIREBASE_ENV_VARS: ReadonlySet<string> = new Set([
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]);

const extractEnvVarName = (issue: string): string => issue.split(':')[0]?.trim() ?? issue;

/**
 * Build a copy specifically for the "developer started the app without a
 * populated .env file" scenario. The default Firebase startup copy assumes a
 * deployed environment (Netlify variables); locally the actionable steps are
 * different — copy .env.example, restart the dev server. Without this the app
 * either throws silently in DEV or shows an overlay aimed at production.
 */
export const getMissingEnvWarningCopy = (issues: readonly string[]): FirebaseStartupWarningCopy => {
  const missingFirebaseVars = issues
    .map(extractEnvVarName)
    .filter(name => REQUIRED_FIREBASE_ENV_VARS.has(name));

  const uniqueMissing = Array.from(new Set(missingFirebaseVars));
  const missingList =
    uniqueMissing.length > 0
      ? uniqueMissing.join(', ')
      : 'al menos una variable VITE_FIREBASE_* requerida';

  return {
    title: 'Faltan variables de entorno para iniciar',
    summary: `El servidor de desarrollo no encontró las credenciales Firebase del proyecto. Variables faltantes: ${missingList}.`,
    steps: [
      'Copia el archivo de ejemplo: cp .env.example .env.local',
      'Edita .env.local y completa cada VITE_FIREBASE_* con los valores reales del proyecto Firebase.',
      'Reinicia el servidor: detén el proceso (Ctrl+C) y vuelve a ejecutar npm run dev.',
    ],
    footnote:
      'Este aviso solo aparece en desarrollo local. En producción la configuración se carga al runtime desde la función serverless de Netlify.',
  };
};

export const getFirebaseStartupNotice = (
  diagnostics?: FirebaseRuntimeConfigDiagnostics
): OperationalNotice => {
  const copy = getFirebaseStartupWarningCopy(diagnostics);
  if (diagnostics?.hasBlockingIssue) {
    return createBlockedNotice(copy.title, copy.summary);
  }

  return createDegradedNotice(copy.title, copy.summary);
};
