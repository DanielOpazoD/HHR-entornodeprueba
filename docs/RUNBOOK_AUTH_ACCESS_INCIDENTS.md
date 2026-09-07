# Runbook Auth Access Incidents

## Objetivo

### Limpieza de sesión pendiente

`session_cleanup_failed` indica que no se confirmó la limpieza completa. Comprobar
si el navegador permite Web Storage/IndexedDB y si hay otra pestaña completando
el cierre. No borrar manualmente todos los almacenes para resolver una espera:
podrían pertenecer a una sesión posterior. Restaurar el acceso al almacenamiento
y reintentar el ingreso; la admisión vuelve a comprobar la limpieza pendiente.
`auth/session-storage-cleanup-failed` mantiene el censo sin usuario autorizado
hasta que esa preparación se complete. No es una revocación de permisos.

Resolver rápido incidentes donde un usuario:

- debería poder entrar y no puede;
- fue removido y todavía entra;
- ve diferencias entre `localhost` y Netlify;
- entra al login pero no materializa shell.

## Fuente canónica

Antes de depurar, tomar como fuente de verdad:

- [Auth Access Model](./AUTH_ACCESS_MODEL.md)

No usar como referencia primaria:

- documentación generada antigua;
- comentarios legacy sobre `whitelist`;
- claims históricos como evidencia suficiente de acceso.

## Recovery administrativo

No existe ya una allowlist hardcoded de bootstrap admin.

Si se perdió acceso administrativo, la recuperación válida es:

- restaurar el correo correcto en `config/roles` con rol `admin`
- forzar re-login o `syncCurrentUserRoleClaim`
- verificar que `checkUserRole` y el claim resuelto converjan

## Caso 1: el correo está en Gestión de Roles pero no puede entrar

1. revisar `config/roles` y confirmar:
   - email exacto;
   - sin espacios;
   - rol válido.
2. validar que el frontend publicado use el flujo actual:
   - popup Google;
   - callable `checkUserRole`;
   - rechazo con `signOut` si no hay rol.
3. validar que las Functions publicadas correspondan al mismo modelo:
   - `checkUserRole` debe consultar `config/roles`;
   - no debe depender de listas legacy para login general.
4. si el correo viene de una migración antigua:
   - abrir Gestión de Roles;
   - usar `Actualizar Lista` para forzar recanonización de aliases legacy;
   - confirmar si aparece un aviso de normalización/sync.
5. revisar consola/red:
   - error en callable `checkUserRole`;
   - CSP bloqueando Cloud Functions;
   - build viejo en Netlify.
   - `/.netlify/functions/firebase-config` respondiendo `500` o con campos faltantes (`apiKey`, `projectId`, `appId`).
6. si en localhost funciona y en Netlify no:
   - redeploy frontend;
   - redeploy functions si cambió backend auth;
   - recarga dura una vez.

Chequeo operativo adicional:

- revisar `authRuntimeSnapshot` si el shell no aparece:
  - `budgetProfile`
  - `pendingAgeMs`
  - `runtimeState`
- si `runtimeState = recoverable`, priorizar redirect/popup pendiente antes de asumir fallo duro.
- si `runtimeState = unauthorized`, revisar rol/configuracion antes de depurar bootstrap.

## Caso 2: el correo fue removido pero todavía entra

1. confirmar que el correo ya no exista en `config/roles`;
2. confirmar que el callable publicado ya resuelva `null` o `unauthorized`;
3. confirmar que el frontend publicado ya haga `signOut` en usuarios sin rol;
4. abrir Gestión de Roles y usar `Actualizar Lista` para forzar recanonización/sync si hubo aliases legacy recientes;
5. cerrar sesión y volver a entrar;
6. si persiste, revisar si la sesión actual está rehidratando desde un build viejo.
7. confirmar que el logout manual limpió también estado sensible local:
   - ownership de la cola de sync;
   - cache clínica de sesión;
   - marcas de sesión reciente.

## Caso 3: el usuario entra a Google pero vuelve al login con “Acceso no autorizado”

1. confirmar que el correo autenticado sea exactamente el esperado;
2. revisar si el rol está asignado en `config/roles`;
3. revisar si el rol pertenece al login general:
   - `admin`
   - `nurse_hospital`
   - `doctor_urgency`
   - `doctor_specialist`
   - `viewer`
   - `editor`

