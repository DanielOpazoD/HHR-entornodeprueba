# Netlify Auth Role Convergence

## Objetivo

Documentar la arquitectura que mantiene alineados:

- el login general del shell;
- las Netlify Functions sensibles de `LAB` y `MMRAD`;
- la fuente canónica de roles en `config/roles`.

Este documento existe para evitar que futuros refactors vuelvan a introducir una deriva donde el usuario entra al shell, pero `syslab-proxy` o `mmrad-search` lo rechazan como `unauthorized`.

## Regla canónica

La fuente de verdad del rol sigue siendo:

- `config/roles` en Firestore

La ruta canónica para resolver ese rol es:

- callable Firebase `checkUserRole`

No es canónico para Netlify Functions:

- leer `config/roles` con un cliente Firestore web desde el runtime de Netlify;
- depender de claims como fuente primaria;
- duplicar reglas de acceso con otra semántica;
- introducir allowlists nuevas en frontend o serverless.

## Incidente que fija este contrato

El incidente que motivó esta arquitectura fue concreto:

- `daniel.opazo@hospitalhangaroa.cl` existía en `config/roles` como `admin`;
- el shell autenticaba correctamente;
- `LAB` y `MMRAD` devolvían `403 Access denied for role 'unauthorized'`.

La causa no era el dato en `config/roles`, sino una divergencia:

- login general resolvía rol por `checkUserRole`;
- Netlify Functions intentaban resolver rol por una lectura interna separada;
- al fallar esa lectura, degradaban a `unauthorized`.

## Arquitectura vigente

### Login general

```text
Google / Firebase Auth
  -> frontend obtiene sesión
  -> frontend llama callable checkUserRole
  -> Firebase Functions consulta config/roles
  -> shell entra o hace signOut
```

### LAB y MMRAD

```text
Browser obtiene Firebase ID token
  -> Bearer token a Netlify Function
  -> Netlify verifica firma / issuer / audience del token
  -> Netlify llama server-side al callable checkUserRole
  -> callable consulta config/roles
  -> Netlify valida allowedRoles del endpoint
  -> endpoint permite o rechaza
```

## Invariantes

Estos puntos no deben romperse:

1. `checkUserRole` es la ruta canónica para rol efectivo de usuario.
2. `config/roles` sigue siendo la fuente de verdad.
3. Netlify Functions sensibles no deben usar una ruta de resolución con semántica distinta al shell.
4. Claims pueden sincronizarse por performance o ergonomía, pero no deben volver a ser la fuente primaria de autorización de `LAB/MMRAD`.
5. Los aliases legacy de rol (como `viewer_census`) fueron retirados; solo se aceptan roles canónicos.

## Implementación actual

Piezas clave:

- [netlify/functions/lib/firebase-auth.ts](../../netlify/functions/lib/firebase-auth.ts)
  - verifica el bearer token Firebase
  - construye la URL HTTPS callable de `checkUserRole`
  - usa esa respuesta como rol canónico
- [functions/lib/auth/authFunctionsFactory.js](../../functions/lib/auth/authFunctionsFactory.js)
  - expone `checkUserRole`
- [functions/lib/auth/authHelpersFactory.js](../../functions/lib/auth/authHelpersFactory.js)
  - consulta `config/roles`
- [netlify/functions/syslab-proxy.ts](../../netlify/functions/syslab-proxy.ts)
- [netlify/functions/mmrad-search.ts](../../netlify/functions/mmrad-search.ts)

## Allowed roles actuales

`LAB` y `MMRAD` aceptan:

- `admin`
- `nurse_hospital`
- `doctor_urgency`
- `doctor_specialist`
- `editor`
- `viewer`

Eso abre consulta para cualquier usuario autorizado por `config/roles`, pero no cambia permisos sensibles fuera de lectura.

## Cambios que no deben hacerse

Evitar estos cambios salvo rediseño explícito:

- volver a `getDoc(doc(db, 'config', 'roles'))` como fuente primaria dentro de Netlify auth;
- usar `allowedUsers` como fallback operativo de `LAB/MMRAD`;
- reintroducir listas hardcodeadas por correo para recuperar acceso;
- mover la decisión de rol a UI local;
- autorizar `LAB/MMRAD` solo por claim stale sin convergencia con backend.

## Qué revisar si esto vuelve a fallar

1. abrir [docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md](../RUNBOOK_AUTH_ACCESS_INCIDENTS.md)
2. confirmar que el correo exista en `config/roles`
3. confirmar que el shell resuelva rol por `checkUserRole`
4. confirmar que `netlify/functions/lib/firebase-auth.ts` siga llamando al callable canónico
5. confirmar que el proyecto/region de Firebase usado por Netlify correspondan al entorno correcto

## Validación mínima al tocar auth Netlify

Antes de dar por bueno cualquier refactor en esta zona:

```bash
npx vitest run src/tests/netlify/firebaseAuth.test.ts
npx vitest run src/tests/netlify/syslabProxy.test.ts src/tests/netlify/mmradSearch.test.ts
npm run typecheck
```

Validación manual local:

1. correr `netlify dev`
2. abrir `http://localhost:8888/`
3. iniciar sesión con un correo presente en `config/roles`
4. confirmar que `LAB` y `MMRAD` no devuelvan `unauthorized`

## Referencias

- [docs/AUTH_ACCESS_MODEL.md](../AUTH_ACCESS_MODEL.md)
- [docs/RUNBOOK_AUTH_ACCESS_INCIDENTS.md](../RUNBOOK_AUTH_ACCESS_INCIDENTS.md)
- [docs/SERVERLESS_SENSITIVE_CONTRACTS.md](../SERVERLESS_SENSITIVE_CONTRACTS.md)
