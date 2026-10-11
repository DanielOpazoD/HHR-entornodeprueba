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
- **No elegible:** el caso permanece visible, pero queda fuera del cumplimiento y del Excel de elegibles.
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
la pantalla. Al cambiar de mes se selecciona el último día disponible.

Ver [cierre oficial](CUDYR_OFFICIAL_MONTH.md), [recuperación de fuentes](CUDYR_MONTHLY_RECOVERY.md)
y [conciliación clínica](CUDYR_CLINICAL_DAY_RECONCILIATION.md).

El modelo de reconstrucción histórico se descarga bajo demanda, igual que el explorador
y su cargador. Se excluye del precaché de instalación; el límite global no aumenta.
La copia de datos por sesión y la proyección oficial siguen disponibles tras abrir el módulo.
