# Production Dependency Acceptance

## Objetivo

Hacer explícita la deuda residual de dependencias productivas para que no quede como riesgo implícito ni como presión para hacer upgrades mayores sin validación.

## Estado actual

- Workspaces afectados: root app y `functions`
- Severidad blocking del gate: `high`, `critical`
- Estado actual esperado root app: `0 high`, `0 critical`, `2 moderate`
- Estado actual esperado `functions`: `0 high`, `0 critical`, `6 low`, `6 moderate`
- Fuente canónica: `reports/security/dependency-audit.md`

## Corrección cerrada: `basic-ftp`

El advisory sobre `basic-ftp <=5.3.0` queda cerrado mediante override a `basic-ftp@5.3.1` tanto en root app como en `functions`.

Motivo de la versión elegida:

1. `5.3.1` es el menor upgrade que sale del rango vulnerable observado.
2. Mantiene compatibilidad semver de patch sobre el árbol actual.
3. Evita un salto mayor a `6.x` sin evidencia de necesidad clínica u operacional.
4. El cierre se valida con `npm run check:dependency-vulnerabilities`, manteniendo `0 high` y `0 critical`.

## Paquetes residuales aceptados temporalmente

Los hallazgos residuales actuales vienen de dos familias:

1. árbol `firebase-admin` / `firebase-functions`, donde varias remediaciones sugeridas implican upgrades mayores o cambios transitivos no transparentes;
2. paquetes transitivos con fixes puntuales disponibles (`ip-address`, `follow-redirects`, `uuid`) que deben reevaluarse como cambio separado, porque forzar overrides transitivos sin prueba de runtime serverless puede ser más riesgoso que mantenerlos bajo gate mientras no sean `high` o `critical`.

Paquetes residuales principales:

- `firebase-admin`
- `firebase-functions`
- `@google-cloud/firestore`
- `@google-cloud/storage`
- `@tootallnate/once`
- `fast-xml-parser`
- `follow-redirects`
- `google-gax`
- `http-proxy-agent`
- `ip-address`
- `retry-request`
- `teeny-request`
- `uuid`

## Motivo de aceptación temporal

1. No hay vulnerabilidades `high` o `critical` abiertas en root app ni en `functions`.
2. La remediación `basic-ftp` ya se hizo con patch mínimo y no requiere salto mayor.
3. Varias remediaciones restantes sugeridas por `npm audit` caen en upgrades mayores o cambios de árbol que no son transparentes para el runtime serverless actual.
4. Forzar overrides adicionales sobre dependencias transitivas de Firebase/Google Cloud sin una ventana de validación amplia agrega más riesgo operativo del que reduce.

## Qué sí se exige mientras esta aceptación siga activa

- `npm run check:dependency-vulnerabilities` debe seguir en `ok`.
- No se aceptan regresiones a `high` o `critical`.
- No se aceptan nuevos hallazgos directos fuera del árbol actual sin revisarlos en la misma change.
- Los paquetes residuales con `fixAvailable: true` deben revisarse en un bloque de seguridad separado con tests de functions y gate de release, no como override oportunista.
- Cualquier upgrade de `firebase-admin` o `firebase-functions` debe reevaluar esta aceptación.

## Disparadores de reevaluación

Revisar esta aceptación cuando ocurra cualquiera de estos eventos:

1. upgrade de `firebase-admin`
2. upgrade de `firebase-functions`
3. cambio de runtime Node de `functions`
4. cambio de provider o adapters serverless críticos
5. aumento del conteo `low` o `moderate`
6. aparición de fix no-major y de bajo riesgo en el árbol actual

## Qué no hacer

- No forzar `overrides` transitivos incompatibles solo para bajar el contador.
- No cambiar majors del stack Firebase/Google Cloud sin validación específica de functions.
- No considerar estos hallazgos residuales como "resueltos" mientras sigan apareciendo en `dependency-audit`.

## Criterio de cierre

Esta deuda se puede cerrar cuando ocurra al menos una de estas dos condiciones:

1. root app y `functions` quedan sin hallazgos productivos residuales sin introducir upgrades inseguros;
2. el stack serverless migra a versiones nuevas validadas y los hallazgos residuales dejan de existir.

## Parche de seguridad: `brace-expansion` (30-09-2026)

- Owner: mantenimiento HHR (Daniel Opazo).
- Reason: la auditoría blocking encontró agotamiento de pila en `brace-expansion`,
  propagado a `minimatch` y `glob` (GHSA-6j4f-fj2g-mc7p y GHSA-qhr7-859c-m2p7).
  También se evita el rango de consumo cuadrático de CPU de GHSA-q2hr-2g5m-vwhr.
- TargetVersion: root conserva cada major existente con parches `1.1.21`, `2.1.7`
  y `5.0.12`; functions usa `2.1.7` en su override ya existente.
- RiskLevel: bajo; no se cambian dependencias directas, APIs ni reglas clínicas.
  El hallazgo prueba una dependencia vulnerable; no prueba explotación en HHR.
- RollbackPlan: revertir este PR completo, incluidos ambos manifests y lockfiles.
  Eso reabre la vulnerabilidad y debe bloquear nuevos merges hasta remediarla.
- VerificationGate: `npm run check:dependency-vulnerabilities` en ambos árboles,
  `npm run ci:merge-gate` y el control remoto de functions. Los umbrales de seguridad
  permanecen intactos. Cierre: cero high/critical y controles de compatibilidad verdes.
- Clasificación: `dependency_upgrade` de una dependencia transitiva utilizada por
  tooling y functions; se conservan las protecciones de los runtimes consumidores.

Los conteos de moderate/low cambian con los advisories del registro. El informe
`reports/security/dependency-audit.md` generado en cada ejecución es la evidencia
actual; los conteos históricos de esta página no sustituyen esa auditoría.
