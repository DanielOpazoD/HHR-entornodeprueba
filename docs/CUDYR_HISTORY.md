# Archivo permanente de CUDYR

PR1 del bloque de trazabilidad CUDYR. Agrega contrato, escritor y lector de historia;
la sincronización habitual y el Excel se conectarán en PR posteriores.

## Identidad y conservación

`hospitals/{HOSPITAL_ID}/cudyrHistory/{observationId}` guarda una observación de una
evaluación oficial. `eventKey` agrupa observaciones por establecimiento, episodio,
fuente e identificador de evaluación. `observationId` incluye además el contenido
normalizado. Repetir exactamente el contenido no crea otra observación; una
corrección o metadata distinta conserva otra observación del mismo evento.

Una observación NO equivale a un paciente categorizado. El futuro consumidor debe
agrupar por `eventKey`, conciliar versiones contradictorias y aplicar la regla diaria.
No elegir automáticamente la última captura como verdad clínica: la fuente puede
responder con una versión anterior. La ausencia de autor en una captura posterior
no elimina la observación que conserva su nombre. `sourceVersion` es opaco y no
acredita fecha de modificación ni orden causal.

No se mantiene un array creciente dentro de `dailyRecords`, ni se modifican sus
camas, resultados, cierre o revisiones. El archivo acepta evaluaciones anteriores
a D−1 cuando el episodio está acreditado en el censo de la sincronización o en sus
egresos, traslados o CMA vigentes. Conserva cunas; la exclusión estadística se resuelve
por día en otro dominio. La política de modificación de censos D−1 permanece intacta.

## Escritor

`archiveCudyrHistory`, callable regional `southamerica-east1`, recibe versión de
contrato 1, fecha del censo que autoriza la ejecución, `runId` y hasta 32 evaluaciones
(500 kB por solicitud, 40 kB por observación con su contexto). Requiere los roles existentes de escritura clínica.
La transacción valida la política global vigente, una ejecución estructural aplicada
y cada episodio contra el documento autorizado. No recibe hospital, rutas ni identidad
de paciente arbitrarios. Los datos identificables del contexto provienen del servidor.

Los campos clínicos de una observación no cambian después de crearla; una repetición
sólo actualiza la última verificación y su ejecución. Primera captura y responsable
se conservan. Las respuestas confirman persistencia únicamente después del commit.
Un error invalida el lote completo. No se registra el contenido clínico en logs.

El tiempo de la fuente conserva el offset. `censusDate` usa la convención nocturna
existente `hhr-night-v1` en Pacific/Easter: desde 00:01 hasta antes de 12:00 pertenece
al día anterior. Esto es atribución de la evaluación, no elegibilidad del paciente.
El contexto de cama pertenece a la primera captura; no prueba la cama al evaluar.

Se exige identificador de evaluación de origen. El HAR validado lo contiene; los
clientes sin identificador deben informar la limitación y no fabricar uno a partir
de categoría/nombre. Esta versión admite resultados A1–D3, con o sin anulación
explícita; un S/C sin evaluación válida es cobertura, no una evaluación archivada.

## Lector

`readCudyrHistory` requiere el acceso clínico callable existente. Lee exclusivamente
el hospital del runtime, hasta 32 días calendario y 100 observaciones por página.
Ordena por fecha de censo e ID; devuelve `nextCursor`, que debe agotarse. Las páginas
reflejan datos disponibles al consultarlas; no constituyen por sí solas un cierre
estadístico ni acreditan cobertura completa de Eloísa. El reporte debe declarar su
corte y conciliación. La consulta usa índice de campo simple y desempate por ID.

El cliente usa `cudyrHistoryService`. No hay acceso directo desde el navegador a la
colección: las reglas conservan denegación por defecto. No se amplían roles ni
permisos generales de edición.

## Despliegue y validación

Owner: sincronización clínica HHR. Riesgo: persistencia de información clínica;
verificar autenticación, autoridad por ejecución, asociación de episodio y atomicidad.
Rollback: revertir el registro de callables/adaptador; conservar el archivo ya escrito.
No ejecutar borrado de datos como rollback.

Antes de habilitar al cliente: verificar despliegue e invocación regional de ambos
callables. Un endpoint nuevo puede requerir que un administrador autorizado complete
su configuración de invocación; este PR no modifica IAM ni hace despliegue manual.

