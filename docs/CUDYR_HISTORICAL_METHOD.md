# Fuentes y conciliación histórica de CUDYR

## Fuentes

- Gestión de Camas de Eloísa: categorización mensual y censo diario descargables.
- Egreso estadístico y flujo del paciente: fechas de ingreso, movimientos y salida.
- Registros HHR: instantáneas locales y archivo sincronizado desde Eloísa.

La extensión es el canal de extracción; Firebase es la persistencia. Ninguno constituye
una fuente clínica distinta de los documentos que conserva.

## Reglas reproducibles

1. Recuperar el mes y su día de borde del mes siguiente. Conservar archivos originales.
2. Identificar por documento. Normalizar nombres sólo con evidencia suficiente y enlace único.
   Pasaportes y RUN no son intercambiables; un RN no comparte identidad con su progenitor.
3. Separar episodios y reingresos. No prolongar una estadía a través de egresos documentados.
4. Conciliar día calendario Eloísa con turno HHR. Sin hora, el resultado se atribuye al turno
   nocturno anterior sin inventar una hora registrada.
5. Conservar resultados encontrados independientemente de elegibilidad. Una celda vacía
   requiere fuente final y vínculo inequívoco; una consulta fallida nunca demuestra ausencia.
6. Calcular elegibilidad por día y cama. CMA, UEA y cuna RN sano quedan excluidos; ocho horas
   se calculan desde el tramo hospitalario válido. El primer ingreso sigue visible aunque
   un traslado posterior cambie la cama. Las excepciones manuales conservan autor y motivo.
7. Guardar las revisiones documentales con evidencia, autor y control de concurrencia.
8. Aprobar el mes completo y publicar una proyección oficial verificable en Firebase.

Las categorías contradictorias y las identidades o episodios ambiguos no se resuelven
por coincidencia aproximada ni se cuentan como resultados confirmados. La conciliación
conserva los datos originales y la trazabilidad de cada corrección.

## Comprobación

Pruebas sintéticas cubren la medianoche, cambios de horario, reingresos, RN, pasaportes,
fuentes parciales, fuentes contradictorias, concurrencia, permisos y caché entre sesiones.
La evidencia clínica privada y los informes nominales no se incorporan al repositorio.