## Caso 4: localhost funciona y Netlify no

1. comparar build/local vs deploy actual;
2. revisar `netlify.toml` si hay síntomas de CSP o popup Google;
3. verificar que Netlify esté sirviendo un frontend con el flujo nuevo;
4. verificar que `/.netlify/functions/firebase-config` responda `200` con `apiKey`, `projectId` y `appId`;
5. si la consola muestra `SW-Kill` o hay registro histórico de `/sw.js`, confirmar que el cliente recargó una vez para retirar el Service Worker legacy.
6. si incógnito funciona pero una sesión vieja tarda en autenticarse, revisar telemetría y consola para confirmar que el bootstrap alcanzó:
   - `redirect_resolution`
   - `current_session_resolution`
     antes de depender del observer continuo de auth.
7. revisar si `VersionContext` marcó:
   - `new_build_available`
   - `runtime_contract_mismatch`
   - `schema_ahead_of_client`
     Si hay mismatch real, no insistir con la sesión vieja: la acción correcta es actualización/recarga segura.

## Caso 4.1: el usuario entra al shell, pero `LAB` o `MMRAD` devuelven `Access denied for role 'unauthorized'`

Este caso ya no debe tratarse como problema genérico de `config/roles` hasta verificar convergencia.

Orden correcto de revisión:

1. confirmar que el correo esté presente en `config/roles`
2. confirmar que el shell efectivamente entró con ese mismo correo
3. confirmar que la Netlify Function esté usando la ruta canónica:
   - `netlify/functions/lib/firebase-auth.ts`
   - callable `checkUserRole`
4. no asumir que un `403 unauthorized` implica ausencia del correo en `config/roles`
5. si Netlify auth volvió a leer Firestore por una vía paralela, tratarlo como regresión de arquitectura y no como incidente operativo menor

Señal de regresión típica:

- shell entra;
- `config/roles` está correcto;
- `LAB/MMRAD` responden `unauthorized`;
- y `netlify/functions/lib/firebase-auth.ts` ya no usa el callable canónico.

## Caso 5: tras `F5` no vuelve a la misma vista funcional

1. validar que la URL conserve al menos:
   - `module`
   - `date`
2. si falta `module`, revisar shell/navigation state.
3. si falta `date`, revisar `useDateNavigation`.
4. si la sesión ya no es válida, el comportamiento esperado es volver a login, no restaurar shell.
5. si la app quedó bloqueada por mismatch de runtime/schema, tratarlo como incidente de versión, no de navegación.

## Señales esperadas del sistema sano

- usuario autorizado:
  - entra;
  - materializa shell;
  - recibe el rol correcto.
- usuario no autorizado:
  - no entra;
  - no ve navbar;
  - vuelve al login con error visible.
- usuario removido:
  - no rehidrata shell al recargar.

## Gate para retirar el alias legacy del viewer

Antes de eliminar la compatibilidad del alias legacy en functions o rules:

1. ejecutar `cd functions && npm run audit:legacy-viewer-alias`
   - requiere credenciales de Firebase Admin y `GOOGLE_CLOUD_PROJECT` resoluble
2. revisar `reports/auth-legacy-viewer-alias-audit.md`
3. confirmar que:
   - `configRolesLegacyCount = 0`
   - `authClaimsLegacyCount = 0`
4. solo entonces recortar:
   - `functions/lib/auth/authHelpersFactory.js`
   - `netlify/functions/lib/firebase-auth.ts`
   - `firestore.rules`
   - `storage.rules`

## Archivos clave

- [src/services/auth/authPolicy.ts](../src/services/auth/authPolicy.ts)
- [src/services/auth/authAccessResolution.ts](../src/services/auth/authAccessResolution.ts)
- [src/services/auth/authSession.ts](../src/services/auth/authSession.ts)
- [src/services/auth/authRoleLookup.ts](../src/services/auth/authRoleLookup.ts)
- [functions/lib/auth/authFunctionsFactory.js](../functions/lib/auth/authFunctionsFactory.js)
- [functions/lib/auth/authHelpersFactory.js](../functions/lib/auth/authHelpersFactory.js)
- [netlify/functions/lib/firebase-auth.ts](../netlify/functions/lib/firebase-auth.ts)
- [docs/architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md](./architecture/NETLIFY_AUTH_ROLE_CONVERGENCE.md)
