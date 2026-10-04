# HHR Bootstrap & Refresh Performance — Complete Port Playbook

> **Actualización 2026-04-24**: la versión actual incorporó una medición fina
> `[HHR-PERF]` y un fast-path de rehidratación autenticada para F5. La idea no
> es esconder carga con loaders: el objetivo es que el shell autenticado pueda
> aparecer antes cuando ya existe una sesión local válida, manteniendo una
> validación fresca de rol en segundo paso.

> **Audiencia**: otra IA que va a portar las optimizaciones de arranque (login
>
> - F5 autenticado) desde **este repo** (versión de referencia) a una **versión
>   previa menos optimizada** del mismo proyecto.
>
> **Repo de referencia**: este checkout del proyecto HHR tracker
> — todos los paths relativos de este documento son relativos a ese root.
>
> **Este documento es self-contained**: incluye el código fuente completo de
> cada archivo que hay que copiar. No necesitás abrir los archivos del repo
> — están inline acá. Igual, si tenés acceso al repo, úsalo como ground truth.

---

## Tabla de contenidos

- [Parte 0: Metadata](#parte-0-metadata)
- [Parte 1: Contexto del proyecto](#parte-1-contexto-del-proyecto)
- [Parte 2: Arquitectura general del arranque](#parte-2-arquitectura-general-del-arranque)
- [Parte 3: Los dos flujos — explicados paso a paso](#parte-3-los-dos-flujos--explicados-paso-a-paso)
- [Parte 4: Referencia completa de archivos (código fuente inline)](#parte-4-referencia-completa-de-archivos-codigo-fuente-inline)
- [Parte 5: Las 5 optimizaciones implementadas](#parte-5-las-5-optimizaciones-implementadas)
- [Parte 6: Las 2 optimizaciones recomendadas adicionales](#parte-6-las-2-optimizaciones-recomendadas-adicionales)
- [Parte 7: Procedimiento de port paso a paso](#parte-7-procedimiento-de-port-paso-a-paso)
- [Parte 8: Validación y tests](#parte-8-validacion-y-tests)
- [Parte 9: Troubleshooting](#parte-9-troubleshooting)
- [Parte 10: Rollback](#parte-10-rollback)
- [Parte 11: Apéndices](#parte-11-apendices)
- [Parte 12: Caso de estudio — por qué esta versión (base) se siente más lenta que "copia 14"](#parte-12-caso-de-estudio--por-que-esta-version-base-se-siente-mas-lenta-que-copia-14)
- [Parte 13: Medición fina y fast-path de auth cacheado](#parte-13-medición-fina-y-fast-path-de-auth-cacheado)

---

# Parte 0: Metadata

| Campo              | Valor                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------- |
| Repo de referencia | checkout actual del proyecto HHR tracker                                                  |
| Branch             | `main`                                                                                    |
| Commits relevantes | `18d1717b`, `e13b947b`, `c2fdd352`, `3f695379`, `cc09869c`                                |
| Stack              | React 19 + Vite 6 + Firebase 12 + TanStack Query 5 + Tailwind + Dexie (IndexedDB)         |
| Node version       | `.nvmrc` en root                                                                          |
| Objetivo de UX     | 0 flash blanco, chrome correcto desde primer paint, spinner interno solo dentro del shell |
| Modo dev           | `npm run dev` → Vite en puerto configurado (típicamente 3001)                             |
| Modo prod          | `npm run build && npm run preview`                                                        |

## 0.1 Snapshot actual de la mejora de F5 autenticado

### Problema medido

En F5 sobre `/census`, cambiar de fecha dentro del módulo era rápido porque la
app ya estaba montada y solo cambiaba data de censo. El reload completo era más
lento porque repetía bootstrap, import del chunk principal, rehidratación de
Firebase Auth, resolución de rol y recién después montaba el shell autenticado.

El primer reporte útil mostró que `shell -> daily record ready` era bajo
(aprox. 112 ms), mientras que `first render -> auth ready` concentraba la mayor
parte del tiempo percibido. Por eso la optimización se enfocó en auth bootstrap,
no en reescribir el censo.

### Estructura implementada

| Capa                 | Archivo                                               | Responsabilidad                                                                                                                           |
| -------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Medición             | `src/shared/runtime/perfAudit.ts`                     | Registra marcas `[HHR-PERF]`, arma deltas y expone `window.__HHR_BOOTSTRAP_PERF_REPORT__`. En dev está activo; en test queda desactivado. |
| Entrada              | `src/index.tsx`                                       | Marca `bootstrap:start`, import del App y runtime-ready para separar carga Vite/Firebase de React.                                        |
| App                  | `src/App.tsx`                                         | Marca `app:first-render` y `auth:ready`. Permite ver cuánto tarda React en llegar a sesión lista.                                         |
| Shell autenticado    | `src/app-shell/runtime/AuthenticatedAppShell.tsx`     | Marca `auth-shell:mounted`, para separar sesión lista de shell montado.                                                                   |
| Runtime shell        | `src/app-shell/runtime/useAuthenticatedAppRuntime.ts` | Marca puntos de runtime autenticado sin bloquear la navegación.                                                                           |
| Censo                | `src/hooks/useDailyRecordSyncQuery.ts`                | Marca `daily-record:ready` y dispara el reporte final cuando el registro diario está disponible.                                          |
| Bootstrap auth       | `src/hooks/useAuthStateSupport.ts`                    | Marca redirect, current session, observer Firebase, aplicación de sesión y salida de loading.                                             |
| Sesión auth          | `src/services/auth/authSession.ts`                    | Marca espera de runtime, presencia de usuario Firebase, resolución de rol y observer.                                                     |
| Lookup de rol        | `src/services/auth/authRoleLookup.ts`                 | Marca inicio/fin/error de la callable `checkUserRole`.                                                                                    |
| Política de rol      | `src/services/auth/authPolicy.ts`                     | Permite usar rol cacheado solo cuando se pide explícitamente para bootstrap y refresca cache tras lookup dinámico exitoso.                |
| Resolución de acceso | `src/services/auth/authAccessResolution.ts`           | Expone `resolveFirebaseUserRoleForBootstrap`, separado del flujo normal de validación fresca.                                             |

### Contrato de seguridad del fast-path

- El cache de rol se usa solo si `resolveGeneralLoginAccessForEmail(email, { allowCachedRole: true })` lo permite.
- Ese flag solo lo usa `resolveFirebaseUserRoleForBootstrap`, que a su vez solo se conecta al camino de `resolveCurrentAuthSessionState`.
- El observer de Firebase (`onAuthSessionStateChange`) mantiene `resolveFirebaseUserRole`, que vuelve a consultar la política fresca.
- Los caminos de login, observer, escrituras y validaciones de permisos no dependen del cache como fuente definitiva.
- El cache se limpia en `signOut` y se refresca cuando el lookup dinámico devuelve un rol válido.

### Lectura esperada de `[HHR-PERF]`

Campos clave:

- `App chunk/import`: costo de descargar/parsear el módulo principal en dev.
- `first render -> auth ready`: tramo total de rehidratación de sesión.
- `current session resolution`: camino de sesión actual antes del observer.
- `current role resolution`: costo específico de resolver rol durante bootstrap.
- `role callable lookup`: costo de la callable `checkUserRole` cuando no entra cache.
- `observer role resolution`: validación fresca del observer Firebase.
- `shell -> daily record ready`: costo real de data inicial del censo una vez montado el shell.

Si el fast-path entra, el tramo `current role resolution` debería bajar porque
lee IndexedDB/local cache en vez de esperar la callable. La callable puede
aparecer después en `observer role resolution`; eso es deseable porque mantiene
la validación fresca sin bloquear el primer shell autenticado.

### Tests que cubren esta estructura

Tests nuevos o directamente relacionados:

- `src/tests/services/auth/authPolicy.test.ts`
  - Verifica que `allowCachedRole: true` usa cache como fast-path.
  - Verifica que el flujo por defecto no usa cache y refresca cache tras lookup dinámico exitoso.
- `src/tests/services/auth/authAccessResolution.test.ts`
  - Verifica que `resolveFirebaseUserRoleForBootstrap` es el único camino que pasa `{ allowCachedRole: true }`.
- `src/tests/services/auth/authSession.test.ts`
  - Verifica que la resolución actual de sesión puede usar el seam de bootstrap y que el observer sigue emitiendo sesión autorizada.

Comandos de validación usados para este cambio:

```bash
npm run typecheck
npm run lint
npx vitest run \
  src/tests/hooks/useAuthStateSupport.sessionResolution.test.tsx \
  src/tests/hooks/useAuthStateSupport.timeout.test.tsx \
  src/tests/hooks/useAuthState.test.ts \
  src/tests/services/auth/authPolicy.test.ts \
  src/tests/services/auth/authAccessResolution.test.ts \
  src/tests/services/auth/authSession.test.ts \
  src/tests/services/auth/authRoleLookup.test.ts \
  src/tests/components/index.bootstrap.test.tsx \
  src/tests/components/AppLoadingBehavior.test.tsx \
  src/tests/app-shell/BootstrapRouteChrome.test.tsx \
  src/tests/app-shell/appShellLoadingPolicy.test.ts \
  src/tests/hooks/useDailyRecord.lifecycle.test.tsx \
  src/tests/hooks/useDailyRecord.validation-guards.test.tsx
```

---

# Parte 1: Contexto del proyecto

**HHR (Hospital Hanga Roa) Tracker** es una app clínica para el Hospital Hanga
Roa en Rapa Nui, Chile. Administra censos diarios de hospitalizados, entregas
de turno de enfermería y médicas, traslados, CUDYR, auditoría, etc. Cada
"módulo" es una vista autenticada con un path propio.

### Módulos y sus paths

Definido en `src/hooks/controllers/appStateNavigationController.ts`
(`MODULE_PATH_SEGMENTS`):

| Módulo (`ModuleType`)     | Path segment           | URL ejemplo                        |
| ------------------------- | ---------------------- | ---------------------------------- |
| `CENSUS`                  | `census`               | `/census?date=2026-02-20`          |
| `ANALYTICS`               | `statistics`           | `/statistics`                      |
| `CUDYR`                   | `cudyr`                | `/cudyr`                           |
| `NURSING_HANDOFF`         | `nursing-handoff`      | `/nursing-handoff?date=2026-02-20` |
| `MEDICAL_HANDOFF`         | `medical-handoff`      | `/medical-handoff?date=2026-02-20` |
| `AUDIT`                   | `audit`                | `/audit`                           |
| `WHATSAPP`                | `whatsapp`             | `/whatsapp`                        |
| `TRANSFER_MANAGEMENT`     | `transfer-management`  | `/transfer-management`             |
| `BACKUP_FILES`            | `backup-files`         | `/backup-files`                    |
| `PATIENT_MASTER_INDEX`    | `patient-master-index` | `/patient-master-index`            |
| `DATA_MAINTENANCE`        | `data-maintenance`     | `/data-maintenance`                |
| `DIAGNOSTICS`             | `diagnostics`          | `/diagnostics`                     |
| `FUNCTIONS_TELEMETRY`     | `functions-telemetry`  | `/functions-telemetry`             |
| `CONFIGURATION`           | `configuration`        | `/configuration`                   |
| `DATA`                    | `data`                 | `/data`                            |
| `COMMUNICATIONS`          | `communications`       | `/communications`                  |
| `ROLE_MANAGEMENT`         | `role-management`      | `/role-management`                 |
| `REMINDERS`               | `reminders`            | `/reminders`                       |
| `ERRORS`                  | `errors`               | `/errors`                          |
| (default unauthenticated) | `''` ó `login`         | `/` ó `/login`                     |

### Persistencia

- **Firebase Auth**: sesión persistida en `localStorage` bajo claves
  `firebase:authUser:*`.
- **Session hint**: `sessionStorage.hhr_logged_this_session = 'true'` cuando
  hay sesión activa en la tab. Se borra en logout.
- **IndexedDB (Dexie)**: cache local de `DailyRecord` por fecha, respaldos,
  cola de sync.
- **Firestore**: source of truth remota.

### Invariantes de arranque (UX contract)

1. **Never** un fondo blanco después del parse del HTML. El `<html>` pinta su
   propio color desde inline CSS antes de que cargue nada externo.
2. **Never** un spinner fullscreen legacy. El `InitialLoadingScreen` existe
   como archivo pero `shouldRenderInitialLoadingScreen` retorna `false` siempre.
3. **Never** el login page sin su fondo ocean/night — ni durante el bootstrap
   ni durante la primera render de React.
4. **Always** el chrome (navbar + date-strip) visible antes que la vista. Si
   React todavía no montó, al menos el fondo inline los simula con gradients.
5. **Always** el spinner de "carga de datos" **dentro** del content slot del
   shell (`ViewLoader`), respetando las bandas superiores.

---

# Parte 2: Arquitectura general del arranque

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser: F5                                                        │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  index.html                                                         │
│  ─────────                                                          │
│  1. <html> con style="background-color: #eef4f8"                    │
│  2. Inline <script> sincrónico (CAPA 1)                             │
│     • Lee hints de auth en storage                                  │
│     • Pinta fondo correcto (login ocean o app chrome gradient)      │
│     • Inyecta <link rel="modulepreload"> para /src/App.tsx          │
│     • Si hay hint + ruta módulo: también preload census chunk       │
│  3. <style> base: bg transparent en body/root                       │
│  4. <link rel="stylesheet" href="/src/index.css"> (Tailwind)        │
│  5. <script type="module" src="/src/index.tsx">                     │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/index.tsx (CAPA 2)                                             │
│  ─────────────                                                      │
│  1. createRoot(document.getElementById('root'))                     │
│  2. resolvePreMountLoadingScreenDecision({ pathname })              │
│     → { shouldRender: false, renderBootstrapRouteChrome: bool }     │
│  3. Si renderBootstrapRouteChrome:                                  │
│     • preloadAuthenticatedRouteChunk({ pathname })   ← fire-and-go  │
│     • root.render(<BootstrapRouteChrome/>)                          │
│  4. const appModulePromise = import('@/App')  ← PARALELO con runtime│
│  5. await bootstrapAppRuntime()  ← Firebase + recovery              │
│     → ok | blocked | reload                                         │
│  6. await appModulePromise → root.render(<App/>)                    │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/App.tsx (CAPA 3)                                               │
│  ─────────────                                                      │
│  • useAppBootstrapState() → { status, phase, auth, dateNav? }       │
│  • switch(status):                                                  │
│     ├─ signature_mode → <MedicalSignatureView/>                     │
│     ├─ loading        → resolveRuntimeLoadingScreenMode(…)          │
│     │                   ├─ 'bootstrap-route-chrome' → reuse skeleton│
│     │                   ├─ 'silent' → return null                   │
│     │                   └─ 'login-shell' / 'default' → legacy       │
│     ├─ unauthenticated → <LoginPage/>                               │
│     └─ authenticated   → <VersionedAppShell>                        │
│                            <AuthenticatedAppShell/>                 │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  AuthenticatedAppShell (CAPA 4)                                     │
│  ──────────────────────                                             │
│  • useAuthenticatedAppRuntime({ auth, dateNav }):                   │
│     ├─ useDailyRecord()         ← SHARED (census, handoff, traslados)│
│     ├─ useExistingDaysQuery()   ← CENSUS-ONLY (gate pendiente)      │
│     ├─ useCensusEmail()         ← CENSUS-ONLY (gate pendiente)      │
│     ├─ useFileOperations()      ← idle en mount                     │
│     └─ useAppState()            ← módulo actual + UI state          │
│  • <CensusProvider value={censusContextValue}>                      │
│     <DeferredSystemHealthReporter/>                                 │
│     <AppContent ui renderFeatureQuickActions/>                      │
│       ├─ <AppContentChrome>                                         │
│       │    ├─ <Navbar/>                                             │
│       │    ├─ <DateStrip/>                                          │
│       │    └─ <AppRouter currentModule>                             │
│       │         └─ <Suspense fallback={<ViewLoader/>}>              │
│       │              └─ <LazyXxxView/>                              │
│       └─ <AppContentOverlays/> (modales)                            │
└─────────────────────────────────────────────────────────────────────┘
```

### Providers globales (desde `ProvidedApp`)

En `src/App.tsx`:

```tsx
export default function ProvidedApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DefaultRepositoryProvider>
          <HospitalProvider>
            <UIProvider>
              <AuditProvider userId="anon">
                <AppWithErrorBoundary /> {/* ← GlobalErrorBoundary → App */}
              </AuditProvider>
            </UIProvider>
          </HospitalProvider>
        </DefaultRepositoryProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

**Orden NO modificable** sin investigación:

- `QueryClientProvider` debe envolver todo porque todos los hooks de data usan
  `useQuery`.
- `AuthProvider` antes que `DefaultRepositoryProvider` porque el repo necesita
  el user para decidir si sincroniza con Firestore.
- `HospitalProvider`/`UIProvider` son metadata puro, pueden moverse con cuidado.
- `AuditProvider` envuelve para que cualquier error tenga contexto de auditoría.

---

# Parte 3: Los dos flujos — explicados paso a paso

## 3.1 Flujo A: **Login sin sesión previa** (primera visita o F5 en `/` sin hints)

### Secuencia

| T (ms) | Evento                                                                                                                   | Responsable                |
| ------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 0      | F5 llega al browser                                                                                                      | —                          |
| ~3     | HTML parseado hasta `<script>` inline                                                                                    | browser                    |
| ~5     | Inline script ejecuta: no hay `firebase:authUser:*` ni `hhr_logged_this_session`                                         | `index.html`               |
| ~6     | `dataset.prebootSurface = 'login'`                                                                                       | `index.html`               |
| ~7     | `documentElement.style.background*` = LOGIN_SURFACE (ocean + gradient slate-950)                                         | `index.html`               |
| ~8     | `appendModulePreload('/src/App.tsx')` → `<link rel="modulepreload">` agregado                                            | `index.html`               |
| ~10    | HTML termina de parsear                                                                                                  | browser                    |
| ~10    | **PRIMER PAINT** — fondo ocean visible                                                                                   | browser                    |
| ~30    | `/src/index.tsx` empieza a ejecutar                                                                                      | Vite                       |
| ~40    | `resolvePreMountLoadingScreenDecision` → `{ shouldRender: false, renderBootstrapRouteChrome: false }` porque no hay hint | `appShellLoadingPolicy.ts` |
| ~40    | (no se rendera nada de React — el fondo ocean sigue visible)                                                             | —                          |
| ~40    | `const appModulePromise = import('@/App')` kickeado                                                                      | `index.tsx`                |
| ~40    | `bootstrapAppRuntime()` kickeado                                                                                         | `index.tsx`                |
| ~60    | `bootstrapAppRuntime` resuelve: `result.status = 'ok'` (Firebase init, no hay persistencia que recuperar)                | Firebase                   |
| ~350   | `appModulePromise` resuelve (App chunk descargado + parseado)                                                            | Vite dev                   |
| ~360   | `root.render(<App/>)`                                                                                                    | `index.tsx`                |
| ~380   | `<App>` monta → `useAppBootstrapState()` → status inicial = `'loading'` o `'unauthenticated'`                            | `App.tsx`                  |
| ~390   | Si `loading`: `resolveRuntimeLoadingScreenMode` → `'silent'` para ruta `/` → `return null`                               | `App.tsx`                  |
| ~400   | Firebase Auth emite "no user" → `auth.sessionState.status = 'unauthenticated'`                                           | `AuthProvider`             |
| ~410   | `useAppBootstrapState` → `status = 'unauthenticated'`                                                                    | `useAppBootstrapState`     |
| ~420   | `<App>` retorna `<LoginPage onLoginSuccess={...} />`                                                                     | `App.tsx`                  |
| ~430   | `<LoginPage>` monta con su fondo ocean (cross-fade con el inline)                                                        | `LoginPage.tsx`            |
| —      | Usuario click "Ingresar con Google" → popup → `onLoginSuccess` → redirect o internal state change → transición a flujo B | —                          |

### Narrativa

El usuario ve el fondo ocean del login **desde el primer frame del browser**
(~10 ms). Luego React toma control (~360 ms) y monta `LoginPage` sobre el
mismo fondo, sin discontinuidad visual. **Zero flash blanco**. **Zero spinner
fullscreen**.

## 3.2 Flujo B: **F5 autenticado en un módulo** (ej. `/nursing-handoff?date=2026-02-20`)

### Secuencia

| T (ms)    | Evento                                                                                                      | Responsable                  |
| --------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 0         | F5 llega al browser                                                                                         | —                            |
| ~3        | HTML parseado hasta `<script>` inline                                                                       | browser                      |
| ~5        | Inline script ejecuta: encuentra `firebase:authUser:abc123` en localStorage                                 | `index.html`                 |
| ~6        | `dataset.prebootSurface = 'app'`                                                                            | `index.html`                 |
| ~7        | `documentElement.style.background*` = APP_SURFACE (gradient azul 56px + blanca 44px + body gris)            | `index.html`                 |
| ~8        | `appendModulePreload('/src/App.tsx')`                                                                       | `index.html`                 |
| ~9        | `appendModulePreload('/src/features/census/public-components.ts')` (solo si ruta es census)                 | `index.html`                 |
| ~10       | **PRIMER PAINT** — bandas del chrome visibles                                                               | browser                      |
| ~30       | `/src/index.tsx` empieza                                                                                    | Vite                         |
| ~40       | `resolvePreMountLoadingScreenDecision` → `{ shouldRender: false, renderBootstrapRouteChrome: true }`        | `appShellLoadingPolicy.ts`   |
| ~40       | `preloadAuthenticatedRouteChunk({ pathname })` kickeado (CENSUS only)                                       | `index.tsx`                  |
| ~45       | `root.render(<BootstrapRouteChrome/>)`                                                                      | `index.tsx`                  |
| ~45       | `const appModulePromise = import('@/App')` kickeado (paralelo con bootstrap)                                | `index.tsx`                  |
| ~45       | `bootstrapAppRuntime()` kickeado (paralelo con App import)                                                  | `index.tsx`                  |
| ~120      | **PRIMER PAINT DE REACT** — Navbar real + DateStrip real + ViewLoader visibles (skeleton)                   | React                        |
| ~200      | `bootstrapAppRuntime` resuelve: Firebase inicializó, recuperación OK                                        | Firebase                     |
| ~350      | `appModulePromise` resuelve                                                                                 | Vite dev                     |
| ~360      | `root.render(<App/>)`                                                                                       | `index.tsx`                  |
| ~370      | `<App>` monta → `useAppBootstrapState()` → `loading` phase = `rehydrating`                                  | `App.tsx`                    |
| ~375      | `resolveRuntimeLoadingScreenMode` → `'bootstrap-route-chrome'` → retorna `<BootstrapRouteChrome/>` otra vez | `App.tsx`                    |
| ~380      | React reconcilia — skeleton sigue visible, no hay re-paint visible                                          | React                        |
| ~450      | Firebase Auth emite `user = {...}` → `auth.isAuthenticated = true`                                          | `AuthProvider`               |
| ~455      | `useAppBootstrapState` → `status = 'authenticated'`                                                         | —                            |
| ~460      | `<App>` retorna `<AuthenticatedAppShell/>`                                                                  | `App.tsx`                    |
| ~465      | `useAuthenticatedAppRuntime()`: dispara 4 hooks (dailyRecord, existingDays, censusEmail, fileOps)           | `useAuthenticatedAppRuntime` |
| ~470      | Chrome real monta, React reconcilia con el skeleton (transición invisible si email coincide)                | React                        |
| ~500      | `useExistingDaysQuery` resuelve desde IDB (range scan)                                                      | Dexie                        |
| ~550      | `useDailyRecord` resuelve desde IDB (cache hit) O dispara Firestore                                         | Dexie / Firestore            |
| ~700–1200 | `dailyRecord` llega desde Firestore (onSnapshot inicial) si no había cache                                  | Firestore                    |
| ~1200     | Vista del módulo monta con datos completos — spinner interno desaparece                                     | `AppRouter` + vista          |

### Narrativa

Usuario ve las bandas del chrome **desde el primer frame** (~10 ms), luego el
Navbar + DateStrip reales como skeleton (~120 ms), luego chrome real con datos
(~1200 ms en frío). El único período de "esperando data" dura ~700 ms entre
`auth-shell:mounted` y `daily-record:ready`, durante el cual el spinner interno
se ve dentro del content slot (no fullscreen).

---

# Parte 4: Referencia completa de archivos (código fuente inline)

Esta sección tiene el código **completo** de cada archivo crítico. Copiá
directamente a la versión previa ajustando imports y paths.

## 4.1 `index.html`

Ubicación: root del repo.

```html
<!DOCTYPE html>
<html lang="es" style="background-color: #eef4f8;">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>HHR Hospital Tracker</title>
    <script>
      (function () {
        var FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
        var AUTHENTICATED_SESSION_HINT_KEY = 'hhr_logged_this_session';
        // Startup UX contract:
        // - login: no spinner nuevo ni flash blanco; conservar solo el fondo/login real
        // - refresh autenticado en modulos: mostrar el mismo chrome real del
        //   modulo origen desde React bootstrap, no una recreacion en index.html
        // - no reintroducir loaders/skeletons/spinners full-screen en esta capa
        var LOGIN_SURFACE_BACKGROUND = {
          color: '#020617',
          image: [
            'linear-gradient(115deg, rgba(15, 23, 42, 0.82) 0%, rgba(15, 23, 42, 0.62) 36%, rgba(15, 23, 42, 0.28) 64%, rgba(255, 255, 255, 0.08) 100%)',
            'radial-gradient(circle at top left, rgba(255, 255, 255, 0.18), transparent 32%)',
            "url('/images/login/hhr-login-day.png')",
          ].join(','),
          position: 'center, center, center',
          repeat: 'no-repeat, no-repeat, no-repeat',
          size: 'cover, cover, contain',
        };
        var APP_SURFACE_BACKGROUND = {
          color: '#eef4f8',
          image: [
            'linear-gradient(90deg, #0c4a6e 0%, #0369a1 50%, #0c4a6e 100%)',
            'linear-gradient(180deg, #ffffff 0%, #ffffff 100%)',
            'linear-gradient(180deg, #eef4f8 0%, #e8eef5 100%)',
          ].join(','),
          position: 'top left, left 56px, left 100px',
          repeat: 'no-repeat, no-repeat, no-repeat',
          size: '100% 56px, 100% 44px, 100% calc(100vh - 100px)',
        };
        var appendModulePreload = function (href) {
          if (
            !document.head ||
            document.head.querySelector('link[rel="modulepreload"][href="' + href + '"]')
          ) {
            return;
          }

          var link = document.createElement('link');
          link.rel = 'modulepreload';
          link.href = href;
          document.head.appendChild(link);
        };
        var normalizedPath = window.location.pathname.replace(/^\/+|\/+$/g, '');
        var isLoginSurfacePath = normalizedPath === '' || normalizedPath === 'login';

        var storageContainsPrefix = function (storage, prefix) {
          try {
            for (var index = 0; index < storage.length; index += 1) {
              var key = storage.key(index);
              if (key && key.indexOf(prefix) === 0) {
                return true;
              }
            }
          } catch (error) {
            return false;
          }

          return false;
        };
        var applyPrebootSurfaceBackground = function (surfaceBackground) {
          var rootStyle = document.documentElement.style;
          rootStyle.backgroundColor = surfaceBackground.color;
          rootStyle.backgroundImage = surfaceBackground.image;
          rootStyle.backgroundPosition = surfaceBackground.position;
          rootStyle.backgroundRepeat = surfaceBackground.repeat;
          rootStyle.backgroundSize = surfaceBackground.size;
        };

        var hasPersistedFirebaseAuthHint = false;
        var hasRecentAuthenticatedSessionHint = false;

        try {
          hasPersistedFirebaseAuthHint =
            storageContainsPrefix(window.localStorage, FIREBASE_AUTH_STORAGE_PREFIX) ||
            storageContainsPrefix(window.sessionStorage, FIREBASE_AUTH_STORAGE_PREFIX);
          hasRecentAuthenticatedSessionHint =
            window.sessionStorage.getItem(AUTHENTICATED_SESSION_HINT_KEY) === 'true';
        } catch (error) {
          hasPersistedFirebaseAuthHint = false;
          hasRecentAuthenticatedSessionHint = false;
        }

        var hasAnySessionHint = hasPersistedFirebaseAuthHint || hasRecentAuthenticatedSessionHint;
        var shouldUseLoginSurface =
          normalizedPath === 'login' ||
          (isLoginSurfacePath && !hasAnySessionHint) ||
          !hasAnySessionHint;

        appendModulePreload('/src/App.tsx');
        if (!shouldUseLoginSurface) {
          appendModulePreload('/src/features/census/public-components.ts');
        }

        document.documentElement.dataset.prebootSurface = shouldUseLoginSurface ? 'login' : 'app';
        applyPrebootSurfaceBackground(
          shouldUseLoginSurface ? LOGIN_SURFACE_BACKGROUND : APP_SURFACE_BACKGROUND
        );
      })();
    </script>
    <style>
      html,
      body,
      #root {
        min-height: 100vh;
      }

      body {
        margin: 0;
        background: transparent;
        color: #0f172a;
      }

      #root {
        background: transparent;
      }

      html[data-preboot-surface='login'] body,
      html[data-preboot-surface='login'] #root {
        background: transparent;
      }

      html[data-preboot-surface='app'] body,
      html[data-preboot-surface='app'] #root {
        background: transparent;
      }
    </style>
    <!-- PWA -->
    <meta name="theme-color" content="#0284c7" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="HHR" />
    <link rel="icon" type="image/svg+xml" href="/images/logos/logo_HHR.svg" />
    <link rel="shortcut icon" href="/images/logos/logo_HHR.svg" />
    <link rel="apple-touch-icon" href="/images/icon-192.png" />

    <link rel="stylesheet" href="/src/index.css" />
  </head>

  <body class="text-slate-900" style="background: transparent;">
    <div id="root"></div>
    <script type="module" src="/src/index.tsx"></script>
  </body>
</html>
```

**Puntos clave**:

- `<html style="background-color: #eef4f8;">` → fallback si el script falla.
- Script inline **antes** del `<link rel="stylesheet">` (importante: así no
  bloquea el parse esperando Tailwind).
- `appendModulePreload` solo inyecta si no existe ya, idempotente.
- `storageContainsPrefix` usa `try/catch` para tolerar private browsing.
- El `<body>` y `#root` quedan transparentes para dejar ver el background del
  `<html>`.

## 4.2 `src/index.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { bootstrapAppRuntime } from '@/app-shell/bootstrap/bootstrapAppRuntime';
import {
  installBootstrapRuntimeErrorListeners,
  recordBootstrapRuntimeError,
  recordBootstrapRuntimeResult,
} from '@/app-shell/bootstrap/bootstrapRuntimeTelemetry';
import {
  getFirebaseStartupFailureMessage,
  type FirebaseStartupWarningCopy,
} from '@/services/auth/firebaseStartupUiPolicy';
import { InitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';
import { BootstrapRouteChrome } from '@/app-shell/bootstrap/BootstrapCensusChrome';
import { resolvePreMountLoadingScreenDecision } from '@/app-shell/bootstrap/appShellLoadingPolicy';
import { preloadAuthenticatedRouteChunk } from '@/app-shell/bootstrap/authenticatedRoutePreloadController';
import { mountFirebaseConfigWarning } from '@/services/firebase-runtime/firebaseStartupDiagnostics';
import { createScopedLogger } from '@/services/utils/loggerScope';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
const bootLogger = createScopedLogger('Bootstrap');
const detachBootstrapRuntimeErrorListeners =
  typeof window !== 'undefined' ? installBootstrapRuntimeErrorListeners() : () => {};
const APP_SHELL_LOAD_WARNING_COPY: FirebaseStartupWarningCopy = {
  title: 'No se pudo completar el arranque',
  summary:
    'La app no logró cargar una parte crítica de la interfaz después de preparar el runtime inicial.',
  steps: [
    'Recarga la página para forzar la descarga del bundle actualizado.',
    'Si el problema persiste, limpia la caché del sitio y vuelve a intentar.',
    'Si falla en varios navegadores, revisa primero el smoke de preview y los chunks críticos del build.',
  ],
  footnote:
    'Este aviso apunta al bundle de interfaz o a la caché del navegador, no a una falta confirmada de variables Firebase.',
};

const isAppShellLoadFailure = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
  return /chunkloaderror|failed to fetch dynamically imported module|cannot access '.+' before initialization/i.test(
    message
  );
};

const renderBootstrapLoadingScreen = () => {
  const loadingScreenDecision = resolvePreMountLoadingScreenDecision({
    pathname: window.location.pathname,
  });

  if (loadingScreenDecision.renderBootstrapRouteChrome) {
    void preloadAuthenticatedRouteChunk({ pathname: window.location.pathname });
  }

  if (loadingScreenDecision.renderBootstrapRouteChrome) {
    root.render(
      <React.StrictMode>
        <BootstrapRouteChrome />
      </React.StrictMode>
    );
    return;
  }

  if (!loadingScreenDecision.shouldRender) {
    return;
  }

  root.render(
    <React.StrictMode>
      <InitialLoadingScreen
        pathname={window.location.pathname}
        preferLoginShell={loadingScreenDecision.preferLoginShell}
      />
    </React.StrictMode>
  );
};

const renderApp = async () => {
  bootLogger.info('Rendering application');
  const { default: App } = await appModulePromise;
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

renderBootstrapLoadingScreen();

// Fetch the main app shell while bootstrap recovery/Firebase runtime settles so
// the login page is not blocked behind a second sequential chunk load.
const appModulePromise = import('@/App');

bootstrapAppRuntime()
  .then(async result => {
    recordBootstrapRuntimeResult(result);

    if (result.status === 'reload') {
      return;
    }

    if (result.status === 'blocked') {
      mountFirebaseConfigWarning(result.message, result.warningCopy);
      return;
    }

    await renderApp();
  })
  .catch(error => {
    recordBootstrapRuntimeError(error);
    bootLogger.error('Firebase initialization failed', error);
    if (isAppShellLoadFailure(error)) {
      mountFirebaseConfigWarning(
        'No se pudo cargar una parte crítica de la interfaz.',
        APP_SHELL_LOAD_WARNING_COPY
      );
      return;
    }

    mountFirebaseConfigWarning(getFirebaseStartupFailureMessage());
  })
  .finally(() => {
    // Keep the listeners active only through bootstrap to avoid mixing startup
    // incidents with later domain/runtime errors already captured elsewhere.
    detachBootstrapRuntimeErrorListeners();
  });
```

**Puntos clave**:

- `appModulePromise = import('@/App')` está declarado **después** de
  `renderBootstrapLoadingScreen()`, pero **antes** de `bootstrapAppRuntime()`.
  El orden importa: quiere que el skeleton se pinte antes de pedir el chunk, y
  el chunk download solape con la latencia de Firebase.
- `void preloadAuthenticatedRouteChunk` con `void` descarta la promise (no
  bloquea).
- `isAppShellLoadFailure` detecta `ChunkLoadError` para mostrar mensaje
  específico de "bundle desincronizado".

## 4.3 `src/App.tsx`

```tsx
/**
 * App.tsx - Main Application Component
 *
 * Coordinates bootstrap state, authenticated runtime wiring, and global providers.
 */

import React from 'react';
import { LoginPage } from '@/features/auth/public';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import { VersionProvider } from '@/context/VersionContext';
import { VersionMismatchOverlay } from '@/components/shared/VersionMismatchOverlay';
import { InitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';
import { ViewLoader } from '@/components/ui/ViewLoader';
import { BootstrapRouteChrome } from '@/app-shell/bootstrap/BootstrapCensusChrome';
import { MedicalSignatureView } from '@/views/LazyViews';
import { AuthenticatedAppShell } from '@/app-shell/runtime/AuthenticatedAppShell';
import { resolveRuntimeLoadingScreenMode } from '@/app-shell/bootstrap/appShellLoadingPolicy';
import { AuditProvider, AuthProvider, UIProvider } from './context';
import { HospitalProvider } from './context/HospitalContext';
import { DefaultRepositoryProvider } from '@/services/RepositoryContext';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/config/queryClient';
import { useAppBootstrapState } from '@/app-shell/bootstrap/useAppBootstrapState';

const VersionedAppShell = ({ children }: { children: React.ReactNode }) => (
  <VersionProvider>
    <VersionMismatchOverlay />
    {children}
  </VersionProvider>
);

function App() {
  const bootstrapState = useAppBootstrapState();
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const loadingScreenMode =
    bootstrapState.status === 'loading'
      ? resolveRuntimeLoadingScreenMode({
          pathname,
          bootstrapState,
        })
      : null;

  if (bootstrapState.status === 'signature_mode') {
    return (
      <VersionedAppShell>
        <React.Suspense fallback={<ViewLoader />}>
          <MedicalSignatureView />
        </React.Suspense>
      </VersionedAppShell>
    );
  }

  if (bootstrapState.status === 'loading') {
    if (loadingScreenMode === 'bootstrap-route-chrome') {
      return <BootstrapRouteChrome />;
    }

    if (loadingScreenMode === 'silent') {
      return null;
    }

    return (
      <InitialLoadingScreen
        pathname={pathname}
        preferLoginShell={loadingScreenMode === 'login-shell'}
      />
    );
  }

  if (bootstrapState.status === 'unauthenticated') {
    return <LoginPage onLoginSuccess={() => {}} />;
  }

  return (
    <VersionedAppShell>
      <AuthenticatedAppShell auth={bootstrapState.auth} dateNav={bootstrapState.dateNav} />
    </VersionedAppShell>
  );
}

const AppWithErrorBoundary = () => {
  return (
    <GlobalErrorBoundary>
      <App />
    </GlobalErrorBoundary>
  );
};

export default function ProvidedApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DefaultRepositoryProvider>
          <HospitalProvider>
            <UIProvider>
              <AuditProvider userId="anon">
                <AppWithErrorBoundary />
              </AuditProvider>
            </UIProvider>
          </HospitalProvider>
        </DefaultRepositoryProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

## 4.4 `src/app-shell/bootstrap/appShellLoadingPolicy.ts`

```ts
import type { AppBootstrapState } from '@/app-shell/bootstrap/useAppBootstrapState';
import { shouldRenderInitialLoadingScreen } from '@/components/ui/InitialLoadingScreen';
import { hasActiveFirebaseSession } from '@/services/auth/authFallback';
import {
  hasPersistedFirebaseAuthHint,
  hasRecentAuthenticatedSessionHint,
} from '@/services/auth/authStorageHints';
import { resolveModuleFromPathname } from '@/hooks/controllers/appStateNavigationController';

export type AppShellLoadingScreenMode =
  | 'silent'
  | 'default'
  | 'login-shell'
  | 'bootstrap-route-chrome';

export interface PreMountLoadingScreenDecision {
  shouldRender: boolean;
  preferLoginShell: boolean;
  renderBootstrapRouteChrome: boolean;
}

export const resolvePreMountLoadingScreenDecision = ({
  pathname,
  hasRecentAuthenticatedSessionHint: providedRecentAuthenticatedSessionHint,
  hasPersistedFirebaseAuthHint: providedPersistedFirebaseAuthHint,
  hasActiveFirebaseSession: providedActiveFirebaseSession,
}: {
  pathname: string | undefined;
  hasRecentAuthenticatedSessionHint?: boolean;
  hasPersistedFirebaseAuthHint?: boolean;
  hasActiveFirebaseSession?: boolean;
}): PreMountLoadingScreenDecision => {
  const recentAuthenticatedSessionHint =
    providedRecentAuthenticatedSessionHint ?? hasRecentAuthenticatedSessionHint();
  const persistedFirebaseAuthHint =
    providedPersistedFirebaseAuthHint ?? hasPersistedFirebaseAuthHint();
  const activeFirebaseSession = providedActiveFirebaseSession ?? hasActiveFirebaseSession();
  const hasAuthenticatedSessionHint =
    recentAuthenticatedSessionHint || persistedFirebaseAuthHint || activeFirebaseSession;

  return {
    shouldRender: false,
    preferLoginShell: false,
    renderBootstrapRouteChrome:
      resolveModuleFromPathname(pathname) !== null && hasAuthenticatedSessionHint,
  };
};

export const resolveRuntimeLoadingScreenMode = ({
  pathname,
  bootstrapState,
}: {
  pathname: string | undefined;
  bootstrapState: Extract<AppBootstrapState, { status: 'loading' }>;
}): AppShellLoadingScreenMode => {
  const normalizedPath = (pathname ?? '/').replace(/^\/+|\/+$/g, '');
  const routeModule = resolveModuleFromPathname(pathname);
  if (
    routeModule !== null &&
    (bootstrapState.phase === 'rehydrating' || normalizedPath.length > 0)
  ) {
    return 'bootstrap-route-chrome';
  }

  if (!shouldRenderInitialLoadingScreen(pathname)) {
    return 'silent';
  }

  return 'silent';
};
```

**Puntos clave**:

- `shouldRender: false` fijo: el `InitialLoadingScreen` legacy **nunca** se
  rendera pre-React.
- `renderBootstrapRouteChrome: true` solo si:
  - La ruta mapea a un módulo conocido (`resolveModuleFromPathname`)
  - Y hay algún hint de auth (recent, persisted, o active Firebase session)
- `resolveRuntimeLoadingScreenMode` puede devolver `'bootstrap-route-chrome'`
  durante el loading phase de React para mantener el skeleton mientras
  Firebase termina de hidratar.

## 4.5 `src/app-shell/bootstrap/BootstrapCensusChrome.tsx` (contiene `BootstrapRouteChrome`)

```tsx
import React from 'react';
import { DateStrip } from '@/components/layout/DateStrip';
import { Navbar } from '@/components/layout/Navbar';
import { ViewLoader } from '@/components/ui/ViewLoader';
import { AuthContext, type AuthContextType, type UserRole } from '@/context/AuthContext';
import type { ModuleType } from '@/constants/navigationConfig';
import {
  resolveModuleFromPathname,
  shouldShowPrintButtonForModule,
} from '@/hooks/controllers/appStateNavigationController';
import { shouldRenderDateStrip } from '@/components/layout/app-content/appContentVisibilityController';

const FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
const DEFAULT_BOOTSTRAP_ROLE: UserRole = 'admin';

const noop = () => {};
const noopAsync = async () => {};
const noopSetNumber: React.Dispatch<React.SetStateAction<number>> = () => {};
const noopImportJson: React.ChangeEventHandler<HTMLInputElement> = () => {};
const BOOTSTRAP_CENSUS_VIEW_MODE = 'REGISTER' as const;

const normalizeStorageUser = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const user = value as {
    uid?: unknown;
    email?: unknown;
    displayName?: unknown;
  };

  if (typeof user.uid !== 'string' || user.uid.trim().length === 0) {
    return null;
  }

  return {
    uid: user.uid,
    email: typeof user.email === 'string' ? user.email : null,
    displayName: typeof user.displayName === 'string' ? user.displayName : null,
  };
};

const readPersistedFirebaseAuthUser = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const storages = [window.localStorage, window.sessionStorage];

  for (const storage of storages) {
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(FIREBASE_AUTH_STORAGE_PREFIX)) {
          continue;
        }

        const parsed = normalizeStorageUser(JSON.parse(storage.getItem(key) ?? 'null'));
        if (parsed) {
          return parsed;
        }
      }
    } catch {
      // Ignore malformed storage entries and keep probing.
    }
  }

  return null;
};

const resolveBootstrapDate = () => {
  const today = new Date();
  const fallback = {
    selectedYear: today.getFullYear(),
    selectedMonth: today.getMonth(),
    selectedDay: today.getDate(),
  };

  if (typeof window === 'undefined') {
    return fallback;
  }

  const rawDate = new URLSearchParams(window.location.search).get('date');
  if (!rawDate || !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    return fallback;
  }

  const [year, month, day] = rawDate.split('-').map(Number);
  if (!year || !month || !day) {
    return fallback;
  }

  return {
    selectedYear: year,
    selectedMonth: month - 1,
    selectedDay: day,
  };
};

const resolveDaysInMonth = (year: number, monthIndex: number) =>
  new Date(year, monthIndex + 1, 0).getDate();

const resolveBootstrapModule = (): ModuleType => {
  if (typeof window === 'undefined') {
    return 'CENSUS';
  }

  return resolveModuleFromPathname(window.location.pathname) ?? 'CENSUS';
};

const buildBootstrapAuthContextValue = (
  persistedUser: ReturnType<typeof readPersistedFirebaseAuthUser>
): AuthContextType => {
  const currentUser =
    persistedUser ??
    ({
      uid: 'bootstrap-user',
      email: 'bootstrap@hospital.cl',
      displayName: 'Bootstrap User',
      role: DEFAULT_BOOTSTRAP_ROLE,
    } satisfies NonNullable<AuthContextType['currentUser']>);

  return {
    sessionState: {
      status: 'authorized',
      user: {
        ...currentUser,
        role: DEFAULT_BOOTSTRAP_ROLE,
      },
    },
    authRuntime: {
      sessionStatus: 'authorized',
      authLoading: false,
      isFirebaseConnected: true,
      isOnline: true,
      bootstrapPending: true,
      pendingAgeMs: 0,
      budgetProfile: 'default',
      timeoutMs: 15_000,
      runtimeState: 'recoverable',
      issues: [],
    },
    currentUser: {
      ...currentUser,
      role: DEFAULT_BOOTSTRAP_ROLE,
    },
    authorizedUser: {
      ...currentUser,
      role: DEFAULT_BOOTSTRAP_ROLE,
    },
    user: {
      ...currentUser,
      role: DEFAULT_BOOTSTRAP_ROLE,
    },
    role: DEFAULT_BOOTSTRAP_ROLE,
    isLoading: true,
    isAuthenticated: true,
    isAuthorizedSession: true,
    isAnonymousSignature: false,
    isUnauthorized: false,
    isEditor: true,
    isViewer: false,
    isFirebaseConnected: true,
    remoteSyncStatus: 'ready',
    remoteSyncState: {
      mode: 'enabled',
      reason: 'ready',
    },
    signOut: noopAsync,
  };
};

export const BootstrapRouteChrome: React.FC = () => {
  const [bootstrapDate] = React.useState(resolveBootstrapDate);
  const [bootstrapModule] = React.useState(resolveBootstrapModule);
  const [persistedUser] = React.useState(readPersistedFirebaseAuthUser);
  const authValue = React.useMemo(
    () => buildBootstrapAuthContextValue(persistedUser),
    [persistedUser]
  );
  const userEmail = persistedUser?.email ?? authValue.currentUser?.email ?? null;
  const daysInMonth = React.useMemo(
    () => resolveDaysInMonth(bootstrapDate.selectedYear, bootstrapDate.selectedMonth),
    [bootstrapDate.selectedMonth, bootstrapDate.selectedYear]
  );
  const currentDateString = `${bootstrapDate.selectedYear}-${String(bootstrapDate.selectedMonth + 1).padStart(2, '0')}-${String(bootstrapDate.selectedDay).padStart(2, '0')}`;
  const renderDateStrip = shouldRenderDateStrip({
    currentModule: bootstrapModule,
    censusViewMode: BOOTSTRAP_CENSUS_VIEW_MODE,
    isSignatureMode: false,
  });
  const canUseCensusChromeActions = bootstrapModule === 'CENSUS';
  const canUseHandoffPrintActions = shouldShowPrintButtonForModule(bootstrapModule);

  return (
    <AuthContext.Provider value={authValue}>
      <div className="min-h-screen bg-slate-100 font-sans flex flex-col print:bg-white print:p-0">
        <Navbar
          currentModule={bootstrapModule}
          setModule={noop}
          censusViewMode={BOOTSTRAP_CENSUS_VIEW_MODE}
          setCensusViewMode={noop}
          onOpenBedManager={noop}
          onExportCSV={noop}
          onImportJSON={noopImportJson}
          userEmail={userEmail}
          onLogout={noop}
          isFirebaseConnected
          hideRuntimeIndicators
        />
        {renderDateStrip && (
          <DateStrip
            selectedYear={bootstrapDate.selectedYear}
            setSelectedYear={noopSetNumber}
            selectedMonth={bootstrapDate.selectedMonth}
            setSelectedMonth={noopSetNumber}
            selectedDay={bootstrapDate.selectedDay}
            setSelectedDay={noopSetNumber}
            currentDateString={currentDateString}
            daysInMonth={daysInMonth}
            existingDaysInMonth={[]}
            navigateDays={noop}
            onExportPDF={canUseHandoffPrintActions ? noop : undefined}
            onExportExcel={canUseCensusChromeActions ? noop : undefined}
            onBackupExcel={canUseCensusChromeActions ? noopAsync : undefined}
            onBackupPDF={canUseHandoffPrintActions ? noopAsync : undefined}
            onConfigureEmail={canUseCensusChromeActions ? noop : undefined}
            onSendEmail={canUseCensusChromeActions ? noop : undefined}
            emailStatus="idle"
            isBackingUp={false}
            currentModule={bootstrapModule}
            onOpenBedManager={bootstrapModule === 'CENSUS' ? noop : undefined}
            onOpenPatientSearch={noop}
            onToggleBookmarks={bootstrapModule === 'CENSUS' ? noop : undefined}
            showBookmarks={false}
            role={DEFAULT_BOOTSTRAP_ROLE}
          />
        )}
        <main className="max-w-screen-2xl mx-auto px-4 pt-4 pb-20 flex-1 w-full print:p-0 print:pb-0 print:max-w-none">
          <ViewLoader />
        </main>
      </div>
    </AuthContext.Provider>
  );
};

export const BootstrapCensusChrome = BootstrapRouteChrome;
```

**Puntos clave del mock de AuthContext**:

- `isLoading: true` — crítico. Impide que los hooks reales de data (que suelen
  gatear por `!isLoading`) disparen queries durante el skeleton.
- `bootstrapPending: true` — señal adicional para consumidores que escuchan
  runtime state.
- `signOut: noopAsync` — no debe ejecutarse durante el skeleton. Si se clickea
  el logout button durante los ~100 ms del skeleton, no hace nada. Aceptable.
- `role: 'admin'` + `isAuthorizedSession: true` — libera toda la UI (todos los
  botones visibles). Si tu versión previa tiene roles más estrictos, ajustar.

## 4.6 `src/app-shell/bootstrap/authenticatedRoutePreloadController.ts`

```ts
import { resolveModuleFromPathname } from '@/hooks/controllers/appStateNavigationController';

type LoadRouteComponents = () => Promise<unknown>;

export interface AuthenticatedRoutePreloadOptions {
  pathname: string | undefined;
  loadCensusComponents?: LoadRouteComponents;
}

const defaultLoadCensusComponents: LoadRouteComponents = () =>
  import('@/features/census/public-components');

export const preloadAuthenticatedRouteChunk = async ({
  pathname,
  loadCensusComponents = defaultLoadCensusComponents,
}: AuthenticatedRoutePreloadOptions): Promise<void> => {
  if (resolveModuleFromPathname(pathname) !== 'CENSUS') {
    return;
  }

  await loadCensusComponents();
};

export const preloadDefaultPostLoginRoute = async ({
  loadCensusComponents = defaultLoadCensusComponents,
}: {
  loadCensusComponents?: LoadRouteComponents;
} = {}): Promise<void> => {
  await loadCensusComponents();
};
```

**Extensión recomendada**: para preload de otros módulos, ampliar así:

```ts
const defaultLoaders: Partial<Record<ModuleType, LoadRouteComponents>> = {
  CENSUS: () => import('@/features/census/public-components'),
  NURSING_HANDOFF: () => import('@/features/handoff/public'),
  MEDICAL_HANDOFF: () => import('@/features/handoff/public'),
  TRANSFER_MANAGEMENT: () => import('@/features/transfers/public'),
  // …
};

export const preloadAuthenticatedRouteChunk = async ({ pathname }) => {
  const mod = resolveModuleFromPathname(pathname);
  const loader = mod ? defaultLoaders[mod] : null;
  if (!loader) return;
  await loader();
};
```

## 4.7 `src/app-shell/bootstrap/useAppBootstrapState.ts`

```ts
import React from 'react';
import { useDateNavigation, useSignatureMode, useVersionCheck } from '@/hooks';
import { useStalenessGuard } from '@/hooks/useStalenessGuard';
import type { UseDateNavigationReturn } from '@/hooks/useDateNavigation';
import { useStorageMigration } from '@/hooks/useStorageMigration';
import { setFirestoreSyncState } from '@/services/repositories/repositoryConfig';
import { defaultFirebaseConfigRuntimeAdapter } from '@/services/firebase-runtime/firebaseConfigRuntimeAdapter';
import { hasRecentAuthenticatedSessionHint } from '@/services/auth/authStorageHints';
import { createScopedLogger } from '@/services/utils/loggerScope';
import { useAuth, type AuthContextType } from '@/context';

export interface AppAuthenticatedDateNavigation extends UseDateNavigationReturn {
  isSignatureMode: boolean;
  currentDateString: string;
}

export type AppBootstrapPhase =
  | 'bootstrapping'
  | 'rehydrating'
  | 'authenticated'
  | 'unauthenticated'
  | 'local_only'
  | 'signature_mode';

export type AppBootstrapState =
  | {
      status: 'loading';
      phase: 'bootstrapping' | 'rehydrating';
      auth: AuthContextType;
    }
  | {
      status: 'signature_mode';
      phase: 'signature_mode';
      auth: AuthContextType;
    }
  | {
      status: 'unauthenticated';
      phase: 'unauthenticated' | 'local_only';
      auth: AuthContextType;
    }
  | {
      status: 'authenticated';
      phase: 'authenticated';
      auth: AuthContextType;
      dateNav: AppAuthenticatedDateNavigation;
    };

interface BuildAppBootstrapStateParams {
  auth: AuthContextType;
  dateNav: UseDateNavigationReturn;
  isSignatureMode: boolean;
  currentDateString: string;
  hasRecentAuthenticatedSessionHint?: boolean;
}

const isIgnorableWorkerShutdownImportError = (error: unknown): boolean => {
  const message = String(error);
  return message.includes('[vitest-worker]: Closing rpc while "fetch" was pending');
};

const appLogger = createScopedLogger('App');

const FIRESTORE_RUNTIME_POLL_MS = 250;

const resolveAppLoadingPhase = (auth: AuthContextType): 'bootstrapping' | 'rehydrating' => {
  if (
    auth.sessionState.status === 'authenticating' ||
    auth.isFirebaseConnected ||
    auth.remoteSyncState.reason === 'auth_connecting'
  ) {
    return 'rehydrating';
  }

  return 'bootstrapping';
};

const resolveAppUnauthenticatedPhase = (auth: AuthContextType): 'unauthenticated' | 'local_only' =>
  auth.remoteSyncState.mode === 'local_only' ? 'local_only' : 'unauthenticated';

const shouldKeepSameTabRefreshRehydrating = ({
  auth,
  hasRecentAuthenticatedSessionHint,
}: Pick<BuildAppBootstrapStateParams, 'auth' | 'hasRecentAuthenticatedSessionHint'>): boolean =>
  !auth.isLoading &&
  !auth.isAuthenticated &&
  auth.sessionState.status === 'unauthenticated' &&
  Boolean(hasRecentAuthenticatedSessionHint) &&
  auth.authRuntime.bootstrapPending;

const resolveSyncedFirestoreState = (
  remoteSyncState: AuthContextType['remoteSyncState'],
  isFirestoreReady: boolean
): AuthContextType['remoteSyncState'] => {
  if (remoteSyncState.mode !== 'enabled') {
    return remoteSyncState;
  }

  if (isFirestoreReady) {
    return {
      mode: 'enabled',
      reason: 'ready',
    };
  }

  return {
    mode: 'bootstrapping',
    reason: 'auth_connecting',
  };
};

const useSyncFirestoreStatus = (remoteSyncState: AuthContextType['remoteSyncState']) => {
  React.useEffect(() => {
    const syncState = () => {
      try {
        const nextState = resolveSyncedFirestoreState(
          remoteSyncState,
          defaultFirebaseConfigRuntimeAdapter.getOptionalDb() !== null
        );
        setFirestoreSyncState(nextState);
        return nextState.mode === 'enabled';
      } catch (error) {
        if (isIgnorableWorkerShutdownImportError(error)) {
          return true;
        }
        appLogger.error('Failed to sync Firestore status', error);
        return true;
      }
    };

    if (syncState()) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (syncState()) {
        window.clearInterval(intervalId);
      }
    }, FIRESTORE_RUNTIME_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [remoteSyncState]);
};

export const buildAppBootstrapState = ({
  auth,
  dateNav,
  isSignatureMode,
  currentDateString,
  hasRecentAuthenticatedSessionHint = false,
}: BuildAppBootstrapStateParams): AppBootstrapState => {
  if (isSignatureMode) {
    return {
      status: 'signature_mode',
      phase: 'signature_mode',
      auth,
    };
  }

  if (
    auth.isLoading ||
    shouldKeepSameTabRefreshRehydrating({
      auth,
      hasRecentAuthenticatedSessionHint,
    })
  ) {
    return {
      status: 'loading',
      phase: auth.isLoading ? resolveAppLoadingPhase(auth) : 'rehydrating',
      auth,
    };
  }

  if (!auth.isAuthenticated) {
    return {
      status: 'unauthenticated',
      phase: resolveAppUnauthenticatedPhase(auth),
      auth,
    };
  }

  return {
    status: 'authenticated',
    phase: 'authenticated',
    auth,
    dateNav: {
      ...dateNav,
      isSignatureMode,
      currentDateString,
    },
  };
};

export const useAppBootstrapState = (): AppBootstrapState => {
  const auth = useAuth();
  const recentAuthenticatedSessionHint = hasRecentAuthenticatedSessionHint();

  useStorageMigration({ enabled: !auth.isLoading && auth.isAuthenticated });
  useVersionCheck();
  useStalenessGuard();
  useSyncFirestoreStatus(auth.remoteSyncState);

  const dateNav = useDateNavigation();
  const { isSignatureMode, currentDateString } = useSignatureMode(
    dateNav.currentDateString,
    auth.currentUser,
    auth.isLoading
  );

  return React.useMemo<AppBootstrapState>(
    () =>
      buildAppBootstrapState({
        auth,
        dateNav,
        isSignatureMode,
        currentDateString,
        hasRecentAuthenticatedSessionHint: recentAuthenticatedSessionHint,
      }),
    [auth, currentDateString, dateNav, isSignatureMode, recentAuthenticatedSessionHint]
  );
};
```

## 4.8 `src/app-shell/runtime/AuthenticatedAppShell.tsx`

```tsx
import React from 'react';
import { FlaskConical } from 'lucide-react';
import { AppContent } from '@/components/layout/AppContent';
import { CensusProvider } from '@/context/CensusContext';
import { type AuthContextType } from '@/context';
import { type AppAuthenticatedDateNavigation } from '@/app-shell/bootstrap/useAppBootstrapState';
import { DeferredSystemHealthReporter } from '@/app-shell/runtime/DeferredSystemHealthReporter';
import { useAuthenticatedAppRuntime } from '@/app-shell/runtime/useAuthenticatedAppRuntime';
import type { MedicalIndicationsPatientOption } from '@/shared/contracts/medicalIndications';
import { lazyWithRetry } from '@/utils/lazyWithRetry';

const LaboratoryQuickAction = lazyWithRetry(() =>
  import('@/features/laboratory').then(module => ({
    default: module.LaboratoryQuickAction,
  }))
);

const LaboratoryQuickActionFallback = () => (
  <button
    type="button"
    disabled
    aria-disabled="true"
    tabIndex={-1}
    className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 opacity-50"
    title="Laboratorio / Exámenes Syslab (cargando...)"
  >
    <FlaskConical size={14} />
    <span className="hidden sm:inline">Lab</span>
  </button>
);

interface AuthenticatedAppShellProps {
  auth: AuthContextType;
  dateNav: AppAuthenticatedDateNavigation;
}

export const AuthenticatedAppShell = ({ auth, dateNav }: AuthenticatedAppShellProps) => {
  const { censusContextValue, ui } = useAuthenticatedAppRuntime({ auth, dateNav });
  const renderFeatureQuickActions = React.useCallback(
    (patients: MedicalIndicationsPatientOption[]) => (
      <React.Suspense fallback={<LaboratoryQuickActionFallback />}>
        <LaboratoryQuickAction patients={patients} />
      </React.Suspense>
    ),
    []
  );

  return (
    <CensusProvider value={censusContextValue}>
      <DeferredSystemHealthReporter />
      <AppContent ui={ui} renderFeatureQuickActions={renderFeatureQuickActions} />
    </CensusProvider>
  );
};
```

## 4.9 `src/app-shell/runtime/useAuthenticatedAppRuntime.ts`

```ts
import React from 'react';
import {
  useAppState,
  useCensusEmail,
  useDailyRecord,
  useExistingDaysQuery,
  useFileOperations,
} from '@/hooks';
import type { UseAppStateReturn } from '@/hooks/useAppState';
import type { UseCensusEmailReturn } from '@/hooks/useCensusEmail';
import type { UseFileOperationsReturn } from '@/hooks/useFileOperations';
import type { DailyRecordContextType } from '@/context/dailyRecordContextContracts';
import { resolveShiftNurseSignature } from '@/services/staff/dailyRecordStaffing';
import type { AuthContextType } from '@/context';
import type { CensusContextType } from '@/context/CensusContext';
import type { AppAuthenticatedDateNavigation } from '@/app-shell/bootstrap/useAppBootstrapState';
export interface AuthenticatedAppRuntime {
  dailyRecordHook: DailyRecordContextType;
  existingDaysInMonth: number[];
  nurseSignature: string;
  censusEmail: UseCensusEmailReturn;
  fileOps: UseFileOperationsReturn;
  ui: UseAppStateReturn;
  censusContextValue: CensusContextType;
}

interface UseAuthenticatedAppRuntimeParams {
  auth: AuthContextType;
  dateNav: AppAuthenticatedDateNavigation;
}

interface BuildCensusContextValueParams {
  dailyRecordHook: DailyRecordContextType;
  dateNav: AppAuthenticatedDateNavigation;
  existingDaysInMonth: number[];
  fileOps: UseFileOperationsReturn;
  censusEmail: UseCensusEmailReturn;
  nurseSignature: string;
}

interface BuildAuthenticatedAppRuntimeParams extends BuildCensusContextValueParams {
  ui: UseAppStateReturn;
}

export const resolveExistingDaysInMonth = (data: number[] | undefined): number[] => data ?? [];

export const buildAuthenticatedCensusContextValue = ({
  dailyRecordHook,
  dateNav,
  existingDaysInMonth,
  fileOps,
  censusEmail,
  nurseSignature,
}: BuildCensusContextValueParams): CensusContextType => ({
  dailyRecord: dailyRecordHook,
  dateNav: {
    ...dateNav,
    existingDaysInMonth,
  },
  fileOps,
  censusEmail,
  nurseSignature,
});

export const buildAuthenticatedAppRuntime = ({
  dailyRecordHook,
  dateNav,
  existingDaysInMonth,
  fileOps,
  censusEmail,
  nurseSignature,
  ui,
}: BuildAuthenticatedAppRuntimeParams): AuthenticatedAppRuntime => ({
  dailyRecordHook,
  existingDaysInMonth,
  nurseSignature,
  censusEmail,
  fileOps,
  ui,
  censusContextValue: buildAuthenticatedCensusContextValue({
    dailyRecordHook,
    dateNav,
    existingDaysInMonth,
    fileOps,
    censusEmail,
    nurseSignature,
  }),
});

export const useAuthenticatedAppRuntime = ({
  auth,
  dateNav,
}: UseAuthenticatedAppRuntimeParams): AuthenticatedAppRuntime => {
  const dailyRecordHook = useDailyRecord(dateNav.currentDateString, false, auth.remoteSyncStatus);
  const { record } = dailyRecordHook;

  const { data } = useExistingDaysQuery(dateNav.selectedYear, dateNav.selectedMonth);
  const existingDaysInMonth = React.useMemo(() => resolveExistingDaysInMonth(data), [data]);

  const nurseSignature = React.useMemo(() => resolveShiftNurseSignature(record, 'night'), [record]);

  const censusEmail = useCensusEmail({
    record,
    currentDateString: dateNav.currentDateString,
    nurseSignature,
    selectedYear: dateNav.selectedYear,
    selectedMonth: dateNav.selectedMonth,
    selectedDay: dateNav.selectedDay,
    user: auth.currentUser,
    role: auth.role,
  });

  const fileOps = useFileOperations(record, dailyRecordHook.refresh);
  const ui = useAppState();

  return React.useMemo(
    () =>
      buildAuthenticatedAppRuntime({
        dailyRecordHook,
        dateNav,
        existingDaysInMonth,
        fileOps,
        censusEmail,
        nurseSignature,
        ui,
      }),
    [censusEmail, dailyRecordHook, dateNav, existingDaysInMonth, fileOps, nurseSignature, ui]
  );
};
```

## 4.10 `src/components/ui/InitialLoadingScreen.tsx`

```tsx
import React from 'react';
import { Cross, Loader2 } from 'lucide-react';
import {
  resolveInitialLoginBackgroundMode,
  resolveLoginBackgroundImage,
} from '@/shared/ui/loginBackgroundModeController';

export type InitialLoadingScreenVariant = 'default' | 'login-shell';
interface InitialLoadingScreenVariantOptions {
  preferLoginShell?: boolean;
}

const normalizePathname = (pathname: string) => pathname.replace(/^\/+|\/+$/g, '');

export const resolveInitialLoadingScreenVariant = (
  pathname: string | undefined,
  options: InitialLoadingScreenVariantOptions = {}
): InitialLoadingScreenVariant => {
  const normalizedPath = normalizePathname(pathname ?? '/');
  const { preferLoginShell = true } = options;

  if (preferLoginShell && (normalizedPath === '' || normalizedPath === 'login')) {
    return 'login-shell';
  }

  return 'default';
};

export const shouldRenderInitialLoadingScreen = (_pathname: string | undefined): boolean => {
  // No route should opt into the legacy full-screen startup loader by default.
  // Authenticated module refreshes keep route chrome and render only internal
  // lazy-view loaders; login keeps its background shell without a spinner.
  return false;
};

const resolveCurrentPathname = () =>
  typeof window !== 'undefined' ? window.location.pathname : '/';

const LoadingIndicator = () => (
  <div className="flex flex-col items-center gap-2.5">
    <Loader2 size={28} className="animate-spin text-accent-500" />
    <span className="text-slate-400 text-xs font-medium tracking-wide">Cargando...</span>
  </div>
);

const LoginShellLoadingScreen = () => {
  const backgroundMode = resolveInitialLoginBackgroundMode();
  const backgroundImage = resolveLoginBackgroundImage(backgroundMode);
  const overlayClass =
    backgroundMode === 'day'
      ? 'bg-[linear-gradient(115deg,rgba(15,23,42,0.82)_0%,rgba(15,23,42,0.62)_36%,rgba(15,23,42,0.28)_64%,rgba(255,255,255,0.08)_100%)]'
      : 'bg-[linear-gradient(115deg,rgba(2,6,23,0.92)_0%,rgba(2,6,23,0.78)_35%,rgba(2,6,23,0.44)_66%,rgba(2,6,23,0.22)_100%)]';

  return (
    <div
      data-testid="login-loading-shell"
      data-background-mode={backgroundMode}
      data-background-image={backgroundImage}
      className="relative min-h-screen overflow-hidden bg-slate-950"
    >
      <div
        className="absolute inset-0 bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${backgroundImage}')` }}
        aria-hidden="true"
      />
      <div className={`absolute inset-0 ${overlayClass}`} aria-hidden="true" />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.14),transparent_26%)]"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-6 sm:px-6">
        <div className="w-full max-w-sm rounded-[2rem] border border-white/16 bg-slate-950/32 p-8 shadow-[0_30px_80px_rgba(2,6,23,0.42)] backdrop-blur-xl">
          <div className="flex flex-col items-center gap-4 text-center text-white">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-[2rem] border border-white/15 bg-white/10 shadow-lg shadow-slate-950/30">
              <Cross className="h-8 w-8 text-white" strokeWidth={2.2} />
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-100/70">
                Hospital Hanga Roa
              </p>
              <p className="text-sm font-medium text-white/92">Acceso seguro</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const DefaultLoadingScreen = () => (
  <div
    data-testid="default-loading-screen"
    className="min-h-screen bg-slate-100 flex items-center justify-center"
  >
    <LoadingIndicator />
  </div>
);

interface InitialLoadingScreenProps {
  pathname?: string;
  preferLoginShell?: boolean;
}

export const InitialLoadingScreen: React.FC<InitialLoadingScreenProps> = ({
  pathname,
  preferLoginShell,
}) => {
  const variant = resolveInitialLoadingScreenVariant(pathname ?? resolveCurrentPathname(), {
    preferLoginShell,
  });

  if (variant === 'login-shell') {
    return <LoginShellLoadingScreen />;
  }

  return <DefaultLoadingScreen />;
};
```

**Nota crítica**: `shouldRenderInitialLoadingScreen` devuelve `false` siempre.
Este archivo es **dead code** en el runtime — nunca debería invocarse.
Mantenerlo para backward-compat de tests.

## 4.11 `src/components/ui/ViewLoader.tsx`

```tsx
/**
 * ViewLoader
 * Loading fallback component for lazy-loaded views.
 * Minimal spinner with subtle text.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';

export const ViewLoader: React.FC = () => (
  <div className="flex items-center justify-center min-h-[300px] py-16 print:hidden">
    <div className="flex flex-col items-center gap-2.5">
      <Loader2 size={28} className="animate-spin text-accent-500" />
      <span className="text-slate-400 text-xs font-medium tracking-wide">Cargando...</span>
    </div>
  </div>
);
```

## 4.12 `src/services/auth/authStorageHints.ts`

```ts
const FIREBASE_AUTH_STORAGE_PREFIX = 'firebase:authUser:';
const AUTHENTICATED_SESSION_HINT_KEY = 'hhr_logged_this_session';

const hasWindowStorage = (storage: Storage | undefined): storage is Storage =>
  typeof window !== 'undefined' && typeof storage !== 'undefined';

const storageContainsPrefix = (storage: Storage, prefix: string): boolean => {
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
};

export const hasPersistedFirebaseAuthHint = (): boolean => {
  if (
    !hasWindowStorage(typeof localStorage === 'undefined' ? undefined : localStorage) &&
    !hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
  ) {
    return false;
  }

  return (
    (hasWindowStorage(typeof localStorage === 'undefined' ? undefined : localStorage) &&
      storageContainsPrefix(localStorage, FIREBASE_AUTH_STORAGE_PREFIX)) ||
    (hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage) &&
      storageContainsPrefix(sessionStorage, FIREBASE_AUTH_STORAGE_PREFIX))
  );
};

export const hasRecentAuthenticatedSessionHint = (): boolean => {
  if (!hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)) {
    return false;
  }

  try {
    return sessionStorage.getItem(AUTHENTICATED_SESSION_HINT_KEY) === 'true';
  } catch {
    return false;
  }
};

export const clearRecentAuthenticatedSessionHint = (): void => {
  if (!hasWindowStorage(typeof sessionStorage === 'undefined' ? undefined : sessionStorage)) {
    return;
  }

  try {
    sessionStorage.removeItem(AUTHENTICATED_SESSION_HINT_KEY);
  } catch {
    // Ignore storage errors
  }
};
```

**Nota**: el inline script del HTML **re-implementa** estas funciones en JS
vanilla porque corre antes de que existan módulos. Mantener las dos versiones
sincronizadas.

## 4.13 `src/hooks/controllers/appStateNavigationController.ts` (extracto crítico)

```ts
import type { ModuleType } from '@/constants/navigationConfig';

const MODULES_FROM_URL: readonly ModuleType[] = [
  'CENSUS',
  'ANALYTICS',
  'CUDYR',
  'NURSING_HANDOFF',
  'MEDICAL_HANDOFF',
  'AUDIT',
  'WHATSAPP',
  'TRANSFER_MANAGEMENT',
  'BACKUP_FILES',
  'PATIENT_MASTER_INDEX',
  'DATA_MAINTENANCE',
  'DIAGNOSTICS',
  'FUNCTIONS_TELEMETRY',
  'CONFIGURATION',
  'DATA',
  'COMMUNICATIONS',
  'ROLE_MANAGEMENT',
  'REMINDERS',
  'ERRORS',
] as const;

export const MODULE_PATH_SEGMENTS: Record<ModuleType, string> = {
  CENSUS: 'census',
  ANALYTICS: 'statistics',
  CUDYR: 'cudyr',
  NURSING_HANDOFF: 'nursing-handoff',
  MEDICAL_HANDOFF: 'medical-handoff',
  AUDIT: 'audit',
  WHATSAPP: 'whatsapp',
  TRANSFER_MANAGEMENT: 'transfer-management',
  BACKUP_FILES: 'backup-files',
  PATIENT_MASTER_INDEX: 'patient-master-index',
  DATA_MAINTENANCE: 'data-maintenance',
  DIAGNOSTICS: 'diagnostics',
  FUNCTIONS_TELEMETRY: 'functions-telemetry',
  CONFIGURATION: 'configuration',
  DATA: 'data',
  COMMUNICATIONS: 'communications',
  ROLE_MANAGEMENT: 'role-management',
  REMINDERS: 'reminders',
  ERRORS: 'errors',
};

const MODULE_FROM_PATH_SEGMENT = Object.fromEntries(
  Object.entries(MODULE_PATH_SEGMENTS).map(([module, segment]) => [segment, module])
) as Record<string, ModuleType>;

export const resolveModuleFromPathname = (pathname: string | undefined): ModuleType | null => {
  const pathSegment = (pathname ?? '/').replace(/^\/+|\/+$/g, '');
  if (!pathSegment) {
    return 'CENSUS';
  }

  if (pathSegment && MODULE_FROM_PATH_SEGMENT[pathSegment]) {
    return MODULE_FROM_PATH_SEGMENT[pathSegment];
  }

  return null;
};

export const resolveInitialModuleFromLocation = ({
  pathname,
  search,
}: {
  pathname: string | undefined;
  search: string | undefined;
}): ModuleType => {
  const normalizedPath = (pathname ?? '/').replace(/^\/+|\/+$/g, '');

  if (normalizedPath) {
    const moduleFromPath = resolveModuleFromPathname(pathname);
    if (moduleFromPath) {
      return moduleFromPath;
    }
  }

  const params = new URLSearchParams(search ?? '');
  const rawModule = params.get('module');
  if (!rawModule) return 'CENSUS';
  return MODULES_FROM_URL.includes(rawModule as ModuleType) ? (rawModule as ModuleType) : 'CENSUS';
};

export const shouldShowPrintButtonForModule = (module: ModuleType | null): boolean =>
  module === 'CUDYR' || module === 'NURSING_HANDOFF' || module === 'MEDICAL_HANDOFF';
```

## 4.14 `src/config/queryClient.ts`

```ts
/**
 * React Query Configuration
 * Centralized setup for TanStack Query with optimized defaults for Firebase.
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Default query client with optimized settings for a healthcare app.
 *
 * Settings:
 * - staleTime: 5 minutes (data considered fresh for 5 min)
 * - gcTime: 30 minutes (keep unused data in cache for 30 min)
 * - retry: 2 attempts for failed queries
 * - refetchOnWindowFocus: only refetch stale data when tab becomes active
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 2,
      refetchOnWindowFocus: 'always',
      refetchOnMount: true,
      refetchOnReconnect: 'always',
    },
    mutations: {
      retry: 1,
    },
  },
});

export const queryKeys = {
  dailyRecord: {
    all: ['dailyRecord'] as const,
    byDate: (date: string) => ['dailyRecord', date] as const,
    byMonth: (year: number, month: number) => ['dailyRecord', 'month', year, month] as const,
    lists: () => ['dailyRecord', 'list'] as const,
  },
  existingDays: {
    all: ['existingDays'] as const,
    byMonth: (year: number, monthZeroBased: number) =>
      ['existingDays', year, monthZeroBased] as const,
  },
  staff: {
    all: ['staff'] as const,
    catalog: () => ['staff', 'catalog'] as const,
  },
  audit: {
    all: ['audit'] as const,
    logs: (filters?: { startDate?: string; endDate?: string }) =>
      ['audit', 'logs', filters] as const,
  },
  user: {
    all: ['user'] as const,
    current: () => ['user', 'current'] as const,
    settings: () => ['user', 'settings'] as const,
  },
  analytics: {
    all: ['analytics'] as const,
    recordsRange: (startDate: string, endDate: string) =>
      ['analytics', 'recordsRange', startDate, endDate] as const,
    remoteStats: (hospitalId: string, startDate: string, endDate: string) =>
      ['analytics', 'remoteStats', hospitalId, startDate, endDate] as const,
  },
  transfers: {
    all: ['transfers'] as const,
    activeByBed: (bedId: string) => ['transfers', 'activeByBed', bedId] as const,
    activeByPatientRut: (rut: string) => ['transfers', 'activeByPatientRut', rut] as const,
  },
  laboratory: {
    all: ['laboratory'] as const,
    byPatient: (rut: string) => ['laboratory', 'patient', rut] as const,
  },
} as const;

export const clearQueryCache = (): void => {
  queryClient.clear();
};
```

---

# Parte 5: Las 5 optimizaciones implementadas

Resumen ordenado de mayor a menor impacto, con file mapping.

### Opt 1 — Inline boot script en `index.html`

- **Qué hace**: Lee hints de auth en storage sincrónicamente. Pinta fondo
  correcto (login ocean o app chrome gradient). Inyecta `modulepreload`.
- **Impacto**: −50 a −300 ms de flash (depende del dispositivo).
- **Archivo**: `index.html`.
- **Ver sección 4.1 para el código.**

### Opt 2 — `import('@/App')` en paralelo con `bootstrapAppRuntime`

- **Qué hace**: descarga el chunk de App mientras Firebase inicia.
- **Impacto**: −100 a −400 ms de TTL (tiempo al primer render útil).
- **Archivo**: `src/index.tsx` (línea `const appModulePromise = import('@/App')`).
- **Ver sección 4.2.**

### Opt 3 — Module preload desde HTML + preload de chunk de ruta

- **Qué hace**: `<link rel="modulepreload" href="/src/App.tsx">` inyectado por
  el inline script. Para ruta CENSUS, también preload de `public-components.ts`.
- **Impacto**: −50 a −150 ms en el descubrimiento del módulo.
- **Archivos**: `index.html` (inline script) + `authenticatedRoutePreloadController.ts`.

### Opt 4 — `BootstrapRouteChrome` (skeleton con Navbar + DateStrip reales)

- **Qué hace**: durante el bootstrap, React monta los componentes reales de
  chrome con `AuthContext` mockeado. Usuario ve estructura estable.
- **Impacto**: UX — primera render estructural visible ~250 ms antes.
- **Archivos**: `BootstrapCensusChrome.tsx` + referencias en `index.tsx` y `App.tsx`.
- **Ver sección 4.5.**

### Opt 5 — `InitialLoadingScreen` deshabilitado por contrato

- **Qué hace**: `shouldRenderInitialLoadingScreen` retorna `false` siempre. El
  loader fullscreen legacy nunca se rendera.
- **Impacto**: elimina el flash de spinner sobre el chrome.
- **Archivo**: `src/components/ui/InitialLoadingScreen.tsx`.
- **Ver sección 4.10.**

---

# Parte 6: Las 2 optimizaciones recomendadas adicionales

Estas NO están implementadas en la versión de referencia. Agregarlas al mismo
tiempo que el port da ganancias adicionales significativas.

### Opt 6 — Gatear `useExistingDaysQuery` + `useCensusEmail` por módulo

**Problema**: `useAuthenticatedAppRuntime` ejecuta los 4 hooks de censo en
TODAS las rutas autenticadas, incluso en handoff/traslados/audit donde no se
usan. `useExistingDaysQuery` hace un range-scan de IDB del mes completo.
`useCensusEmail` hace lecturas de localStorage + potencialmente Firestore.

**Evidencia**: verificá con grep:

```bash
grep -rn "existingDaysInMonth" src/features/  # ¿dónde se lee?
grep -rn "useCensusEmail" src/features/       # ¿dónde se invoca?
```

Si los resultados son solo dentro de `src/features/census/`, el gate es seguro.

**Implementación propuesta**:

```ts
// src/app-shell/runtime/useAuthenticatedAppRuntime.ts

export const useAuthenticatedAppRuntime = ({ auth, dateNav }) => {
  const ui = useAppState(); // ← mover ARRIBA
  const isCensusRoute = ui.currentModule === 'CENSUS';

  const dailyRecordHook = useDailyRecord(dateNav.currentDateString, false, auth.remoteSyncStatus);
  const { record } = dailyRecordHook;

  // Gate: solo censo necesita el mes calendar data
  const { data } = useExistingDaysQuery(dateNav.selectedYear, dateNav.selectedMonth, {
    enabled: isCensusRoute,
  });
  const existingDaysInMonth = React.useMemo(() => resolveExistingDaysInMonth(data), [data]);

  const nurseSignature = React.useMemo(() => resolveShiftNurseSignature(record, 'night'), [record]);

  // Gate: solo censo envía censo por email
  const censusEmail = useCensusEmail({
    record,
    currentDateString: dateNav.currentDateString,
    nurseSignature,
    selectedYear: dateNav.selectedYear,
    selectedMonth: dateNav.selectedMonth,
    selectedDay: dateNav.selectedDay,
    user: auth.currentUser,
    role: auth.role,
    enabled: isCensusRoute, // ← nuevo parámetro
  });

  const fileOps = useFileOperations(record, dailyRecordHook.refresh);

  return React.useMemo(/* ... */);
};
```

Requiere también:

```ts
// src/hooks/useExistingDaysQuery.ts
export const useExistingDaysQuery = (
  year: number,
  month: number,
  options: { enabled?: boolean } = {}
) => {
  return useQuery({
    queryKey: ['existingDays', year, month],
    queryFn: () => fetchExistingDaysInMonth(year, month + 1),
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
};
```

```ts
// src/hooks/useCensusEmail.ts o el effect bootstrap
export const useCensusEmailRecipientBootstrapEffect = ({
  // ...
  enabled = true,
}) => {
  React.useEffect(() => {
    if (!enabled) return; // ← gate
    // existing logic
  }, [enabled /* deps */]);
};
```

**Ahorro**: 50–200 ms en F5 de rutas no-censo + menos contención de IDB
mientras `useDailyRecord` lee.

**Riesgo**: bajo. Tests a validar:

- `src/tests/views/census/CensusView.test.tsx` — censo sigue funcionando.
- `src/tests/views/handoff/HandoffView.test.tsx` — handoff no crashea por
  falta de `existingDaysInMonth`.

### Opt 7 — Persistir React Query cache entre F5

**Problema**: `queryClient` se recrea en cada F5. Todas las queries arrancan
cold. El `dailyRecord` vuelve a fetch desde Firestore aun cuando hace 30 s
se cargó.

**Implementación**:

```bash
npm install @tanstack/query-sync-storage-persister @tanstack/react-query-persist-client
```

```ts
// src/config/queryClient.ts

import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000, // DEBE ser >= maxAge del persister
      retry: 2,
      refetchOnWindowFocus: 'always',
      refetchOnMount: true,
      refetchOnReconnect: 'always',
    },
    mutations: { retry: 1 },
  },
});

const persister = createSyncStoragePersister({
  storage: window.localStorage, // TODO: reemplazar con wrapper IDB para PHI
  key: 'hhr-query-cache',
});

persistQueryClient({
  queryClient,
  persister,
  maxAge: 5 * 60 * 1000, // mismo valor que staleTime
  dehydrateOptions: {
    shouldDehydrateQuery: query => {
      const key = query.queryKey[0];
      // Whitelist de queries que es seguro persistir
      return key === 'dailyRecord' || key === 'existingDays' || key === 'staff';
    },
  },
});

export const clearQueryCache = (): void => {
  queryClient.clear();
  persister.removeClient(); // ← también limpiar persister
};
```

**Adicional — limpiar en logout** (en `AuthProvider` o equivalente):

```ts
const handleLogout = async () => {
  await signOut(firebaseAuth);
  clearRecentAuthenticatedSessionHint();
  clearQueryCache(); // ← llamar acá también
};
```

**Adicional — limpiar en session mismatch** (en `AuthProvider`):

```ts
React.useEffect(() => {
  if (auth.sessionState.status === 'unauthorized') {
    clearQueryCache();
  }
}, [auth.sessionState.status]);
```

**Ahorro**: `dailyRecord` resuelve en <10 ms en F5 dentro del staleTime → el
spinner interno prácticamente desaparece.

**⚠️ Riesgo alto — PHI**:

- Persistir datos clínicos en localStorage expone datos si el dispositivo es
  compartido.
- Mitigaciones obligatorias:
  - (a) Persistir en IndexedDB (no localStorage) usando un wrapper custom.
  - (b) Limpiar agresivamente en logout, session mismatch, y cambio de user.
  - (c) Considerar cifrado en reposo.
  - (d) Revisar `docs/FIREBASE_POLICY.md` del repo original antes.
- No persistir queries de admin ni auditoría (`dehydrateOptions.shouldDehydrateQuery`).

---

# Parte 7: Procedimiento de port paso a paso

Instrucciones para aplicar a la versión previa.

### Pre-flight check

1. Abrir el repo target y confirmar estructura base:

```bash
cd <target-repo>
ls src/                              # ¿existe?
ls src/app-shell/bootstrap/          # ¿existe? si no, crear.
ls src/components/ui/                # ¿existe InitialLoadingScreen?
ls src/services/auth/                # ¿existe authStorageHints?
cat package.json | grep -E "react|vite|firebase|tanstack|dexie"
```

2. Confirmar versiones compatibles:
   - React ≥ 18 (ideal: 19)
   - Vite ≥ 5 (ideal: 6)
   - `@tanstack/react-query` ≥ 5
   - Firebase ≥ 11 (ideal: 12)

3. Verificar que el target tiene:
   - `src/App.tsx` con un patrón similar (bootstrapState + providers).
   - `src/index.tsx` con `createRoot`.
   - `AuthContext` con un shape similar (ver sección 4.5 para campos esperados).
   - Algún hook tipo `useAppBootstrapState` o equivalente (puede tener otro nombre).

4. Hacer un **commit de seguridad** antes de empezar:

```bash
git checkout -b perf/bootstrap-refresh-optimizations
git add -A && git commit -m "snapshot: pre-bootstrap-perf-port baseline"
```

### Paso 1 — Crear `authenticatedRoutePreloadController.ts`

Ubicación: `src/app-shell/bootstrap/authenticatedRoutePreloadController.ts`.

Copiar el código de la sección 4.6.

**Ajuste**: verificar que el import `@/features/census/public-components` existe
en el target. Si no, reemplazar por el entry point real del feature de censo.

**Validación**:

```bash
npx tsc --noEmit | grep authenticatedRoute
# Debe salir vacío
```

### Paso 2 — Crear `BootstrapCensusChrome.tsx`

Ubicación: `src/app-shell/bootstrap/BootstrapCensusChrome.tsx`.

Copiar el código de la sección 4.5.

**Ajustes críticos**:

1. **Shape de `AuthContextType`**: revisar `src/context/AuthContext.tsx` del
   target y verificar que todos los campos del mock matchean. Si el target
   tiene campos adicionales, agregarlos con valores neutrales. Si faltan
   campos en el target, quitarlos del mock.

2. **Componentes `Navbar` y `DateStrip`**: verificar las props que aceptan
   en el target. Si difieren, ajustar los props noop del mock.

3. **`shouldRenderDateStrip`**: verificar que existe en el target. Si no,
   hardcodear `const renderDateStrip = bootstrapModule === 'CENSUS'` como
   aproximación.

**Validación**:

```bash
npx tsc --noEmit | grep BootstrapCensusChrome
# Debe salir vacío
```

### Paso 3 — Actualizar `appShellLoadingPolicy.ts`

Ubicación: `src/app-shell/bootstrap/appShellLoadingPolicy.ts`.

Reemplazar el contenido con el código de la sección 4.4.

**Ajustes**:

- Verificar que `resolveModuleFromPathname` existe en el controller del target.
  Si no, portarla también (sección 4.13).
- Verificar que `hasActiveFirebaseSession` existe. Si no, reemplazar por
  `() => false` inicialmente y portar después.

### Paso 4 — Actualizar `InitialLoadingScreen.tsx`

Ubicación: `src/components/ui/InitialLoadingScreen.tsx`.

La regla crítica es que `shouldRenderInitialLoadingScreen` retorne `false`:

```ts
export const shouldRenderInitialLoadingScreen = (_pathname: string | undefined): boolean => {
  return false;
};
```

Si el target tiene una versión más simple del componente, solo modificar esa
función. El resto del componente puede quedar intocado (es dead code).

### Paso 5 — Actualizar `src/index.tsx`

Ubicación: `src/index.tsx`.

Reemplazar con el código de la sección 4.2. Los cambios clave:

1. Importar `BootstrapRouteChrome` y `preloadAuthenticatedRouteChunk`.
2. `const appModulePromise = import('@/App')` ANTES de `bootstrapAppRuntime()`.
3. `renderBootstrapLoadingScreen` usa la decision extendida.

### Paso 6 — Actualizar `src/App.tsx`

Ubicación: `src/App.tsx`.

Reemplazar con el código de la sección 4.3.

**Ajustes**:

- Si el target no usa `VersionedAppShell`/`VersionMismatchOverlay`, eliminar
  esas envolturas.
- Si el target tiene providers distintos en `ProvidedApp`, mantener el orden
  del target pero asegurar que `QueryClientProvider` está arriba.

### Paso 7 — Actualizar `index.html`

Ubicación: root del repo.

Reemplazar con el código de la sección 4.1.

**Ajustes**:

- Cambiar la URL de `hhr-login-day.png` si el target tiene otra path para la
  imagen del login.
- Ajustar los `modulepreload` si el entry point del feature de censo tiene
  otro path.

### Paso 8 — (Opcional, recomendado) Aplicar Opt 6 (gate de censo)

Seguir la sección 6 / Opt 6 para gatear `useExistingDaysQuery` y `useCensusEmail`.

### Paso 9 — (Opcional, alto impacto) Aplicar Opt 7 (persist query cache)

Seguir la sección 6 / Opt 7. **Revisar políticas de PHI del proyecto antes**.

### Paso 10 — Build y smoke test

```bash
npm run build
npm run preview  # o equivalente
```

Abrir el preview, hacer:

- F5 en `/` → fondo ocean visible desde frame 1.
- Login con Google → transición sin flash.
- Navegar a `/census` → chrome visible inmediato.
- F5 en `/census` → skeleton chrome visible, luego datos.
- Navegar a `/nursing-handoff` → mismo comportamiento.
- F5 en `/nursing-handoff` → skeleton chrome visible, luego datos.
- Logout → fondo ocean, login visible.

---

# Parte 8: Validación y tests

### Tests unitarios que deben pasar

Ubicaciones en el repo de referencia:

```
src/tests/app-shell/appShellLoadingPolicy.test.ts
src/tests/app-shell/bootstrapRuntimeTelemetry.test.ts
src/tests/app-shell/bootstrapAppRuntime.test.ts
src/tests/components/InitialLoadingScreen.test.tsx
src/tests/components/AppLoadingBehavior.test.tsx
src/tests/components/index.bootstrap.test.tsx
```

Ejecutar en el target:

```bash
npx vitest run \
  src/tests/app-shell/appShellLoadingPolicy.test.ts \
  src/tests/components/InitialLoadingScreen.test.tsx \
  src/tests/components/AppLoadingBehavior.test.tsx \
  src/tests/components/index.bootstrap.test.tsx
```

Si algún test falla porque el target tiene un shape distinto, actualizar el
mock del test, no el código de producción.

### Test E2E crítico

`src/tests/e2e/census-persistence-reload.spec.ts` (o equivalente en el target):

```bash
npx playwright test census-persistence-reload
```

Verifica que F5 en `/census` preserva la data seleccionada y no hace flash.

### Checklist manual

Para cada ruta, abrir DevTools → Performance → grabar un F5 y verificar:

- [ ] F5 en `/` sin sesión → fondo ocean desde T=0 (no frames blancos)
- [ ] F5 en `/` con sesión persistida → bandas del chrome desde T=0
- [ ] F5 en `/census?date=YYYY-MM-DD` → chrome visible sin flash, skeleton → real invisible
- [ ] F5 en `/nursing-handoff?date=YYYY-MM-DD` → mismo que census
- [ ] F5 en `/medical-handoff?date=YYYY-MM-DD` → mismo que census
- [ ] F5 en `/transfer-management?date=YYYY-MM-DD` → mismo que census
- [ ] Logout → fondo ocean visible, login sobre él

### Métricas objetivo (Vite dev, localhost, hardware típico)

Con instrumentación (ver sección 11.3 para el snippet de `perfAudit`):

| Ruta                          | `bootstrap:start → app:first-render` | `auth-shell:mounted → daily-record:ready` |
| ----------------------------- | ------------------------------------ | ----------------------------------------- |
| `/` (login)                   | <500 ms                              | N/A                                       |
| `/census?date=…`              | <500 ms                              | <500 ms (con Opt 7: <50 ms)               |
| `/nursing-handoff?date=…`     | <500 ms                              | <500 ms                                   |
| `/medical-handoff?date=…`     | <500 ms                              | <500 ms                                   |
| `/transfer-management?date=…` | <500 ms                              | <500 ms                                   |

En producción (después de `vite build`), los números deberían ser 3–5× menores.

---

# Parte 9: Troubleshooting

### Síntoma 1: Flash blanco post-F5 en rutas autenticadas

**Causa probable**: el inline script de `index.html` no corrió, o `<body>` no
tiene `background: transparent`.

**Diagnóstico**:

```
DevTools → Elements → <html> → verificar que tiene dataset.prebootSurface="app"
DevTools → Elements → <html style=""> → verificar que backgroundImage está seteado
```

**Fix**:

1. Confirmar que el `<script>` inline está ANTES del `<link rel="stylesheet">`.
2. Confirmar que el `<body>` tiene `style="background: transparent"` inline
   (no solo en la clase).
3. Confirmar que no hay `overflow-x: hidden` en `<html>` (bloquea el render).

### Síntoma 2: Flash del fondo ocean en rutas de módulo

**Causa**: El inline script no detectó el hint de auth y asumió surface=login.

**Diagnóstico**:

```js
// DevTools Console
localStorage.length; // debería tener entradas firebase:authUser:*
Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter(k =>
  k.startsWith('firebase:authUser:')
);
sessionStorage.getItem('hhr_logged_this_session'); // 'true' si hay sesión activa
```

**Fix**:

- Si no hay entradas `firebase:authUser:*` → Firebase no persistió la sesión.
  Revisar la config de `setPersistence(browserLocalPersistence)` en el
  AuthProvider.
- Si hay entradas pero el script no las detectó → bug en `storageContainsPrefix`.

### Síntoma 3: Skeleton duplicado (flicker de dos renders)

**Causa**: El `BootstrapRouteChrome` en `index.tsx` (pre-React) y el de
`App.tsx` (runtime) son instancias distintas. React remonta.

**Diagnóstico**:

```js
// En DevTools React DevTools → Components → buscar BootstrapRouteChrome
// Si aparece dos veces en árboles distintos → instancias separadas
```

**Fix**: verificar que ambos lugares importan del mismo file path
(`@/app-shell/bootstrap/BootstrapCensusChrome`). No debe haber dos copias.

### Síntoma 4: Spinner interno dura >1 s en F5 repetido

**Causa**: React Query cache no persiste, todas las queries arrancan cold.

**Fix**: aplicar Opt 7 (sección 6).

### Síntoma 5: Transición skeleton → real visible como "salto"

**Causa**: El email en el skeleton (`bootstrap@hospital.cl`) no coincide con
el real del user.

**Fix**:

- Verificar que `readPersistedFirebaseAuthUser()` encuentra el user. Debug:
  ```js
  // DevTools Console, en la página
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('firebase:authUser:')) console.log(k, JSON.parse(localStorage.getItem(k)));
  }
  ```
- Si el JSON persistido no tiene `email`, Firebase lo está omitiendo. Revisar
  la config de persistencia.

### Síntoma 6: `ChunkLoadError` después del port

**Causa**: Vite build tiene chunks desincronizados con el HTML.

**Fix**:

```bash
rm -rf dist/ node_modules/.vite/
npm run build
```

### Síntoma 7: `AuthContext` mock no matchea tipos

**Causa**: el target tiene otra shape de `AuthContextType`.

**Fix**: abrir `src/context/AuthContext.tsx` del target, ver el tipo real, y
ajustar `buildBootstrapAuthContextValue` en `BootstrapCensusChrome.tsx`.

### Síntoma 8: `resolveModuleFromPathname` no existe en el target

**Causa**: el target no tiene `src/hooks/controllers/appStateNavigationController.ts`.

**Fix**: portar ese archivo también (sección 4.13). Ajustar el tipo
`ModuleType` al que use el target.

### Síntoma 9: `useAppBootstrapState` ya existe pero con otro shape

**Causa**: el target tiene una versión más simple (ej. solo `auth.isLoading`
sin phases).

**Fix**:

- Opción A: reemplazar con la versión de la sección 4.7.
- Opción B (menos invasivo): adaptar `appShellLoadingPolicy.ts` al shape del
  target, pero mantener la lógica `shouldRender: false` + `renderBootstrapRouteChrome`.

### Síntoma 10: Private browsing — inline script falla

**Causa**: `localStorage` lanza en incógnito en algunos browsers.

**Diagnóstico**: abrir la página en incógnito → DevTools Console → buscar
error.

**Fix**: verificar que `storageContainsPrefix` en el inline script tiene
`try/catch` adecuado (ver sección 4.1). Default: tratar como "sin sesión" →
`shouldUseLoginSurface = true`.

---

# Parte 10: Rollback

Si algo rompe:

```bash
# Revertir al snapshot pre-port
git reset --hard HEAD~N  # N = número de commits del port

# O solo revertir archivos específicos
git checkout HEAD~N -- \
  index.html \
  src/index.tsx \
  src/App.tsx \
  src/app-shell/bootstrap/appShellLoadingPolicy.ts \
  src/app-shell/bootstrap/BootstrapCensusChrome.tsx \
  src/app-shell/bootstrap/authenticatedRoutePreloadController.ts \
  src/components/ui/InitialLoadingScreen.tsx
```

Si solo falla Opt 7 (persist cache), revertir solo `src/config/queryClient.ts`
y cualquier call a `clearQueryCache` que se haya agregado.

---

# Parte 11: Apéndices

## 11.1 Dependencias de package.json relevantes

```json
{
  "dependencies": {
    "@tanstack/react-query": "^5.90.12",
    "dexie": "^4.2.1",
    "firebase": "^12.6.0",
    "lucide-react": "^0.556.0",
    "react": "^19.2.1",
    "react-dom": "^19.2.1"
  }
}
```

Para Opt 7:

```json
{
  "dependencies": {
    "@tanstack/query-sync-storage-persister": "^5.90.12",
    "@tanstack/react-query-persist-client": "^5.90.12"
  }
}
```

## 11.2 Path aliases (tsconfig.json + vite.config.ts)

`@/*` apunta a `src/*`. En `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

En `vite.config.ts`:

```ts
import path from 'path';
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

## 11.3 Instrumentación de performance (opcional, para medir el port)

Archivo: `src/shared/runtime/perfAudit.ts` (crear temporalmente):

```ts
/**
 * TEMPORARY performance audit hook. One-off instrumentation.
 */

type MarkEntry = { name: string; t: number };

const AUDIT_TAG = '[perf-audit]';
const FALLBACK_FLUSH_MS = 6000;

const supported = typeof performance !== 'undefined' && typeof performance.now === 'function';

const state: { marks: MarkEntry[]; start: number; reported: boolean; flushScheduled: boolean } = {
  marks: [],
  start: supported ? performance.now() : 0,
  reported: false,
  flushScheduled: false,
};

const ensureFallbackFlush = () => {
  if (state.flushScheduled || typeof window === 'undefined') return;
  state.flushScheduled = true;
  window.setTimeout(
    () => flushPerfReport(`fallback-timeout@${FALLBACK_FLUSH_MS}ms`),
    FALLBACK_FLUSH_MS
  );
};

export const markPerf = (name: string): void => {
  if (!supported) return;
  const t = performance.now();
  if (state.marks.some(m => m.name === name)) return;
  state.marks.push({ name, t });
  try {
    performance.mark(name);
  } catch {}
  ensureFallbackFlush();
};

export const flushPerfReport = (trigger: string): void => {
  if (state.reported || !supported) return;
  state.reported = true;

  const startAt = state.marks[0]?.t ?? state.start;
  const nav = (() => {
    try {
      const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      return entries[0];
    } catch {
      return undefined;
    }
  })();

  const lines: string[] = [];
  lines.push(`${AUDIT_TAG} ----- REPORT (trigger: ${trigger}) -----`);
  lines.push(`${AUDIT_TAG} path     : ${location.pathname}${location.search}`);
  if (nav) {
    lines.push(`${AUDIT_TAG} DCL      : ${nav.domContentLoadedEventEnd.toFixed(1)} ms`);
    lines.push(`${AUDIT_TAG} load     : ${nav.loadEventEnd.toFixed(1)} ms`);
  }
  lines.push(`${AUDIT_TAG} --- marks (ms since first mark) ---`);
  for (const m of state.marks) {
    lines.push(`${AUDIT_TAG} ${m.name.padEnd(34)} ${(m.t - startAt).toFixed(1).padStart(9)} ms`);
  }
  const byName = new Map(state.marks.map(m => [m.name, m.t]));
  const delta = (from: string, to: string, label: string) => {
    const a = byName.get(from);
    const b = byName.get(to);
    if (a == null || b == null) return;
    lines.push(
      `${AUDIT_TAG} ${label.padEnd(34)} ${(b - a).toFixed(1).padStart(9)} ms  (${from} → ${to})`
    );
  };
  lines.push(`${AUDIT_TAG} --- deltas (key phases) ---`);
  delta('bootstrap:start', 'bootstrap:runtime-ready', 'firebase+runtime bootstrap');
  delta('bootstrap:start', 'app-module:import-done', 'App.tsx chunk load');
  delta('bootstrap:runtime-ready', 'app:first-render', 'runtime→first React render');
  delta('app:first-render', 'auth:ready', 'first render→auth ready');
  delta('auth:ready', 'auth-shell:mounted', 'auth ready→shell mounted');
  delta('auth-shell:mounted', 'daily-record:ready', 'shell→daily record ready');
  delta('bootstrap:start', 'daily-record:ready', 'TOTAL boot→data ready');
  lines.push(`${AUDIT_TAG} ----- END REPORT -----`);

  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
};
```

Callsites (agregar con comentario `// PERF-AUDIT (temporary)` para fácil
remoción):

```ts
// src/index.tsx (arriba de todo)
import { markPerf } from '@/shared/runtime/perfAudit';
markPerf('bootstrap:start');

// dentro de renderApp, antes del import:
markPerf('app-module:import-start');
const { default: App } = await appModulePromise;
markPerf('app-module:import-done');

// en bootstrapAppRuntime().then:
markPerf('bootstrap:runtime-ready');
```

```tsx
// src/App.tsx dentro de function App():
import { markPerf } from '@/shared/runtime/perfAudit';
// ...
function App() {
  const bootstrapState = useAppBootstrapState();
  markPerf('app:first-render');
  React.useEffect(() => {
    if (bootstrapState.status === 'authenticated') markPerf('auth:ready');
  }, [bootstrapState.status]);
  // ...
}
```

```tsx
// src/app-shell/runtime/AuthenticatedAppShell.tsx
import { markPerf } from '@/shared/runtime/perfAudit';

export const AuthenticatedAppShell = ({ auth, dateNav }) => {
  React.useEffect(() => {
    markPerf('auth-shell:mounted');
  }, []);
  // ...
};
```

```tsx
// src/app-shell/runtime/useAuthenticatedAppRuntime.ts
import { flushPerfReport, markPerf } from '@/shared/runtime/perfAudit';

export const useAuthenticatedAppRuntime = ({ auth, dateNav }) => {
  const dailyRecordHook = useDailyRecord(/* ... */);
  const { record } = dailyRecordHook;

  React.useEffect(() => {
    if (record) {
      markPerf('daily-record:ready');
      flushPerfReport('daily-record:ready');
    }
  }, [record]);
  // ...
};
```

Después de medir, **remover**:

```bash
grep -rln "PERF-AUDIT\|perfAudit" src/
# borrar src/shared/runtime/perfAudit.ts
# quitar las ~8 líneas marcadas en los otros archivos
```

## 11.4 Glosario completo

| Término                     | Definición                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Chrome**                  | Navbar azul superior (56 px) + date-strip blanca (44 px). Las dos bandas fijas del shell autenticado.          |
| **Route chrome**            | El chrome + el content slot con su loader interno. Sin la vista todavía.                                       |
| **Shell**                   | `AuthenticatedAppShell` + `AppContent` — el árbol React envoltorio de todas las vistas autenticadas.           |
| **Bootstrap**               | Proceso desde F5 hasta primera render React.                                                                   |
| **Rehydrate**               | Caso donde Firebase Auth resuelve una sesión persistida en localStorage (no login nuevo).                      |
| **Auth hint**               | Valor en sessionStorage/localStorage que sugiere que había sesión previamente.                                 |
| **Pre-shell loader**        | El `InitialLoadingScreen` legacy fullscreen. **Debe estar deshabilitado**.                                     |
| **In-shell loader**         | Spinner `ViewLoader` que aparece dentro del content slot del shell, respeta las bandas.                        |
| **Skeleton**                | `BootstrapRouteChrome` — React component con Navbar + DateStrip reales y AuthContext mockeado.                 |
| **Session hint**            | `hhr_logged_this_session = 'true'` en sessionStorage. Vive hasta logout o cierre de tab.                       |
| **Persisted hint**          | Entrada `firebase:authUser:*` en localStorage. Vive más tiempo (hasta logout explícito).                       |
| **Active Firebase session** | `auth.currentUser` no null. Requiere Firebase inicializado.                                                    |
| **CENSUS route**            | Pathname `/census` (con o sin query). El único módulo que tiene preload de chunk dedicado.                     |
| **Module route**            | Cualquier pathname que resuelve a un `ModuleType` vía `resolveModuleFromPathname`.                             |
| **Daily record**            | Documento Firestore `dailyRecords/{YYYY-MM-DD}`. Datos base de todos los módulos (beds, patients, staffing).   |
| **Existing days**           | Array de números de día (1–31) que tienen datos en el mes actual. Solo censo muestra esto en el calendar grid. |

## 11.5 Archivos del repo que NO hay que tocar (pero son parte del contexto)

- `src/services/auth/authService.ts` — lógica real de login/logout. Solo leer si hay dudas del flujo.
- `src/hooks/useDailyRecord.ts` — hook shared. No portar cambios de acá al target a menos que haya un bug conocido.
- `src/features/census/public-components.ts` — entry point del chunk de censo. Verificar que existe en el target, ajustar el path del preload si cambia.
- `src/components/layout/Navbar.tsx` — componente real. No tocar — `BootstrapRouteChrome` lo consume.
- `src/components/layout/DateStrip.tsx` — componente real. No tocar.

## 11.6 Commits de referencia en el repo fuente

```
18d1717b Revert "fix: prevent authenticated chrome flash before login"
e13b947b fix: prevent authenticated chrome flash before login
c2fdd352 fix: preserve refresh loaders and login background
3f695379 fix: align census save action and preload census route
cc09869c fix: silence router lazy fallback spinner
```

Estos commits contienen la historia de decisiones que llevaron al diseño
actual. Revisar con `git log --all --oneline -- src/app-shell/bootstrap/` si
se necesita más contexto.

---

---

# Parte 12: Caso de estudio — por qué esta versión (base) se siente más lenta que "copia 14"

> **Contexto**: el desarrollador reporta que la versión **base**
> (`<checkout-hhr-tracker>`, puerto 3001)
> **se siente más lenta al F5 y al login** que la versión
> **copia 14** (`<checkout-hhr-tracker-copia-14>`,
> puerto 5173). Paradójicamente, **base tiene más optimizaciones implementadas**
> (las 5 documentadas en las Partes 4 y 5). Esta sección explica la paradoja y
> qué hacer al respecto.

## 12.1 Resumen ejecutivo

La paradoja se explica por una regla conocida de performance percibida:

> **Más trabajo durante el bootstrap ≠ mejor UX.** Si el trabajo extra produce
> transiciones visuales adicionales, la UI se siente más "inestable" aunque el
> tiempo total a "estado final" sea igual o menor.

Base hace **más cosas** entre T=0 y T=primera-vista-útil que copia 14:

- Ejecuta un boot script inline en HTML que lee storage y pinta bandas.
- Rendera un skeleton React (`<BootstrapRouteChrome/>`) con Navbar + DateStrip
  reales pero auth mockeado.
- Después rendera el shell real, que **reemplaza** el skeleton con una
  reconciliación que puede mostrar flicker de texto (email) o de estado
  (botones habilitados/deshabilitados).

Copia 14, al ser más simple, hace menos cosas y tiene **menos transiciones
visibles**. Aunque el tiempo total a "dato listo" puede ser similar o incluso
mayor, el **pacing** de copia 14 es más tranquilo.

## 12.2 Diff archivo por archivo (base vs copia 14)

| Archivo                                                          | base (port 3001)                                                                                                             | copia 14 (port 5173)                                                                                             |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `index.html`                                                     | 6.7 KB con boot script inline de ~130 líneas                                                                                 | 1.8 KB con `<style>` de slate-100                                                                                |
| `src/index.tsx`                                                  | `const appModulePromise = import('@/App')` paralelo con `bootstrapAppRuntime`; rendera `<BootstrapRouteChrome/>` si hay hint | `import('@/App')` sequential dentro de `renderApp()`; rendera `<InitialLoadingScreen/>` si `shouldRender` o nada |
| `src/App.tsx`                                                    | Tiene modo `'bootstrap-route-chrome'` que rendera el skeleton durante loading                                                | No tiene ese modo; devuelve `null` en `silent`                                                                   |
| `src/app-shell/bootstrap/appShellLoadingPolicy.ts`               | Puede retornar `'bootstrap-route-chrome'`                                                                                    | Solo retorna `'silent' / 'default' / 'login-shell'`                                                              |
| `src/app-shell/bootstrap/BootstrapCensusChrome.tsx`              | **Existe** (~250 líneas)                                                                                                     | **No existe**                                                                                                    |
| `src/app-shell/bootstrap/authenticatedRoutePreloadController.ts` | **Existe** (preload del chunk de censo)                                                                                      | **No existe**                                                                                                    |
| `src/components/ui/InitialLoadingScreen.tsx`                     | `shouldRenderInitialLoadingScreen` retorna `false` siempre                                                                   | Tiene allow-list: `false` para paths conocidos, `true` para desconocidos                                         |
| `src/app-shell/runtime/useAuthenticatedAppRuntime.ts`            | 4 hooks de censo sin gating                                                                                                  | **Idéntico** (mismo problema en ambas)                                                                           |
| `src/config/queryClient.ts`                                      | Sin persist                                                                                                                  | **Idéntico** (sin persist)                                                                                       |
| `src/app-shell/runtime/AuthenticatedAppShell.tsx`                | Igual shape                                                                                                                  | **Idéntico**                                                                                                     |

## 12.3 Por qué base se siente más lenta — 5 causas concretas

### Causa A — Double-render del chrome (la más importante)

**Secuencia en base**:

```
T=~70 ms : BootstrapRouteChrome monta
           → AuthContext mockeado con email "bootstrap@hospital.cl" o el persistido
           → Navbar real con userEmail provisional
           → DateStrip real con callbacks noop
           → <main> con ViewLoader dentro
T=~450 ms: bootstrapAppRuntime resuelve + App chunk listo
T=~470 ms: AuthenticatedAppShell monta
           → AuthProvider emite auth real
           → CensusProvider emite censusContextValue real
           → Navbar RE-rendera con userEmail real (puede diferir del mockeado)
           → DateStrip RE-rendera con callbacks reales (botones pasan de deshabilitados a habilitados)
           → Content area RE-rendera con AppRouter + vista
```

Entre T=~70 y T=~470 el usuario ve el navbar CON UN EMAIL. En T=~470 ese
email puede cambiar. Aunque sea sutil, **el ojo lo registra como "parpadeo"**.
Si el email no persistido o es distinto del mock, el flash es más evidente.

**Secuencia en copia 14**:

```
T=~70 ms : (nada — App.tsx retorna null durante 'silent' loading)
T=~450 ms: bootstrapAppRuntime resuelve + App chunk listo
T=~470 ms: AuthenticatedAppShell monta
           → Navbar rendera UNA SOLA VEZ con el user real
           → DateStrip rendera UNA SOLA VEZ con callbacks reales
```

Un solo render. **No hay flicker**. Aunque la espera es ~450 ms contra
~70 ms, el usuario ve un slate-100 estable, no un chrome que "se está
poniendo bien" con cambios visibles.

**Mitigación**: hacer que el skeleton de base matchee 1:1 el render real.
Esto requiere:

- Email persistido siempre disponible (que Firebase lo escriba correctamente).
- Mismos callbacks "visibles" (nombres y íconos de botones no cambian).
- `remoteSyncStatus = 'ready'` en mock (ya está).

### Causa B — Costo del render del skeleton

`BootstrapRouteChrome` importa **componentes reales y pesados**:

```ts
import { DateStrip } from '@/components/layout/DateStrip';
import { Navbar } from '@/components/layout/Navbar';
```

Estos arrastran **iconos Lucide**, **sub-componentes** (dropdowns, menús,
indicators de runtime), y **contextos**. En Vite dev, cada import es una
request separada. En producción, están en el mismo chunk que App.tsx igual
— no hay ahorro real de chunk download.

Durante el skeleton mount:

- React instancia `Navbar` y `DateStrip` (~10–50 ms).
- Tailwind aplica clases (~5 ms).
- Lucide renderea ~10–20 SVGs (cada uno ~1 ms en cold render).

Total extra **vs copia 14**: ~30–80 ms de CPU en el bootstrap.

Copia 14 evita todo ese costo porque retorna `null` hasta tener la auth real
y entonces mueve toda esa renderización al paso final.

### Causa C — Boot script inline añade parse time

El `<script>` de 130 líneas en `index.html` es parsed y ejecutado
sincrónicamente **antes** de `<link rel="stylesheet">`. Costo:

- Parse del JS (~2 ms).
- Iteración de `localStorage` / `sessionStorage` (depende de la cantidad de
  entradas; puede ser 10–30 ms si hay decenas de claves).
- Seteo de `documentElement.style.background*` con 3 gradients (~2 ms).
- `appendModulePreload` × 1–2 (creación + append de `<link>` al `<head>`, ~1 ms).

Total: **~15–35 ms más** que copia 14 (que solo tiene un `<style>` sin JS).

Estos 15–35 ms están en el camino crítico del primer paint. Copia 14 paintea
su background slate-100 inmediatamente con el inline CSS, sin esperar JS.

### Causa D — Contención de CPU por imports paralelos

Base dispara en paralelo:

```ts
// src/index.tsx
void preloadAuthenticatedRouteChunk({ pathname });  // fire-and-forget
const appModulePromise = import('@/App');
bootstrapAppRuntime()...
```

En dev (Vite), esto resulta en **cientos de requests simultáneos** de módulos
transformados. En devices menos potentes o con throttling de browser (red
limitada, CPU saturada), la contención puede ralentizar cada request
individualmente.

Copia 14 no tiene preload. Solo un `import('@/App')` dentro de `renderApp`
**después** de que `bootstrapAppRuntime` resuelve. Menos contención.

En **producción** (`vite build`), los chunks están consolidados — esta causa
desaparece casi completamente. Pero en **dev mode**, que es donde el
desarrollador está midiendo, afecta.

### Causa E — Expectativa cognitiva

Este es el factor no-técnico más importante:

- Con **copia 14**, el usuario ve slate-100 plano durante ~450 ms y **sabe
  que está cargando**. No tiene expectativas.
- Con **base**, el usuario ve **el chrome desde T=10 ms** (gradient inline).
  Su cerebro registra "la app ya arrancó". Pero después tarda 400–800 ms en
  aparecer la data. Esa espera, **con la app aparentemente "lista"**, se
  siente más larga que los mismos 400 ms con un slate-100 plano donde el
  cerebro acepta que todavía está cargando.

Es el mismo fenómeno que una app con skeleton screens: **el usuario espera
menos pero se frustra más** si el skeleton persiste más de ~300 ms.

## 12.4 Measurement data disponible

Medido en Vite dev con instrumentación `perfAudit` (Parte 11.3):

| Métrica                                       | copia 14 (sin auth, F5 en `/`) | base (no medido aún)                                                                |
| --------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------- |
| `bootstrap:start` → `bootstrap:runtime-ready` | 31 ms (Firebase sin sesión)    | ~30–80 ms (estimado)                                                                |
| `bootstrap:start` → `app-module:import-done`  | 451 ms                         | ~350–500 ms estimado (con paralelo + preload el costo se solapa pero no desaparece) |
| First Contentful Paint                        | 492 ms                         | ~50 ms estimado (inline background)                                                 |
| `app:first-render`                            | 462 ms                         | ~150 ms estimado (BootstrapRouteChrome)                                             |

**Nota**: los números de base son estimaciones. Para confirmar, aplicar la
misma instrumentación de Parte 11.3 en base y hacer F5 en las mismas rutas.

## 12.5 Qué hacer — decisión recomendada

Hay tres caminos, según cuánto tiempo/riesgo quieras invertir:

### Opción 1 — Quedarse con copia 14 (solución más rápida)

Si el objetivo es "que no se sienta lenta", copia 14 ya está razonablemente
bien. Portarle **solo** las siguientes cosas de base (que no causan
double-render):

- **Inline `<style>` más agresivo** (que copia 14 ya tiene con slate-100 plano).
- **Gate de hooks de censo por módulo** (Opt 6 de Parte 6) — bajo riesgo,
  ~50–200 ms de ahorro en rutas no-censo.
- **Persist React Query cache** (Opt 7 de Parte 6) — alto impacto, evaluar
  compliance PHI.

**No portar** de base:

- `BootstrapRouteChrome` (causa el double-render).
- Inline boot script JS (añade parse time y riesgo en private browsing).

### Opción 2 — Mejorar base (arreglar los 5 síntomas de 12.3)

Mantener la arquitectura de base pero eliminar los costos:

1. **Eliminar el double-render**: modificar `BootstrapRouteChrome` para que
   matchee **exactamente** el primer render de `AuthenticatedAppShell`. Lograr
   transición invisible requiere:
   - Mismo email (ya existe — `readPersistedFirebaseAuthUser`).
   - Misma shape de `AuthContext` (ya existe).
   - Mismos estilos/layout en Navbar y DateStrip cuando `isLoading: true`
     (probar: algunos sub-componentes se esconden con `isLoading`, crean
     layout shift).
2. **Reducir costo del skeleton**: lazy-load Navbar y DateStrip en
   `BootstrapRouteChrome` y mostrar solo las bandas CSS hasta que React
   termine. Esto contradice el propósito del skeleton, pero es una vía.
3. **Simplificar el boot script**: eliminar la iteración completa de
   `localStorage`, usar solo `sessionStorage.getItem(AUTHENTICATED_SESSION_HINT_KEY)`
   para decidir surface. Ahorra 5–20 ms.
4. **Condicional el preload**: solo preloadear si el usuario está autenticado
   (ya lo hace, pero verificar que no hay overlap con `import('@/App')`).
5. **Medir empíricamente** con la instrumentación de Parte 11.3 antes y
   después de cada cambio.

### Opción 3 — Híbrido (recomendada)

Portar a base las **2 optimizaciones adicionales** (Opt 6 y Opt 7) + arreglar
el **double-render** (Causa A de 12.3):

- Opt 6 ahorra 50–200 ms en rutas no-censo.
- Opt 7 ahorra 200–500 ms en F5 dentro del staleTime (gigante, pero revisar PHI).
- Fix double-render elimina el flicker que hace sentir base "rara".

Con estos tres cambios, base debería sentirse **más rápida** que copia 14
(porque conserva el first-paint del chrome + primer skeleton inmediato pero
sin la penalidad del flicker).

## 12.6 Mapeo al procedimiento de port (Parte 7)

Si la otra IA va a portar optimizaciones a una **tercera versión** aún más
vieja que copia 14, el orden de prioridad cambia según qué sensación se busque:

**Prioridad A — Experiencia estable (copia 14-like)**:

1. Aplicar Parte 7 Pasos 4 y 5 (deshabilitar legacy fullscreen loader, parallel
   App import).
2. Agregar inline `<style>` de `html, body, #root { background: #f1f5f9 }`
   en `index.html` (ver el commit `125789ab` de copia 14).
3. Aplicar Opt 6 (Parte 6 — gate de censo).
4. Aplicar Opt 7 (Parte 6 — persist query cache) si PHI lo permite.
5. **Saltar** el BootstrapRouteChrome inicialmente.

**Prioridad B — First paint agresivo (base-like, arreglado)**:

1. Todos los pasos de Prioridad A.
2. Agregar inline boot script de `index.html` (Parte 4.1) — si el usuario
   acepta el parse overhead.
3. Agregar `BootstrapRouteChrome` (Parte 4.5) **pero**:
   - Garantizar que `readPersistedFirebaseAuthUser` recupera el email.
   - Desactivar features de Navbar que hagan layout shift cuando
     `isLoading: true` (lista de notificaciones, runtime indicators, etc.).
4. Agregar `authenticatedRoutePreloadController` (Parte 4.6) — solo si hay
   chunk grande claramente identificado.

**Recomendación para la otra IA**: empezar por Prioridad A. Medir con
`perfAudit`. Si los números aún son malos, subir a Prioridad B.

## 12.7 Cómo confirmar empíricamente

1. Aplicar la instrumentación de Parte 11.3 en **ambas** versiones (base y
   copia 14).
2. Abrir cada una en un browser limpio (incógnito o hard reload).
3. Login normal con Google.
4. Navegar a `/census?date=2026-02-20`, F5, copiar report de consola.
5. Lo mismo en `/nursing-handoff?date=2026-02-20`.
6. Comparar side-by-side las siguientes deltas:

| Delta                                      | Qué valida                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `bootstrap:start → app-module:import-done` | Si el parallel import ayuda                                                 |
| `auth-shell:mounted → daily-record:ready`  | Si el costo de datos es igual (debería, ambas usan useDailyRecord idéntico) |
| `bootstrap:start → auth-shell:mounted`     | Costo total del bootstrap + render del shell                                |
| `auth-shell:mounted → router:view-mounted` | Costo del render final + reconciliación del skeleton                        |

Si `bootstrap:start → auth-shell:mounted` es **menor en copia 14** que en
base, confirma Causa B (skeleton cost). Si es **similar pero el usuario
igual percibe lentitud**, confirma Causa E (expectativa cognitiva).

---

**Conclusión**: base tiene mejor arquitectura de arranque **en teoría**, pero
en la práctica el double-render y el costo del skeleton la hacen **sentir
más lenta** que copia 14 para el F5 autenticado. Para optimizar la versión
target que la otra IA va a tocar, **no portar ciegamente todo base** —
seleccionar según la Prioridad A o B según tolerancia del equipo al trade-off
entre first-paint agresivo y pacing estable.

---

**Fin del playbook.**

_Generado desde `HHR 2026 tracker versión MacBookAir` — código estáticamente
analizado + runtime instrumentado con `performance.mark()`. Revisar el repo
fuente como ground truth si algo no compila después del port._

## Build environment and startup size

Compare the same commit, lockfile, Node version and environment profile before
attributing a bundle-size change to code. A normal local build reads personal
dotenv files; CI has no such files. Never include their values in reports.

Client configuration readers must use explicit `import.meta.env.VITE_*` accesses.
Reading the whole object makes Vite embed unrelated settings in that consumer,
including optional feature configuration that belongs outside startup. Keep the
validator schema and legacy Firebase safety checks intact when narrowing reads.

On the 2026-10-03 baseline (`a303c302`), identical local dependencies produced a
630,040-byte authenticated shell with the local environment versus 627,734 bytes
without dotenv. Narrowing the two full-object readers reduced the configured
local shell to 629,561 bytes, below the unchanged 630,000-byte limit. This measures
bundle bytes, not a demonstrated improvement in user-visible startup latency.

The focused regression check compiles the real configuration readers with Vite,
without personal dotenv files or the application build configuration:

```sh
npx vitest run src/tests/build/clientEnvironmentBundle.test.ts
```

It preserves both reader entry points, asserts that their synthetic consumed
settings remain in the output, and rejects an unrelated synthetic setting. This
protects against accidental whole-environment serialization without snapshots of
configuration values, another CI job, or a full application build per test. The
existing unit suite discovers it automatically. Continue to use the full build
budget and flow-performance gates for bundle size and user-visible timings;
this narrow regression check does not replace either one.
