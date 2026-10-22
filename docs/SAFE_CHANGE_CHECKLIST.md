# Safe Change Checklist

### CLI de despliegue Firebase (2026-10-11)

- **Owner:** CI/Functions HHR.
- **Reason:** 15.15.0 comparte tokens de fuente entre grupos; Firebase rechazó
  el despliegue de la región clínica con el error `Invalid source token`.
- **TargetVersion:** `firebase-tools` 15.16.0, fijado en manifest y lockfile raíz.
  Es el único paquete resuelto que cambia; SDK, Functions y overrides se conservan.
- **RiskLevel:** medio: herramienta de despliegue y emulador, con corrección
  [upstream #10432](https://github.com/firebase/firebase-tools/pull/10432).
- **RollbackPlan:** revertir el PR y ejecutar `npm ci`; no volver a desplegar
  varias regiones con el CLI afectado. No borrar datos ni ampliar permisos.
- **VerificationGate:** `dependency_upgrade`: instalación limpia, audit de ambos
  paquetes, prueba de aislamiento de tokens, `ci:merge-gate`, suites Functions,
  emuladores sintéticos, revisión independiente, CI y despliegue en hhr-pruebas.

Antes de cerrar una modificación relevante en este repo:

### Iterar sin repetir los gates completos

Durante la edición, ejecutar las pruebas del módulo afectado (`npx vitest run <ruta>`)
y el grupo pertinente de `npm run check:quality:group -- <grupo>`:
`boundaries`, `governance`, `security`, `size`, `tests` o `reports`.
Esto es feedback focalizado, **no reemplaza el gate previo al merge**.

Para cambios en límites de imports:

```sh
npx vitest run src/tests/build/featureBoundaryRunner.test.ts src/tests/security/laboratoryImportGovernanceStatic.test.ts
npm run check:quality:group -- boundaries
```

El runner compartido conserva la política de imports y excepciones. El control genérico
reutiliza un snapshot en memoria durante una sola invocación; cada ejecución nueva
lee de nuevo el código. No añadir otra política basada en grep en un test de módulo.

Al cerrar, elegir un gate existente de la lista inferior. `ci:pre-merge` ya incluye
typecheck, lint, calidad completa y unitarios: no ejecutar de nuevo sus componentes
si ya pasaron sobre el mismo diff y entorno. `ci:merge-gate` amplía ese gate con build
y validaciones de preview. Si el código cambia después, revalidar lo afectado y dejar
que CI compruebe el head definitivo. Registrar comando, SHA/diff y resultado; nunca
tratar un resultado anterior a una modificación como evidencia del nuevo código.

### Selección local del gate

`package.json` define las etapas ejecutadas; la política de
`scripts/config/sustainable-change-policy.json` conserva los requisitos adicionales
por tipo de cambio. Esta tabla orienta la selección, no sustituye esa política.

| Alcance                                                            | Validación local de cierre                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Solo documentación operativa, sin scripts, código ni configuración | `check:docs-drift` y `check:operational-runbooks`; comprobar enlaces y comandos editados |
| Código habitual                                                    | `ci:pre-merge`                                                                           |
| Runtime clínico, auth, storage, bundle o contratos de arquitectura | `ci:merge-gate` y controles adicionales exigidos por la política                         |
| Release o reglas persistentes                                      | `ci:release-gate` y controles adicionales exigidos por la política                       |

Durante edición bastan pruebas focalizadas para obtener feedback; no acreditan
el cierre. `ci:inner-loop` sirve para iterar y para los cambios locales de UI que
la política clasifica expresamente como `safe_local_ui`.

No encadenar gates completos: `ci:release-gate` contiene `ci:merge-gate`, que
contiene `ci:pre-merge`. Un check fallido sigue pendiente aunque el resto pase.
El CI del SHA final y la revisión independiente deben aprobarse antes del merge.
La clasificación remota `docs-only` se decide en CI; no forzar ni omitir checks.

### Checklist de cierre

La compactación visual del acceso del 22 octubre 2026 es `safe_local_ui`:
estrecha el panel y su formulario compartido con la pantalla de carga, elimina
los textos introductorios y muestra Google como icono circular con nombre
accesible. Conserva handlers, bloqueo, recuperación y recarga no destructiva.
Verificar `ci:inner-loop`, pruebas afectadas, build/budgets y navegador: ausencia
de scroll y pie de soporte visible en escritorio y móvil de 320×568, geometría
estable al cargar el módulo, Google oficial y fallback centrados, ambos fondos.
No cambia autenticación, permisos, datos clínicos ni CUDYR.

La ayuda de acceso del 22 octubre 2026 es `critical_runtime`: sustituye el borrado
local desde el login por una recarga normal del navegador. La confirmación informa
que se pierde el formulario, pero conserva datos locales, sesiones y cambios aún
no enviados. Cancelar conserva credenciales y errores en memoria; mientras se
decide, RUT (incluido Enter) y Google permanecen bloqueados. El login ya no invoca
mantenimiento de almacenamiento. No cambia las APIs públicas de mantenimiento,
la limpieza de cierre de sesión ni los controles de autorización.
Verificar `ci:merge-gate`, `test:release-confidence`, pruebas focalizadas de login
y `auth-login-resilience` con una tarea sintética no confirmada en la IndexedDB
real, Web Storage y caché, conservadas tras navegar. La semilla y la autenticación
E2E usan únicamente los fixtures locales del proyecto demo. Revisión independiente
y CI del head definitivo antes del merge; no acreditar verificaciones pendientes.

La continuidad visual del acceso RUT del 21 octubre 2026 es `safe_local_ui`:
elimina la composición provisional antigua y comparte marco, imagen y geometría
con la página lista. Agrupa la ayuda de acceso conservando autocomplete y bloqueo
de campos; la recarga de esa ayuda se rige por el bloque del 22 de octubre anterior.
El formulario RUT carga con la pantalla. No cambia auth runtime,
roles, persistencia, endpoint, credenciales ni datos clínicos. Verificar
`ci:inner-loop`, pruebas afectadas, build/budgets y navegador en escritorio y
móvil: arranque con módulo retrasado, ambos fondos, formulario RUT, ayuda y
refresh autenticado. Revisión independiente y CI del head final antes de merge.

La compactación de la lista de funcionarios es `safe_local_ui`: reduce el espaciado y
presenta las acciones existentes como iconos en una fila, con nombre accesible, tooltip
y foco visible. Compacta el formulario de modificación con campos y botones alineados
en escritorio y apilados en pantallas pequeñas. Conserva handlers, confirmaciones,
bloqueos y permisos. Verificar
`ci:inner-loop`, build y la tabla en escritorio/pantalla estrecha, incluida navegación
por teclado, además de revisión independiente y CI del head final antes del merge.

Las correcciones visuales del censo y Moa del 20 octubre 2026 son `safe_local_ui`: eliminan
fechas/etiquetas de procedencia de las celdas, ocultan el tipo de cama en traslados y simplifican
los controles decorativos de Moa con selección aleatoria por pulsación. No cambian datos,
metadata clínica, sincronización, contratos ni handlers de movimientos. Validar `ci:inner-loop`,
pruebas focalizadas, build/budget y preview de carryover, traslados y Moa (catálogo/local,
recarga, teclado y movimiento reducido), además de revisión independiente y CI del head final.

1. Clasificar la change según `scripts/config/sustainable-change-policy.json`.
2. Actualizar tests unitarios e integración afectados por la change.
3. Si la change es upgrade o excepción, documentar owner, riesgo, rollback y criterio de cierre.
4. Revisar si la change toca reglas clínicas de fecha/turno, sync o identidad paciente.
5. Seleccionar el gate según el alcance y la política; ver [Selección local del gate](#selección-local-del-gate).
6. No ejecutar por separado tipos/calidad si ya están incluidos en ese gate.
7. Ejecutar el gate elegido:
   `npm run ci:inner-loop`, `npm run ci:pre-merge`, `npm run ci:merge-gate` o `npm run ci:release-gate`.
8. Verificar límites de tamaño/hotspots si el cambio toca archivos grandes.
9. Revisar contratos runtime si la change toca repositorios, Firestore, templates o serialización.
10. Revisar si la change impacta `firestore.rules`, emulador o E2E crítico.
11. Si se agrega una excepción de arquitectura o tamaño, documentarla en la allowlist correspondiente.
12. Si se introduce un nuevo error operativo, mapearlo al contrato compartido y a telemetría.
13. Dejar referencias en README/ARCHITECTURE del módulo si la decisión cambia una regla estable.
14. Si la change toca startup, lazy loading o vistas críticas, correr `npm run check:flow-performance-budget`.
15. Si el budget por flujo cambia, regenerar y revisar `reports/e2e/flow-performance-budget-summary.json` y `.md`.
16. Si la change toca `index.html`, login o refresh autenticado de módulos críticos, revisar y preservar el contrato de [docs/system-behaviors.md](./system-behaviors.md) y mantener verdes `src/tests/security/startupPrebootContractStatic.test.ts`, `src/tests/app-shell/BootstrapRouteChrome.test.tsx` y `src/tests/components/AppLoadingBehavior.test.tsx`.
17. Si la change toca login, roles o auth bootstrap, revisar y actualizar [docs/AUTH_ACCESS_MODEL.md](./AUTH_ACCESS_MODEL.md).
18. Si la policy lo exige, regenerar `reports/release-readiness-scorecard.md`.
19. Si la change toca `daily-record/sync`, revisar [docs/ADR_DAILY_RECORD_RUNTIME_PATH.md](./ADR_DAILY_RECORD_RUNTIME_PATH.md).
20. Si la change toca auth runtime, revisar [docs/ADR_AUTH_RUNTIME_RECOVERY.md](./ADR_AUTH_RUNTIME_RECOVERY.md).
21. Si la change toca documentos clínicos, revisar [docs/ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md](./ADR_CLINICAL_DOCUMENT_WORKSPACE_CONTRACT.md).
22. Si la change toca handoff, revisar [docs/ADR_HANDOFF_RUNTIME_SURFACES.md](./ADR_HANDOFF_RUNTIME_SURFACES.md).

### Parche transitivo gRPC (2026-10-01)

- **Owner:** plataforma Firebase/Functions HHR.
- **Reason:** corregir GHSA-m9gg-hp2v-232j actualizando el override existente en
  ambos paquetes; no se ha demostrado explotación en HHR.
- **TargetVersion:** `@grpc/grpc-js` 1.14.5 en los dos manifests y lockfiles.
- **RiskLevel:** bajo/medio: parche de transporte Node utilizado por Admin/Google;
  se conserva Firebase web 12.14.0 y el resto del grafo.
- **RollbackPlan:** revertir este commit y ejecutar `npm ci` en raíz y Functions;
  la versión anterior volvería a estar señalada por el audit. No borrar datos ni colas.
- **VerificationGate:** categoría `dependency_upgrade`: audit de ambos paquetes,
  `ci:merge-gate`, revisión independiente y CI del head final; ampliar con
  `test:release-confidence` para validar el transporte de la autoridad.

Referencia: [aviso gRPC](https://github.com/advisories/GHSA-m9gg-hp2v-232j).

El gate ampliado `check:release-evidence` sigue señalando 27 archivos de tests con
relojes reales o esperas de turno. Esa señal es anterior al parche: no cambia ningún
archivo de tests ni su detector. No se declara aprobado ese gate, no se añaden
marcas `@flake-safe` ni excepciones para silenciarlo. Su revisión corresponde a un
bloque propio de determinismo de fixtures y control de esperas. Este parche
transitivo no actualiza el SDK Firebase web ni su bootstrap; conserva los controles
exigidos por `dependency_upgrade` sin modificar la política de clasificación.

### Parche del tooling FTP de CI (2026-10-01)

- **Owner:** infraestructura de tests/CI HHR.
- **Reason:** GHSA-c475-qrg2-pj4r bloquea el audit del tooling Firebase; no se ha
  demostrado explotación en HHR.
- **TargetVersion:** override existente de `basic-ftp` a 6.2.1; sólo manifest y
  lockfile raíz. No cambia Firebase web, Functions ni la política de audit.
- **RiskLevel:** medio: el salto 5 a 6 rechaza hosts de transferencia FTP distintos
  por defecto. `get-uri` conserva las APIs usadas (`Client`, `access`, `list`,
  `lastMod`, `downloadTo`, `close`); no habilitar `allowSeparateTransferHost`.
- **RollbackPlan:** revertir este PR y ejecutar `npm ci`; el audit volvería a
  bloquear la versión vulnerable. No borrar datos ni colas.
- **VerificationGate:** categoría `dependency_upgrade`: audit de raíz y Functions,
  carga del consumidor `get-uri`, emulador/autoridad sintética, revisión independiente
  y CI completo del head final con sus umbrales intactos.

Referencias: [aviso FTP](https://github.com/advisories/GHSA-c475-qrg2-pj4r),
[cambio de seguridad en 6.0](https://github.com/patrickjuchli/basic-ftp/releases/tag/v6.0.0).

### Alineación del SDK Admin de tooling raíz (2026-10-02)

- **Owner:** plataforma Firebase/Functions y emuladores HHR.
- **Reason:** los scripts y emuladores importan Admin directamente, pero la raíz
  lo recibía como peer de Functions 7.2.5. Admin 13.9 incorporaba `node-forge`
  1.4.0, señalado por GHSA-86w9-cpqp-85rv; no se ha demostrado explotación en HHR.
- **TargetVersion:** declarar Admin 14.4.0 y Functions 7.4.0 como dev dependencies
  explícitas de raíz, alineadas con las versiones ya usadas en `functions/`.
  Functions 7.4 admite Admin 13 y 14; actualizar sólo Functions no garantiza el retiro.
- **RiskLevel:** medio: cambia el SDK de tooling y sus tipos/transitivos. Firebase web,
  el paquete Functions desplegable, APIs clínicas y reglas permanecen intactos.
- **RollbackPlan:** revertir manifest/lock raíz y ejecutar `npm ci`; reaparece la
  cadena vulnerable. No borrar datos, colas ni aplicar un override criptográfico.
- **VerificationGate:** `dependency_upgrade`: instalación limpia, audit en ambos
  paquetes, tipos/lint y `ci:merge-gate`, suites Functions, emuladores sintéticos
  de autoridad, revisión independiente y CI del head final.

Referencia: [aviso node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
El aviso no publica un parche; Admin 14 elimina esa dependencia. Los permisos IAM
y el despliegue no forman parte de esta alineación del tooling local/CI.

### Retiro de dependencias de desarrollo sin consumidores

- **Owner:** tooling frontend HHR.
- **Reason:** retirar `autoprefixer` (fuera del pipeline Vite/Tailwind actual) y
  `@types/jspdf` (tipos antiguos redundantes; jsPDF ya declara sus tipos propios).
  `deno.lock` no corresponde a un runtime/comando vigente; los lockfiles npm de
  raíz y Functions siguen siendo las fuentes de instalación.
- **TargetVersion:** eliminación de esas dos declaraciones; sin upgrades del resto.
- **RiskLevel:** bajo: no cambian SDK, código runtime, peers ni overrides de seguridad.
- **RollbackPlan:** revertir el PR y ejecutar `npm ci`; no modificar datos ni colas.
- **VerificationGate:** tipos, lint, audit, exportación PDF, comparación del grafo
  retenido y CSS, build/preview, revisión independiente y CI del head final.

### Lector del respaldo mensual CUDYR (2026-10-07)

- **Owner:** módulo CUDYR de HHR.
- **Reason:** leer los informes BIFF/XLS de Eloísa como evidencia consultiva.
- **TargetVersion:** SheetJS 0.20.3, tarball oficial fijado con integridad en lockfile.
- **RiskLevel:** medio: archivo externo; tamaño 256 KiB, firma, expansión ZIP declarada,
  filas/columnas acotadas, fórmulas rechazadas y worker terminable a los 10 segundos.
- **RollbackPlan:** revertir este PR; el archivo documental de servidor permanece
  conservado y el reporte principal mantiene su contrato.
- **VerificationGate:** tipo `dependency_upgrade`, controles estáticos, unitarios,
  build/presupuesto, navegador sintético y revisión independiente. Worker opcional
  fuera del precache; no se amplían los presupuestos de arranque o tamaño.

### Parches transitivos de HTTP (2026-10-06)

- **Owner:** plataforma Firebase/Functions y tooling HHR.
- **Reason:** corregir versiones vulnerables detectadas por el audit de ambos
  paquetes; no se ha demostrado explotación en HHR.
- **TargetVersion:** `proxy-addr` 2.0.8 y `@fastify/busboy` 3.2.2 en raíz y
  Functions; `compression` 1.8.2, `http-cache-semantics` 4.3.0 y `source-map-js`
  1.2.2 en raíz. Sólo resoluciones compatibles con los manifests existentes.
- **RiskLevel:** medio: cambia procesamiento HTTP y tooling transitivo; no cambia
  el SDK Firebase, permisos, contratos clínicos ni configuración de proxies.
- **RollbackPlan:** revertir los dos lockfiles y ejecutar `npm ci` en raíz y
  Functions; reaparecerían las versiones vulnerables. No modificar datos ni colas.
- **VerificationGate:** `dependency_upgrade`: instalación, auditoría de ambos
  paquetes, `ci:merge-gate`, suites Functions, runtime PDF, revisión independiente
  y CI del head definitivo. Un fallo de audit impide el merge.

La auditoría posterior conserva hallazgos altos en la cadena de desarrollo de
`braces` 3.0.3, sin versión corregida publicada al comprobarla. Estos parches no
resuelven ese bloqueo ni autorizan excepciones o rebajas del umbral.

Estos mismos parches se incorporan al PR CUDYR #764 para reducir su bloqueo de
auditoría, conservando la dependencia SheetJS y los controles vigentes. El origen
es el PR #738; no se incorporan otros cambios de ese PR. La auditoría remota del
head actualizado determinará los hallazgos restantes. Las consultas locales
frescas al registro npm están bloqueadas por la cadena TLS de la red; resultados
en caché no acreditan disponibilidad actual de versiones. No se desactiva TLS.

### Parches de Sharp y SDK MCP para #764 (2026-10-07)

- **Owner:** plataforma de imágenes y tooling Firebase HHR.
- **Reason:** completar las actualizaciones disponibles de la auditoría; no se ha
  demostrado explotación en HHR.
- **TargetVersion:** Sharp 0.35.5, sus binarios 0.35.5 y libvips 1.3.4; SDK MCP
  transitivo 1.32.1. Se conservan los rangos de los manifests y el SDK Firebase.
- **RiskLevel:** medio: dependencias nativas de imagen y cliente MCP del tooling.
- **RollbackPlan:** revertir este commit y ejecutar npm ci; reaparecen los avisos.
  No modificar censos, credenciales ni permisos.
- **VerificationGate:** instalación limpia, runtime Sharp, carga del tooling,
  ci:merge-gate, navegador/emulador sintético, revisión independiente y auditoría
  remota del head definitivo. No integrar mientras existan altos/críticos activos.

El diagnóstico aislado de GitHub Actions, run 37685292433, resolvió los paquetes
con TLS validado, scripts de instalación deshabilitados y token de sólo lectura.
Se verificaron los SHA-512 de 28 tarballs oficiales en el runner y localmente.
Únicamente esas 28 entradas se trasladan al lockfile; se descartan 16 cambios de
metadatos libc ajenos. La instalación local usa caché por integridad, sin rebajar
TLS. El workflow diagnóstico no se incorpora a este PR ni a main.

La auditoría del árbol resuelto conserva siete paquetes altos en una misma cadena
de braces 3.0.3; el registro fresco sigue publicando esa versión como latest.
Esta evidencia no autoriza una excepción ni un downgrade del plugin de límites
arquitectónicos. Sharp: GHSA-wq5f-xc86-pv6w. SDK MCP: GHSA-6qxp-vccf-f47h.

### Aceptación temporal de braces (2026-10-07)

Excepción autorizada explícitamente por Daniel Opazo, limitada al aviso y árbol
de desarrollo aprobados. Daniel retiró explícitamente el vencimiento el 12-10-2026
para esperar una actualización oficial de braces. Se conservan
los hallazgos originales y un aviso visible; otros riesgos siguen bloqueando.
Owner, riesgo residual, rollback y validación: [registro de aceptación](BRACES_TEMPORARY_RISK_ACCEPTANCE.md).

### Propuesta de sincronización con solo datos de episodio (2026-10-16)

Si todas las actualizaciones quedan ocultas por
sus etiquetas internas, la revisión muestra a los pacientes afectados y «datos
del episodio». Conserva la confirmación manual y la presentación habitual de
planes mixtos. La autoridad de especialidad compara metadatos por sus valores
y tipos, independientemente del orden de las claves de los mapas Firestore.
Cambiar autor, decisión, regla, tipo o valor sigue rechazado; no se amplían
permisos ni se reescriben decisiones. Validar propuesta vacía, metadatos
reordenados/anidados, intentos de falsificación y RN. Cierre: `ci:merge-gate`,
`test:release-confidence`, revisión independiente y CI del head final. Publicar
la función requiere autorización separada y prueba real posterior.

### Exportación DICOM a MP4 (2026-10-17)

- **Owner:** visor radiológico HHR.
- **Reason:** exportar cada corte verificado a un MP4 local con tiempos explícitos,
  sin perder cuadros por grabación de pantalla ni enviar imágenes a un servicio.
- **TargetVersion:** Mediabunny 1.61.6 (MPL-2.0), fijado con integridad en lockfile;
  import dinámico, codificación nativa H.264, sin plugins ni codecs remotos.
- **RiskLevel:** medio: codificación y memoria del navegador, limitada a 64 MiB,
  con cancelación y revisión de privacidad antes de descargar. CSP media-src
  self/blob para vista previa; no se amplían connect-src ni permisos de captura.
- **RollbackPlan:** revertir este PR; no modifica originales, pacientes ni servidor.
- **VerificationGate:** ci:merge-gate, audit, revisión independiente, pruebas
  sintéticas de orden/conteo/duración MP4, cancelación y cierre, CI del head final.

### Parche de Markdown en documentación (2026-10-20)

- **Owner:** tooling y documentación HHR.
- **Reason:** corregir [GHSA-r7fv-28h4-cvq7](https://github.com/advisories/GHSA-r7fv-28h4-cvq7), publicado en la base de avisos el 20 de octubre; bloqueó Security Audit del candidato de cuentas.
- **TargetVersion:** `markdown-it` 14.3.2, override de desarrollo usado por TypeDoc 0.28.15; es el único nodo resuelto que cambia.
- **RiskLevel:** bajo; se mantiene la misma versión mayor y no cambia el grafo de producción ni Functions.
- **RollbackPlan:** revertir el parche; la auditoría volverá a señalar el aviso. No sustituir la corrección por una excepción.
- **VerificationGate:** `dependency_upgrade`: manifiesto oficial, integridad npm comprobada en instalación limpia de CI, generación TypeDoc, regresiones del control de auditoría, hooks y CI del SHA definitivo. Reutilizar controles de runtime clínico cuyos inputs no cambian.

La huella exacta del lock en la excepción preexistente de `braces` se vuelve a vincular al lock corregido tras comprobar que sus siete nodos, versiones, clasificación de desarrollo y dependencias permanecen idénticos. Se conservan el aviso, los resultados sin modificar, el rechazo de otros riesgos altos/críticos y todos los controles de alcance. El riesgo de `braces` no está corregido ni se amplía su aceptación.

### Primer ingreso por RUT y recuperación (20 octubre 2026)

Runtime crítico de autenticación. Verificar clave inicial sin sesión clínica, cambio
obligatorio y correo requerido, credenciales personales con mayúscula/número,
mostrar/ocultar en todas las entradas de clave del flujo, códigos con vencimiento,
cinco intentos persistidos, consumo único concurrente, revocación, suspensión y
respuesta perdida. Reusar protección de identidades/censos/CUDYR sin modificarla.
Gate: `ci:merge-gate`, `test:release-confidence`, `test:accounts:emulator:ci`, revisión
independiente y CI definitivo. Probar envío real requiere despliegue y configuración
separados; el emulador sustituye únicamente el transporte de correo.

Ampliación administrativa solicitada para PR 919: probar roles de activación,
modificación y recuperación sin claims fijos de enfermería; reseteo a clave inicial,
deshabilitar/habilitar sin pérdida de clave, eliminación de Auth sin borrar autorías,
fallos intermedios y suspensión concurrente. Verificar listado de correo solo admin,
confirmaciones de botones y controles antiguos colapsados. Emulator Auth/Firestore/
Storage debe rechazar sesiones previas y escritura del rol de solo lectura.

### Lecturas eficientes de acceso RUT (22 octubre 2026)

Runtime crítico de autenticación. Agrupar IP/cuenta/índice mediante `getAll` conserva
ventanas y contadores, incluido el intento de IP rechazado por cuenta. Verificar
que el índice no se entrega antes del commit ni desde un reintento abandonado y
que un error no continúa al proveedor. La clave personal evita la lectura de
preparación inicial, conservando su revalidación para el primer ingreso y el
estado/lock leído después del proveedor. La limpieza de roles debe respetar el
guard de sesión dentro de la transición serializada. No cambia regiones ni añade
caché de permisos. Conservar los gates de cuentas anteriores y el CUDYR intacto;
rollback mediante reversión de código, sin borrar contadores, sesiones o colas.

### Parches del tooling para PR #922 (2026-10-21)

- **Owner:** tooling y pruebas HHR.
- **Reason:** corregir los nuevos avisos de Storybook, Vitest, Vite y markdown-it que bloquean Security Audit.
- **TargetVersion:** Storybook y su grupo de nueve paquetes 10.6.2, Vitest y su grupo 4.1.12, Vite 6.4.4 y markdown-it 14.3.3. Cambian 22 nodos resueltos. Se conservan Firebase CLI, Functions y las dependencias de producción.
- **RiskLevel:** medio; afecta el servidor y las compilaciones de desarrollo, las pruebas de componentes y TypeDoc.
- **RollbackPlan:** revertir este commit y ejecutar `npm ci`; reaparecerían los avisos corregidos. No modificar credenciales, permisos ni datos clínicos.
- **VerificationGate:** `dependency_upgrade`: instalación limpia sin omitir validación de peers, auditoría de ambos paquetes, regresiones de la excepción, `ci:merge-gate`, compilaciones Storybook y TypeDoc, revisión independiente y CI del head definitivo.

La resolución aislada utiliza TLS válido en GitHub Actions. Los tarballs
oficiales se comprueban por integridad antes de incorporarse a la caché local.
No se desactiva TLS ni se cambia la configuración de confianza del Mac.
La comparación conserva íntegros los siete nodos de la excepción de braces,
incluidas sus dependencias. Sólo se vuelve a vincular la huella del lockfile.
El gate sigue rechazando cualquier aviso alto o crítico adicional.

Fuentes: [Storybook](https://github.com/advisories/GHSA-f2ph-cmg5-wxc8),
[Vite](https://github.com/advisories/GHSA-698v-4r3x-3vcv) y
[markdown-it](https://github.com/advisories/GHSA-vfgh-jcmw-g37q).

La compilación de Storybook detectó imports a componentes movidos y tres
stories de componentes retirados. Las stories conservadas apuntan a las rutas
actuales. Se retiran únicamente ConflictVersionsAdminControl, TraceabilitySummary
y TraceabilityTimeline, sin componente ni referencias productivas vigentes.
No se modifica ningún componente ni contrato clínico. La compilación completa
de Storybook comprueba conjuntamente estas rutas.

La auditoría tras la instalación limpia detectó también los avisos de
`@vitest/mocker` [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)
y [GHSA-xp26-3454-mjgp](https://github.com/advisories/GHSA-xp26-3454-mjgp).
El grupo Vitest 4.1.12 los corrige sin modificar el rechazo de causas cíclicas
del control de auditoría.

Los artefactos generados en `storybook-static` quedan fuera de ESLint, igual que
`dist`. Las fuentes de las stories siguen sujetas al lint. La story de dotación
utiliza los props vigentes y conserva los escenarios de dotación poblada y vacía
a través del contexto. La compilación no acredita interacciones de todas las stories.

Storybook desactiva VitePWA mediante su señal `STORYBOOK=true`, sin cambiar
el límite de precaché de la aplicación. El preview importa el CSS global.
La API pública de handoff reexporta `HandoffRow` para que su story respete
la frontera del módulo, sin modificar el componente.

La prueba de correo de recuperación resuelve `googleapis` desde el módulo del
transporte. Esto conserva el aislamiento cuando raíz y Functions tienen sus
propias instalaciones, sin cambiar el envío real ni sus aserciones.

El E2E de recuperación DICOM espera hasta 60 segundos el estado exacto de
23 cortes listos antes de operar el cine parcial. El botón de reintento puede
aparecer mientras otros cortes siguen preparándose. Se mantienen el corte
fallido, los conteos de solicitudes y las comprobaciones de recuperación.

### Cierre de sesión resistente al canal · 22-10-2026

Clasificación: `critical_runtime`. Un error de postMessage no debe detener el
cierre de Firebase y la limpieza ya existente. Preservar generación admitida,
cierre entre pestañas y cola de enfermería. Verificar regresión conductual del
handler, mensajes vigentes, `ci:merge-gate`, `test:release-confidence`, revisión
independiente y CI. Solo retirar APIs cuyo árbol de consumidores esté vacío.

### Ruta regional de acceso por RUT (22 octubre 2026)

- **Owner:** autenticación y Functions HHR.
- **Reason:** cinco pares intercalados mostraron mejor mediana de validación y
  autenticación en Santiago, conservando los diez ingresos correctos y la recarga.
  Permanecen picos iniciales; la muestra no acredita arranque frío ni p95 y cambia
  región y generación conjuntamente.
- **TargetVersion:** `signInWithRutSantiago`, adaptador HTTP Gen2 del callable
  Gen1 existente. Conservar cuenta de servicio Appspot explícita, protocolo,
  errores/CORS y capacidad equivalente. Default West sólo para el proyecto exacto
  `hhr-pruebas`; overrides permitidos US/East/West, flag inválido → US.
- **RiskLevel:** runtime crítico de autenticación. No cambiar verificación de
  credenciales, sesión, reglas, recuperación, otros callables ni CUDYR. Un fallo
  no habilita fallback ni doble envío.
- **RollbackPlan:** fijar `VITE_ACCOUNT_FUNCTIONS_REGION=us-central1` en el
  cliente afectado y reconstruir/reiniciar; quitar el flag selecciona Santiago en
  pruebas. Conservar el endpoint US y no mover datos ni ampliar permisos.
- **VerificationGate:** `ci:merge-gate`, `test:release-confidence`,
  `test:accounts:emulator:ci`, cobertura sensible, binding de servicio/región y
  protocolo HTTP real, revisión independiente y CI del SHA definitivo. Verificar
  endpoint desplegado y censo/sesión tras recarga antes de declarar activo el
  rollout; los tests focalizados o el merge no acreditan disponibilidad.
