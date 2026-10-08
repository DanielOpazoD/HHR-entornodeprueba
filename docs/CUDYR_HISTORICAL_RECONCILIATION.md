# Conciliación histórica CUDYR

## Bloque 1: vista previa en lectura

Desde el Explorador CUDYR, consultar un período dentro de un mes y abrir
**Conciliar histórico · solo lectura**. El inventario usa todos los registros del
período consultado, sin heredar los filtros de la tabla principal. Seleccionar una
versión de categorización ya archivada o un archivo local XLS/XLSX; opcionalmente,
añadir el listado de altas administrativas que cubra el intervalo completo.

La lectura local usa un worker limitado, no sube archivos y no persiste resultados.
No cambia censos, puntajes, altas, totales ni las descargas habituales. Al cambiar
período/sesión se descarta la selección local. Se conserva visible el nombre, fecha
de emisión y SHA-256 del archivo local; solo se coteja una versión por tipo.

Las entradas de cotejo no representan una nueva estadística de pacientes-día. Una
coincidencia documental requiere documento y nombre compatibles, episodio HHR
informado, candidato único y fecha literal de aplicación coincidente con el día
Eloísa. No constituye una asignación de episodio: el informe carece de ese ID.
Documentos compartidos, nombres discordantes y varios candidatos quedan pendientes.
Nunca se elige un episodio porque su categoría coincida.

El día censal, la aplicación original y el día del informe permanecen separados.
Sin hora de aplicación, el día del censo no prueba coincidencia temporal. Las
aplicaciones del mes siguiente atribuidas al último turno se muestran pendientes de
cotejar contra ese otro informe; este bloque no combina automáticamente dos meses.
Las celdas vacías no prueban ausencia de CUDYR. Los resultados manuales permanecen
visibles como evidencia HHR aunque no tengan contraparte Eloísa.

El lector de categorización conserva también texto partido por Jasper entre
páginas: solo admite una continuación inmediatamente posterior a un encabezado
repetido, limitada a nombre/diagnóstico/servicio y entre ordinales consecutivos.
No rellena documentos, categorías ni episodios desde esas líneas. La fila fuente
identifica el comienzo del paciente; el archivo original conserva los fragmentos.
Las demás filas sin ordinal siguen siendo errores, no se omiten silenciosamente.

Las altas se preservan por fila original; se omiten encabezados repetidos, no
pacientes repetidos. El formato observado no declara establecimiento ni episodio.
Sus filas se muestran como provisionales; la cama al alta no se proyecta al resto
de la hospitalización. No se reemplaza alta administrativa, alta real ni epicrisis.
El contexto existente conserva exclusiones diarias de cunas y CMA, así como medias
(NEO1/2, H1C1–H6C2) e intermedias (R1–R4), independientes de UPC.

## Etapas siguientes, editables con el piloto

1. **Este bloque:** inventario y comparación en lectura, sobre el complemento mensual.
2. **Vinculación revisable:** incorporar revisión de identidad/episodio, cotejo entre
   meses y decisiones documentadas, sin convertir coincidencias en asignaciones tácitas.
3. **Persistencia:** conservar evidencia y decisiones aceptadas con versiones,
   reanudación e idempotencia; integrar su lectura al explorador/Excel existentes.
4. **Enriquecimiento opcional:** recuperar aplicaciones históricas con autor/hora
   mediante una fuente de episodios cerrados previamente comprobada. No depender de
   que la ficha PDF contenga CUDYR ni de que las últimas tres aplicaciones sean todo
   el historial.

El cierre de un proceso no certifica población completa ni aprobación estadística.
El piloto de julio debe revisar identidad RN, reingresos, transición cuna→MQ,
resultados manuales, cambios de mes y versiones discordantes antes de incorporar
información aceptada. Las pruebas del repositorio usan exclusivamente datos sintéticos.

## Propiedad, riesgo y reversión

