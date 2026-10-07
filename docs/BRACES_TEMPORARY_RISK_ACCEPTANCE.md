# Aceptación temporal de riesgo de desarrollo: braces

Daniel Opazo autorizó explícitamente esta excepción en la tarea CUDYR el
7 de octubre de 2026. Vence el **15 de octubre de 2026 a las 00:00 UTC**;
no se renueva automáticamente. Responsable: mantenedor de HHR (Daniel Opazo).

Se acepta únicamente GHSA-vfj7-8cjw-p6xm en la cadena de desarrollo del
lockfile raíz aprobado, cuya SHA-256 es
`19d8a51f8377c466ca1f5e12d69719b4a81d5058cce07f120ba987e260e9652e`.
Las siete entradas son braces 3.0.3, micromatch 4.0.8, chokidar 3.6.0,
lint-staged 16.2.7, firebase-tools 15.15.0, eslint-plugin-boundaries 6.0.2
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
aceptado, un cambio de lockfile, nodos, alcance, conteos o vencimiento bloquean.

Validación: pruebas de cadena autorizada, expiración, cambio de lockfile,
reclasificación, Functions, avisos adicionales, causas cíclicas/incompletas y
CLI con conservación de JSON/conteos y advertencia visible; revisión independiente
y auditoría remota antes del merge.

Rollback: retirar la decisión de aceptación y su helper para restaurar el bloqueo
incondicional por los siete hallazgos. Cierre: eliminar la excepción al publicar
una corrección oficial o retirarse oficialmente el aviso, verificando primero el
resultado de npm audit. Si vence sin solución, CI vuelve a bloquear; cualquier
renovación exige nueva autorización explícita.

Fuentes: [aviso oficial](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[discusión upstream](https://github.com/micromatch/braces/issues/70),
[revisión abierta del aviso](https://github.com/github/advisory-database/pull/10132).
