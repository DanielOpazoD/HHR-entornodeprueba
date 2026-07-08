# Professional Release Check

Runbook corto para validar ramas que buscan subir estabilidad percibida, calidad clínica y confianza de merge.

## Gates obligatorios

1. `npm run ci:pre-merge`
2. `npm run build`
3. `npm run check:bundle-budget`
4. `npm run check:dependency-vulnerabilities`
5. `npm run test:e2e:clinical-visual-release`
6. `npm run check:release-evidence` si se usaran reportes como evidencia de release

## Auditoria de dependencias

- Si `check:dependency-vulnerabilities` falla con `high_or_critical_vulnerabilities`, tratarlo como vulnerabilidad real y corregir dependencias productivas.
- Si falla con `certificate_untrusted`, `registry_policy_blocked` o `network_unavailable`, no marcar la app como segura desde el entorno local.
- Para fallo TLS local, usar:
  - `NODE_OPTIONS=--use-system-ca npm run check:dependency-vulnerabilities`
  - `npm config get cafile`
  - `npm ping --registry=https://registry.npmjs.org`
- Si el entorno local sigue bloqueado, exigir workflow `Security Audit / dependency-vulnerabilities` verde en GitHub Actions para el mismo commit.
- No usar `npm config set strict-ssl false` ni `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## QA visual clinico

`npm run test:e2e:clinical-visual-release` debe cubrir Chromium con:

- Censo Diario renderizado y sin overflow horizontal.
- Refresh/login con usuario autenticado y tabla de censo visible tras reload.
- Documentos Clinicos con panel de archivos globales centrado y con ancho acotado.
- CUDYR renderizado y sin overflow horizontal.
- Entrega medica renderizada y editable.
- Descargas Excel capturadas para Censo Diario y CUDYR.

Los attachments esperados quedan validados por `npm run check:release-evidence`.

## Excel clinico-operativo

Los tests de workbook deben abrir/generar:

- Censo Diario con hoja `Censo Diario`, columnas canonicas, encabezado congelado/estilizado y exportacion no vacia.
- CUDYR mensual con hoja `Resumen CUDYR Mensual`, hojas diarias, formulas, totales y caso sin datos explicito.

Si se cambia un nombre de hoja, columna o formato, actualizar test y consumidor en la misma change.

## Bundle y payload

- `exceljs` debe seguir servido como `vendor/exceljs.min.js` bajo demanda, sin chunk duplicado `assets/exceljs.min-*.js`.
- El shell autenticado debe respetar el budget `app-authenticated-shell`.
- Si `check:bundle-budget` queda cerca del limite, preferir cortar imports estaticos o lazy-load de UI secundaria antes de subir budgets.
- Solo subir un budget si el aumento es justificado por una dependencia externa o un cambio de producto deliberado.