Owner: módulo CUDYR. Este bloque agrega lectores locales y un modelo puro de
comparación; reutiliza la frontera binaria del complemento sin cambiar sus contratos
persistidos. No añade funciones remotas, permisos ni sincronización. Riesgo principal:
confundir una coincidencia provisional con evidencia clínica definitiva; se evita
manteniendo estados explícitos y sin acción de aplicar/guardar. Reversión: revertir
el PR; no hay migración ni datos escritos que revertir.

## Bloque 2: borrador de vínculos revisados

La revisión manual está disponible para los mismos permisos operativos que las
correcciones del explorador. Cada fila Eloísa puede quedar pendiente con observación,
descartada del cotejo o con un vínculo propuesto a un episodio. Siempre exige motivo;
proponer un vínculo exige seleccionar el episodio y confirmar revisión de identidad,
episodio y fechas con evidencia adicional. No hay aceptación automática ni por lote.

Se ofrecen todos los episodios consistentes de ese documento en el período leído,
incluidos RN con documento compartido y reingresos. Las filas del episodio muestran
su contexto diario; seleccionar el episodio no proyecta cama, modalidad o elegibilidad
a toda la estancia. Los episodios sin ID o con identidades contradictorias no se
pueden seleccionar. La lectura puede ser incompleta y no equivale al historial total.

Las decisiones son borradores en memoria, revisables y retirables, no vínculos
clínicos aceptados. Se conservan al filtrar/paginar y se descartan al cambiar fuentes,
lectura o permisos, o al salir. No hay localStorage, escrituras remotas, nuevas
solicitudes Eloísa ni inclusión en el Excel. El aviso de pérdida permanece visible.
La decisión de descarte tampoco elimina la fila fuente ni prueba incumplimiento.

El cotejo de meses adyacentes, persistencia con autor/fecha/versiones y aceptación
final quedan para el siguiente bloque. Propiedad: CUDYR. Reversión: revertir este PR;
no hay migración ni registros clínicos que restaurar.

## Bloque 3: revisión mensual que se puede retomar

Se guardan decisiones documentales por mes y fila fuente en `cudyrMonthlyReviews`,
con revisiones inmutables. Se reutilizan `archiveCudyrHistory` y `readCudyrHistory`:
no hay endpoints ni permisos nuevos. Admin y enfermería hospitalaria pueden guardar;
lectura requiere acceso clínico. Firestore directo permanece denegado.

Cada decisión conserva motivo, episodio propuesto (si corresponde), revisor y fecha
del servidor, período, huellas SHA-256 de los archivos y del contexto observado.
El contexto se calcula por caso: filas del mismo documento, episodios relacionados
y posibles identidades en conflicto. Cambios de otros pacientes y marcas de
recaptura no invalidan la revisión. Se conservan fechas clínicas, autores, contexto
diario, cobertura e incertidumbres globales. Cambiar la versión de un archivo
fuente sigue exigiendo cotejo. Las revisiones previas a `case-v1` requieren una
única nueva revisión; no se reescriben ni se validan retrospectivamente.
El archivo original debe seleccionarse de nuevo para cotejar una decisión al volver;
las decisiones fuera de las filas seleccionadas permanecen visibles, nunca se
trasladan automáticamente a otra persona. El contenido se declara `user_review`:
no acredita una aplicación CUDYR ni autentica por sí solo una fuente Eloísa.

Guardar requiere una acción explícita. La revisión usa control de versión para
rechazar sobreescrituras concurrentes e idempotencia por operación. Ante error o
resultado desconocido conserva el borrador y exige recargar. La interfaz separa
pendientes, revisados y decisiones que requieren nueva revisión; permite consultar
versiones anteriores, con su evidencia y revisor. Este último nunca sustituye al
autor clínico. Los borradores sin guardar se descartan al cambiar la lectura.

