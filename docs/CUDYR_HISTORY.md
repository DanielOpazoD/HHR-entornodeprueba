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
