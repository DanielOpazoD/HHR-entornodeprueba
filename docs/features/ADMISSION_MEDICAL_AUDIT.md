# Auditoría de ingresos médicos

`Más → Ingresos médicos` (`?module=ADMISSION_AUDIT`) es una consulta de sólo lectura
para el administrador. La matriz de acceso, la ruta y el componente comprueban el rol.
Los resultados viven en memoria y se descartan al cambiar de usuario, rol o sesión de
Eloísa. No se escriben notas, indicaciones ni resultados de auditoría en Firestore.
La restricción de administrador corresponde al panel y su cohorte en HHR. La lectura
clínica de base conserva la autorización de la sesión Eloísa, igual que los informes
completos de hospitalización ya disponibles en Documentos para auditoría; no introduce
una categoría de información clínica reservada a administradores de HHR.

## Población y atribución

El período filtra la **fecha de hospitalización registrada en HHR**, con extremos
incluidos. La consulta exige censos confirmados por servidor, en lotes mensuales;
incluye camas, cunas clínicas y movimientos de alta/traslado no eliminados. Se agrega
un día a cada extremo para los ingresos nocturnos. Un traslado no es un nuevo ingreso:
la identidad es persona + episodio. Se requiere episodio y fecha identificables;
no es un censo completo de todas las hospitalizaciones de Eloísa ni incluye CMA.
Los snapshots de movimientos sólo aportan identidad, episodio y metadatos del ingreso;
el contenido de evoluciones, signos vitales e indicaciones siempre se consulta en Eloísa.

Se elige la primera evolución médica vigente desde la fecha/hora de ingreso:
no enfermería, entrega de turno, texto archivado o tachado. Si falta la hora, se usa el
inicio del día y se informa. La agrupación usa el nombre de autor documentado, no el
médico tratante ni una inferencia sobre quién decidió hospitalizar. Homónimos no se
pueden distinguir con el contrato disponible. Primeras evoluciones simultáneas de
distintos autores o sin autor quedan **Sin atribuir**. El recuento por médico excluye
lecturas fallidas; los pacientes sin evidencia suficiente permanecen visibles.

No se puntúa ni se interpreta automáticamente la calidad del contenido. Una primera
nota disponible posterior al día del ingreso conserva su fecha y muestra una advertencia.
Las evoluciones sin fecha verificable impiden determinar el primer registro.
Las versiones del mismo identificador se resuelven por el evento histórico más reciente
antes de seleccionar la primera evolución vigente; revisiones discrepantes sin orden
verificable bloquean esa lectura.

## Fuentes históricas

Se requiere extensión Eloísa **0.48.77 o superior**, sesión vigente de Ficha Médico y
conexión. La petición `historyFrom` exige una ventana que alcance el ingreso, confirmada
en la respuesta; una extensión anterior detiene la consulta. El límite explícito es
4000 días, validado antes de consultar los censos. La auditoría solicita historial y formularios
históricos de signos vitales con la misma sesión Eloísa, sin exigir presencia en el censo actual;
omite plan actual, validaciones diarias, estado actual de fármacos y documentos adjuntos.
Los demás consumidores conservan la ventana habitual de 14 días.

Las primeras indicaciones se obtienen de las órdenes fuente, sin reconstrucción por
validación diaria. El selector permite el primer día que contiene indicaciones o sólo
el primer conjunto con igual fecha-hora (criterio inicial). La selección no se corta
a medianoche: un ingreso a las 23:59 incluye las primeras órdenes de las 00:30 del día
siguiente. Se conserva la versión más temprana disponible
por identificador. Si una orden sin identificador estable tiene registros previos al ingreso, sus posibles
revisiones se omiten como iniciales y se informa la ambigüedad.
Los empates de publicación se ordenan por la primera observación histórica de la fuente;
versiones iniciales discrepantes sin un orden verificable quedan como no verificables.
En registros sin identificador, contenidos distintos con la misma categoría y publicación
son ambiguos: el texto mutable no sirve como prueba de identidad de una orden.
Se conserva el contenido inicial disponible incluso si la fuente marca la orden
archivada, suspendida o finalizada; no se reconstruye su estado clínico con esas marcas.
Órdenes sin fecha verificable
impiden determinar las primeras y producen una advertencia.

Los signos vitales corresponden a la primera toma verificable desde el ingreso, con
fecha/hora real y valores ausentes explícitos. Si la primera toma es de otro día se
informa. Los horarios se presentan con el reloj hospitalario `Pacific/Easter`.
Una toma sin fecha-hora verificable impide afirmar que una toma posterior fue la primera;
la cobertura de auditoría detecta también formularios que el parser habitual descartó por falta de fecha.

Un error de lectura no equivale a ausencia. Un fallo de actualización conserva la
última lectura del mismo paciente/episodio y la marca como tal; un fallo del censo
conserva el informe anterior y su período. Cancelar o cambiar sesión impide publicar
respuestas tardías.

## Libro descargable y validación

La descarga HTML incluye el médico seleccionado (o todos), índice médico/ingreso,
primera evolución, toma de signos vitales y primeras indicaciones, con autores,
fechas y advertencias. Es autónoma, sin recursos externos; el texto fuente se escapa
como texto. Incluye impresión y opción del navegador para guardar PDF. Cambiar los
controles deshabilita la descarga hasta consultar de nuevo. Un libro parcial conserva
sus advertencias; el archivo descargado no se revoca al cerrar sesión.
No se puede exportar un conjunto en el que fallaron todas las lecturas clínicas, aunque
se conserven datos previos en pantalla.

Pruebas focalizadas: `src/tests/features/admin/admission-audit/`, puente clínico,
runtime de extensión y política de acceso. Cierre: `ci:merge-gate`,
`test:release-confidence`, release gate de extensión, revisión independiente y CI
del SHA definitivo. La evidencia visual utiliza sólo datos sintéticos; no acredita
la completitud histórica del servidor Eloísa en producción.