No cambia censos, aplicaciones, camas, elegibilidad diaria, altas ni estadísticas/
Excel. No recupera automáticamente fichas ni combina meses. El piloto automatizado
usa un informe sintético de julio, guardado, salida de la consulta, reapertura y
lectura de auditoría. El piloto con información real se verifica por separado.

Owner: CUDYR. Riesgos: atribución indebida y pérdida de trabajo concurrente; se
mitigan con estados explícitos, evidencia versionada y comparación de revisión.
Rollback: revertir interfaz y despacho de estos kinds; conservar los documentos
como respaldo, sin alterar datos clínicos. Requiere publicar la versión de las
funciones existentes para habilitarlo en un entorno remoto; el merge por sí solo
no acredita disponibilidad en producción.

## Bloque 4: continuidad y guardado directo

Al volver al período, «Continuar revisión» ofrece los conjuntos de fuentes usados
por las decisiones guardadas. Recupera una versión archivada únicamente si su
SHA-256 coincide. No selecciona la más nueva por nombre. Los archivos locales
faltantes se solicitan por nombre y huella; mientras falte alguno no se permite
guardar nuevas decisiones en esa revisión. «Salir de la revisión retomada» permite
iniciar un cotejo distinto de forma explícita.

La edición valida motivo, episodio y confirmación y guarda con un solo botón.
Se conservan borradores ante errores y se reconoce un guardado cuya respuesta se
perdió al recargar, sin duplicar la revisión. El revisor y el historial muestran
horario de Rapa Nui, conservando los instantes originales en los datos guardados.
No hay guardado automático, nuevas escrituras clínicas ni cambios de permisos.

Owner: CUDYR. Reversión: revertir este bloque de interfaz; las decisiones y fuentes
archivadas conservan el contrato anterior y no requieren migración.

## Bloque 5: búsqueda dirigida a los vacíos observados

El panel plegado «Preparar búsqueda dirigida» parte de los días HHR ya leídos.
Agrupa por episodio e identidad, conservando separados los reingresos, RN con RUT
compartido y filas sin episodio. Excluye por día cunas/CMA; pide resolver primero
la elegibilidad desconocida. Distingue evaluación no observada de autor/fecha
faltantes, preservando las categorías manuales y orientando a su respaldo HHR.
El ID original se conserva en el detalle; su ausencia aislada no genera una tarea.

Se pueden seleccionar hasta 20 casos y descargar una lista de trabajo separada,
con identidad, diagnóstico, cama, grupo, día, campos conservados y siguiente paso.
La descarga no consulta fuentes. «Abrir ficha del episodio» reutiliza la navegación
explícita de la extensión; se bloquea ante un episodio internamente contradictorio.
La dependencia usa la superficie estrecha `rayen-import/clinical-panel`, registrada
para este único consumidor en el control de límites; evita cargar los ejecutores
de importación censal de la superficie general. No admite imports internos libres.
Abrir una ficha no importa aplicaciones ni modifica el censo. La selección dura
esta consulta y no equivale a una decisión guardada ni a cumplimiento estadístico.

Límite comprobado del piloto: el HAR local de julio aporta 12 aplicaciones para
episodios presentes en HHR, todas con autor resoluble. Siete coinciden también en
marca original y categoría con el respaldo diario; ninguna completa un autor
faltante en ese respaldo. No se ha verificado una consulta general de todas las
aplicaciones de episodios cerrados. No se agrega un importador clínico automático
ni se relajan las validaciones del archivo oficial para forzar esa recuperación.
Una fuente incompleta y un resultado vacío no acreditan «no aplicado».

La lista recuerda cotejar la mañana del mes siguiente para el turno de cierre;
conserva las fechas originales y censales sin desplazarlas al exportar. La evidencia
nueva debe guardarse por su flujo autorizado antes de generar Estadística. No se
reemplaza una aplicación ni se completa autoría por coincidencia de RUT/categoría.
Owner: CUDYR. Reversión: revertir panel/lista; sin migración ni cambios de permisos.
