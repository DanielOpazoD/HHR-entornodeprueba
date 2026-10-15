# CUDYR: control diario e informe mensual

## Lectura

El registro CUDYR proviene exclusivamente de Eloísa. HHR conserva los resultados y
sus fuentes; no permite inventar escalas, autores ni horas. Abrir la vista y descargar
Excel lee Firebase o una copia local de la sesión. Sólo «Completar y verificar mes»
consulta los informes de Eloísa mediante la extensión.

Un mes aprobado se lee como una proyección oficial guardada, sin reconstruir cada día.
La navegación reutiliza el caché por cuenta y sesión. La verificación remota comprueba
la versión de fuentes; un fallo conserva la última copia e informa la falta de conexión.
El cambio de cuenta no reutiliza los datos clínicos de la sesión anterior.

## Interpretación

- **Registrado:** existe una categorización en Eloísa; no implica elegibilidad.
- **No registrado:** la fuente final completa no contiene una categorización para ese caso.
- **Verificación pendiente:** falta completar una consulta o resolver una discrepancia.
- **No elegible:** el caso permanece visible, pero queda fuera del cumplimiento; conserva su detalle en el Excel mensual.
- **Oficial:** población reconstruida y resultados aprobados con trazabilidad, no cumplimiento del 100%.

Los días abiertos muestran progreso; no penalizan el acumulado cerrado. La aplicación
puede registrarse hasta las 11:59 del día siguiente. La 01:00 es la referencia fija para
calcular ocho horas, no la hora obligatoria de registro del instrumento.

## Vista y exportación

La tabla conserva cama Eloísa, tipo de cama, paciente, puntajes, categoría, primer ingreso
hospitalario, registro y estado. Los movimientos, origen histórico y motivos de exclusión
se consultan en detalles. Una excepción manual cambia elegibilidad, nunca el CUDYR.
Altas, traslados externos y fallecimientos resueltos se consultan en el explorador.

El desglose mensual de exclusiones separa personas de pacientes-día y permite abrir los
casos. El Excel usa el mismo conjunto de datos y las mismas reglas de días cerrados que
la pantalla. «Excel mensual» conserva el resumen de categorías A1–D3 y una hoja por
fecha; usa **Cama intermedia** y **Cama media**. Debajo del resumen diario incluye
paciente, documento, cama, categoría, ingreso, autor/fecha del registro,
estado, elegibilidad y motivo, en blanco y negro y sin rellenos de color. Excluidos y casos por revisar permanecen
visibles fuera del cálculo. Un resultado histórico no inventa autor, hora ni puntajes.
El porcentaje mensual es la suma de registros de elegibles dividida por la suma de
pacientes-día elegibles. Sin elegibles se deja vacío; días abiertos y censos faltantes
se identifican, sin presentarlos como 0% de cumplimiento. El resumen mensual conserva
solo la fórmula del cálculo y los criterios de elegibilidad. La descarga no consulta Eloísa ni envía correos.

La segunda hoja presenta los valores del informe de Eloísa guardado en Firebase
como tabla legible: encabezado único fijo y columnas de identificación inmovilizadas.
Omite Ficha Clínica y reemplaza Días Hosp. por Fecha de ingreso (dd-mm-aaaa),
obtenida del episodio HHR vinculado; sin evidencia inequívoca indica No informado.
Las fechas con zona horaria se comparan por instante: UTC y hora local equivalentes
no son una contradicción. En filas con información solo el día 1, se puede recuperar
el ingreso del mes anterior desde un egreso confirmado ese día: exige documento y
nombre completo coincidentes, una sola fila fuente y un único episodio, sin conflictos.
Este cruce solo anota el Excel; no crea evidencia mensual ni modifica elegibilidad.
El período se muestra como Agosto 2026, con nombre del mes y año.
Elimina encabezados de página repetidos. Omite las exclusiones confirmadas por fila
del informe, episodio y fecha de aplicación (no por nombre ni fecha censal). Un
episodio mixto conserva sus días no excluidos; si todos sus días con información
están excluidos, se omite la fila. Vínculos ambiguos o sin clasificación no se
presumen excluidos. Las hojas diarias y los archivos originales conservan el detalle.
Los formatos antiguos no reconocidos mantienen sus celdas originales completas.
Si se utiliza el mes siguiente, incluye solo el día 1 y filas con valores (incluido S/C).
Los originales se conservan completos. La nota del encabezado identifica archivo y huella.
Los símbolos ▼ ingreso y ▲ egreso son anotaciones de HHR, con fecha calendario de Rapa Nui,
solo cuando existe vínculo inequívoco entre fila del informe y episodio. No se infieren
movimientos desde las categorías, no se asocian solo por nombre y no se sustituyen valores CUDYR.
La nota de cada marcador informa fecha/hora disponible y valor original. Sin evidencia
suficiente o con fechas contradictorias, se omite el marcador; eso no acredita ausencia
de movimiento. No cambia el turno censal ni el cálculo del cumplimiento.

El indicador pequeño del censo conserva una lectura diaria por mes, cuenta y sesión.
Editar el censo, recuperar el foco o volver a mostrar el cuadro no repite la lectura.
La primera sincronización clínica terminada del día para ese censo actualiza el indicador
una vez; las posteriores conservan el estado. El día 1 también actualiza el último
turno del mes anterior. El nuevo día se determina en Rapa Nui.
La vista detallada mantiene su actualización explícita y el control del plazo de registro.

Al cambiar de mes se selecciona el último día disponible.

Ver [cierre oficial](CUDYR_OFFICIAL_MONTH.md), [recuperación de fuentes](CUDYR_MONTHLY_RECOVERY.md)
y [conciliación clínica](CUDYR_CLINICAL_DAY_RECONCILIATION.md).

El modelo de reconstrucción histórico se descarga bajo demanda, igual que el explorador
y su cargador. Se excluye del precaché de instalación; el límite global no aumenta.
La copia de datos por sesión y la proyección oficial siguen disponibles tras abrir el módulo.

El generador de «Excel mensual» se carga al descargar, igual que ExcelJS; queda fuera
del precaché de instalación y tiene un límite propio de 12 KB. Esto no cambia las
fuentes ni la caché de datos del censo. La primera descarga requiere acceso a esos
recursos estáticos; no realiza una sincronización con Eloísa.