Pruebas: contrato e invariantes, permisos de callables, emulador real con dos escritores
concurrentes, egresado, versiones divergentes, repetición tardía y lectura paginada.
Ejecutar además gates de runtime y release requeridos por el repositorio.
Sólo fixtures sintéticos: no incluir HAR ni datos clínicos reales.

## PR2: captura en la sincronización ordinaria

Cada consulta compartida de Gestión de Camas alimenta tanto la proyección clínica
como el archivo permanente. Se incluyen episodios del censo, cunas y movimientos
activos del día; una cama vacía después del egreso no evita guardar historia recibida.
La extensión 0.48.46 conserva IDs de evaluación/autor/rol, versiones y anulaciones.
Una anulación no integra la proyección clínica vigente.

El escritor admite una constancia opcional `capture`, incluso sin evaluaciones.
La constancia y hasta 32 observaciones se guardan en la misma transacción. Un
historial mayor se divide sin truncar: partes numeradas y total esperado, hasta
256 evaluaciones por episodio. Sólo todas las partes confirmadas acreditan una
captura completa. `cudyrCaptures` conserva por episodio y ejecución los estados
`observed`, `not_observed`, `unavailable` y `legacy_extension`, así como la calidad
de metadatos. `observed` vacío significa que la respuesta observada estaba vacía;
no prueba que jamás existió un CUDYR ni cubre por sí solo todo el mes.

`readCudyrHistory` acepta `kind: captures` para leer estas constancias con idénticos
límites de fecha, paginación y permisos. La ausencia de constancias es desconocida,
no cumplimiento cero. Abrir reportes usa los datos HHR; no inicia capturas Eloísa.

Antes de enviar, HHR guarda el paquete exacto en la cola IndexedDB existente, con
propietario de sesión, límites, estados y reintentos existentes. No acepta un
fallback de memoria como persistencia. Una respuesta ambigua queda pendiente;
únicamente una confirmación explícita del servidor permite retirar el pendiente.
En un replay se revalida la autoridad del mismo censo y episodio; se conservan la
ejecución fuente y el instante original observado. Un cambio de política/episodio
puede bloquear el replay y exige revisión. La cola respeta la limpieza de sesión
existente: cerrar sesión o borrar datos locales puede eliminar pendientes; no es
el archivo compartido hasta confirmar el servidor. Los fallos permanecen visibles
en el resultado de sync y en la cola, sin anunciar un archivo completo.

Despliegue: primero backend, luego frontend/extensión. Mantener desactivado el
consumidor si la invocación regional no está verificada. Rollback: revertir el
consumidor de captura; conservar ambas colecciones y las evaluaciones ya archivadas.

Cuando una respuesta contiene varias versiones distintas de la misma evaluación, se archivan
todas. El token `timeStamp` es opaco y `creationDate` no fecha la revisión: no se elige una
versión vigente por orden de llegada. Esa evaluación se excluye de la proyección clínica
hasta que la fuente sea inequívoca, especialmente si alguna versión está anulada. Las
asignaciones de cama repetidas de un mismo episodio se concilian antes de proyectar.

La integración se habilita con la autoridad clínica `enforced`; los modos de compatibilidad
`off`/`shadow` conservan su recorrido anterior y no ofrecen archivo permanente. Promover esa
política es requisito del despliegue de esta capacidad, ya satisfecho en `hhr-pruebas`.

La entrada pública de cola `queueCudyrArchiveTask` acepta sólo capturas CUDYR completas.
Su payload conserva toda la observación en la misma escritura IndexedDB: no usa una
escritura local separada ni habilita la API de cola heredada para censos clínicos.

Las partes de una captura comparten un manifiesto inmutable en `cudyrCaptureManifests`,
actualizado atómicamente con cada recibo. No se aceptan totales/fechas/estados contradictorios
ni una misma observación en dos partes. El servidor comprueba autor, ID de autor/rol, token
y 14 campos únicos antes de admitir metadatos completos; una captura observada vacía es
válida. Las advertencias de completitud del archivo sólo afectan el modo `enforced`.

El encolado genérico se carga a demanda desde `enqueueStandaloneSyncTask`: conserva el motor
y la política de ownership/backpressure existentes, pero evita incorporar ese recorrido a
la carga inicial del censo. No se aumentaron los límites de bundle para habilitar CUDYR.
