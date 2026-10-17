# Aceptación temporal de riesgo de desarrollo: braces

Daniel Opazo autorizó explícitamente esta excepción en la tarea CUDYR el
7 de octubre de 2026. El 12 de octubre autorizó explícitamente retirar el
vencimiento de calendario y esperar una actualización oficial de braces.
Responsable: mantenedor de HHR (Daniel Opazo).

Se acepta únicamente GHSA-vfj7-8cjw-p6xm en la cadena de desarrollo del
lockfile raíz aprobado, cuya SHA-256 es
`e2488dd3a787ecb0bbf99cdfbc6504c153a2c4e2503c235de8dd4fa989a9c257`.
Daniel autorizó actualizar la huella el 9 de octubre de 2026 para el parche
transitivo Handlebars 4.7.10 y el 11 de octubre para Firebase CLI 15.16.0.
El 16 de octubre de 2026 autorizó explícitamente renovar sólo la huella para
el visor DICOM del PR #874 (Cornerstone 4.22.13 y dicom-parser 1.8.21), conservando
la misma excepción. La auditoría remota del lockfile nuevo conserva los mismos
siete paquetes/versiones/rutas de desarrollo con severidad alta y cero críticos.
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
