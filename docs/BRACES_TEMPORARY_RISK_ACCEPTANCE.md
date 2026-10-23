# Aceptación temporal de riesgo de desarrollo: braces

Daniel Opazo autorizó explícitamente esta excepción en la tarea CUDYR el
7 de octubre de 2026. El 12 de octubre autorizó explícitamente retirar el
vencimiento de calendario y esperar una actualización oficial de braces.
Responsable: mantenedor de HHR (Daniel Opazo).

Se acepta únicamente GHSA-vfj7-8cjw-p6xm en la cadena de desarrollo del
lockfile raíz aprobado, cuya SHA-256 es
`b1960526ef71515a2a7992814677af53c6ef9d19621fd0197f025e7249d2b60e`.
Daniel autorizó actualizar la huella el 9 de octubre de 2026 para el parche
transitivo Handlebars 4.7.10 y el 11 de octubre para Firebase CLI 15.16.0.
El 16 de octubre de 2026 autorizó explícitamente renovar sólo la huella para
el visor DICOM del PR #874 (Cornerstone 4.22.13 y dicom-parser 1.8.21), conservando
la misma excepción. La auditoría remota del lockfile nuevo conserva los mismos
siete paquetes/versiones/rutas de desarrollo con severidad alta y cero críticos.
Para el PR #885, Daniel autorizó explícitamente renovar únicamente la huella
tras incorporar Mediabunny 1.61.6. La comparación con la auditoría remota
confirmó los mismos siete paquetes, versiones y rutas afectados, sin aceptar
vulnerabilidades adicionales.
Se mantienen el aviso y todos los controles; no se acepta ninguna vulnerabilidad
adicional. Los hallazgos bajos y moderados permanecen visibles en la auditoría.
Las siete entradas son braces 3.0.3, micromatch 4.0.8, chokidar 3.6.0,
lint-staged 16.2.7, firebase-tools 15.16.0, eslint-plugin-boundaries 6.0.2
y @boundaries/elements 2.0.1; todas tienen `dev: true`. Functions no contiene
braces. La excepción no modifica versiones ni instala forks.

El desbordamiento se reprodujo en Node 22.22.2 con patrones sintéticos de
3.500 niveles, tanto en compile como en expand. El riesgo residual es el fallo
de herramientas de desarrollo ante patrones especialmente anidados. No se
considera corregido ni se extiende esta aceptación a producción o Functions.

Se mantiene npm audit de todas las dependencias y el bloqueo alto/crítico.
El informe conserva los datos y conteos originales. Una decisión separada
`accepted_with_exception` permite la integración solo con esta causa exacta;
consola, Markdown y resumen de CI muestran una advertencia permanente mientras
se use la excepción. Los hallazgos moderados siguen registrados. Las causas
transitivas se recorren completas: otro aviso alto/crítico dentro de un paquete
aceptado, un cambio de lockfile, nodos, alcance o conteos bloquean.

Validación: pruebas de cadena autorizada, continuidad tras el antiguo vencimiento, cambio de lockfile,
reclasificación, Functions, avisos adicionales, causas cíclicas/incompletas y
CLI con conservación de JSON/conteos y advertencia visible; revisión independiente
y auditoría remota antes del merge.

Rollback: retirar la decisión de aceptación y su helper para restaurar el bloqueo
incondicional por los siete hallazgos. Cierre: eliminar la excepción al publicar
una corrección oficial o retirarse oficialmente el aviso, verificando primero el
resultado de npm audit y la compatibilidad de las herramientas. No hay bloqueo
por una fecha de calendario; cualquier ampliación de paquetes, versiones o riesgos
sigue exigiendo una decisión explícita. La ausencia de hallazgos utiliza el camino
normal de auditoría aprobada, sin aplicar la excepción.

Fuentes: [aviso oficial](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[discusión upstream](https://github.com/micromatch/braces/issues/70),
[revisión abierta del aviso](https://github.com/github/advisory-database/pull/10132).

El parche de dependencias de PR #922 actualiza únicamente Storybook, Vitest, Vite y
markdown-it. La huella anterior se sustituye tras verificar que los siete nodos
autorizados conservan exactamente sus versiones, rutas, integridades, dependencias
y clasificación de desarrollo. La auditoría debe seguir aceptando exclusivamente
GHSA-vfj7-8cjw-p6xm. Otros avisos altos o críticos bloquean la integración.

El parche de seguridad de PR #965 actualiza únicamente DOMPurify de 3.4.11 a
3.4.17 para corregir GHSA-cg2g-xh64-v4q7 y GHSA-mrv2-3pqr-j5jr. La huella anterior
era `6c96794225084b71458e7fc1f96e66166cbf35bb8da10451c771aae38a0bcd32`.
La comparación completa del lock confirma que solo cambian versión, URL e
integridad de `node_modules/dompurify`; todas las demás entradas, incluidos los
siete nodos de desarrollo autorizados, permanecen idénticas. Los archivos de
dependencias de Functions tampoco cambian. Se conserva el mismo alcance de la
excepción y el rechazo de cualquier aviso alto o crítico adicional; DOMPurify
no se incorpora a la aceptación de riesgo.

La limpieza de dependencias de PR #963 declara en `package.json` los paquetes que
el código ya importaba (`@kitware/vtk.js`, `workbox-cacheable-response` y
herramientas de pruebas y scripts) y elimina `motion` y `@tanstack/react-virtual`,
que nada importa. La huella anterior era
`998d4f112ae629d4b2418e131ea8a05380ba74127063922e39b0e14fe371adac`. La
comparación completa del lock confirma que solo se eliminan `motion`,
`framer-motion`, `motion-dom`, `motion-utils`, `@tanstack/react-virtual` y
`@tanstack/virtual-core`, y que `@google-cloud/firestore` y sus dependencias dejan
de figurar como opcionales al quedar declaradas. Ninguna versión cambia, los siete
nodos de desarrollo autorizados permanecen idénticos y los archivos de
dependencias de Functions no cambian. Se conserva el mismo alcance de la excepción.

La actualización de Dependabot de PR #540 sube `@netlify/blobs` de 11.1.0 a
11.1.4 junto con sus dependencias (`@netlify/dev-utils` 6.0.3, `@netlify/otel`
7.0.4, `@envelop/instrumentation` 1.0.1, `ansis` 4.4.0, `cjs-module-lexer` 2.3.0,
`import-in-the-middle` 3.5.2 y su `es-module-lexer` 3.0.4). La huella anterior era
`3ef8b4de6739ad963b3ca53613ca05fbd5f4a87456d89258010792b1be05f343`. La comparación completa del lock confirma que solo cambian esas entradas
y el aviso de obsolescencia de `@opentelemetry/sdk-trace-base` y
`@opentelemetry/sdk-trace-node`; los siete nodos de desarrollo autorizados
permanecen idénticos y los archivos de dependencias de Functions no cambian. Se
conserva el mismo alcance de la excepción.
