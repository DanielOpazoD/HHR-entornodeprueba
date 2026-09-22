# Sincronización diferida y recuperación histórica — 21-09-2026

## Evidencia y causas

El análisis local de las capturas de HHR y la extensión confirmó que el egreso estadístico era correcto. No se cambió su precedencia ni se reasignaron egresos según el alta médica/enfermería.

- Dos filas administrativas sin episodio inequívoco quedaban como conflictos sin cama ni episodio. La selección clínica trataba cualquier conflicto de esa forma como bloqueo global: diez ocupantes identificados quedaban sin lectura de signos vitales o vías.
- La verificación de episodios del reporte sólo consideraba filas cuya fecha coincidía con la seleccionada. Un reporte histórico abarca también fechas posteriores necesarias para reconstruir quién seguía hospitalizado en el corte elegido.
- El día activo del turno se reutilizaba para el enriquecimiento de censos históricos. Ahora un censo anterior usa su propia fecha; se conserva el caso del calendario actual abierto antes del cambio de turno.
- Las correcciones previas requerían un censo existente y no había planificación para recuperar un intervalo ausente. La nueva propuesta usa trazabilidad por fecha y confirmación explícita de los días afectados.
- La selección de pestañas esperaba todos los sondeos y descartaba candidatas que no habían respondido al sondeo inicial. Un relé perdido tras actualización podía seguir sin recuperación dirigida porque el marcador de instalación ya existía.

## Contratos conservados

La ambigüedad de un RUN compartido sigue pendiente y aísla a sus posibles episodios, incluidas cunas. Un conflicto realmente global sigue bloqueando la lectura clínica. La recuperación conserva permisos, firmas, identidad por episodio, versiones autoritativas y la separación de escrituras de camas/movimientos. No reproduce observaciones clínicas actuales en el pasado. La preferencia de pestaña es un indicio invalidable, no una prueba de sesión iniciada; los errores de autenticación no disparan reinyección.

## Reproducción local sin escrituras clínicas

Al repetir el procesamiento sobre las respuestas capturadas, usando los parsers del proyecto:

| Captura                                            | Antes   | Con corrección |
| -------------------------------------------------- | ------- | -------------- |
| Día 21, pacientes habilitados para lectura clínica | 0 de 10 | 10 de 10       |
| Intervalo histórico, filas con episodio verificado | 2 de 10 | 8 de 10        |
| Día 20, pacientes habilitados para lectura clínica | 0 de 6  | 6 de 6         |

Las dos filas ambiguas permanecen pendientes. Estos resultados prueban selección y verificación local; no equivalen a una sincronización real ni acreditan persistencia de signos vitales/VVP en Firebase. Las capturas originales y sus datos sensibles permanecen fuera del repositorio. Las regresiones usan pacientes ficticios.

## Identificación extranjera — ampliación del 22-09-2026

Una captura posterior mostró que el mismo código alfanumérico no recuperaba episodios con los tipos de identificación 9 (pasaporte) y 10 (documento de origen), pero sí con el tipo 3 (Número de Identificación). La descarga estadística solicitaba el episodio devuelto por esa consulta. La captura no contiene el cuerpo del PDF; no se deduce su contenido ni una nueva fecha de egreso.

La reproducción local de la consulta, sin peticiones ni escrituras externas, confirmó dos defectos: el normalizador eliminaba la letra del código y la búsqueda se restringía a RUN/RUN materno (2/4). Con el código oficial completo y la búsqueda extranjera por 3/9, la misma respuesta capturada permite verificar el episodio exacto. Los tests deben mantener distintos un pasaporte y un RUN cuya parte numérica coincida, y preservar el tipo documental en HHR. Los identificadores reales no se incorporan a las fixtures.

## Recuperación de conexión después de actualizar

La comprobación del navegador mostró que HHR sí alcanzaba su relé, pero éste recibía
`Could not establish connection. Receiving end does not exist` al hablar con el worker.
Eso no demuestra una sesión de Eloísa vencida ni permite atribuir el fallo a una pestaña
específica. La versión instalada y sus errores locales deben contrastarse con el paquete.

El arranque ahora tiene una frontera mínima (`background-bootstrap.js`) que registra
un receptor síncrono antes de importar los módulos. Si una importación falla, responde
con `EXTENSION_STARTUP_FAILED` y una instrucción concreta; nunca inventa generación,
sesión ni disponibilidad clínica. Los detalles del error quedan en el diagnóstico local
de la extensión y no se devuelven a las páginas. Si el arranque termina correctamente,
se retira ese receptor y queda sólo el router habitual. El gate conserva la validación
de todo el grafo de módulos y exige la nueva entrada de arranque. El router privado
del documento offscreen utiliza la ruta del worker declarada en el contrato interno;
su E2E exige que coincida exactamente con el manifiesto y verifica la comunicación
con el paquete real. Esto evita depender de `getManifest`, no disponible en el
documento offscreen de la prueba, y conserva el rechazo de otros remitentes.

La recuperación de relés reemplaza listeners huérfanos, exige respuesta a un ping antes
de registrar éxito y recupera la generación de los documentos legibles sin que una
pestaña descartada invalide las demás. Los documentos discrepantes siguen bloqueados.
Gestión de Camas anuncia su disponibilidad cuando obtiene contexto, incluso si el worker
aparece después del primer intento. Los auxiliares clínicos no idempotentes requieren
recargar su página; no se reinyectan indiscriminadamente.

### Identidad de movimientos al reanudar

`applyCrossDayDiff` reemplaza el `idFactory` recibido por un ID determinista de episodio
(o identidad heredada) y fecha, tanto al construir el plan esperado como al guardarlo.
La aserción de recuperación compara esos mismos IDs; no compara UUID aleatorios con
un identificador fijo. La regresión `ubica los egresos en su fecha y deduplica por
 episodio al reanudar` ejecuta la recuperación dos veces y comprueba una sola escritura.

### Reanudación entre corridas

La recuperación usa dos fronteras autoritativas: movimientos y, después, un único patch
atómico para camas más `activeExtraBeds`. Así, un fallo entre ambas deja un estado
reconocible sin agregar metadata al censo: camas vacías y movimientos deterministas cuya
procedencia es `gestion_camas`, con `lineageId` igual al ID persistido y una corrida previa
identificada. La captura siguiente reconstruye la propuesta desde un censo vacío, compara
la evidencia nueva con cada movimiento persistido y exige una nueva confirmación humana.

El `syncRunId` anterior se conserva como evidencia y no se reemplaza por el de la nueva
corrida. La compatibilidad exige coincidencia del movimiento completo, excepto los sellos
operativos variables de clasificación. Un movimiento manual, reclasificado, eliminado,
modificado o adicional impide adoptar el día como parcial. También quedan fuera los censos
firmados, sincronizados, bloqueados u ocupados. Un día que sólo requería movimientos y ya
está completo se reconoce como trabajo terminado y no vuelve a proponerse.
