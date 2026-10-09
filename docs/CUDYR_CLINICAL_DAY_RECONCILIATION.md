# Conciliación histórica CUDYR

La recuperación documental conserva las fuentes. Esta etapa calcula una proyección por paciente, episodio y turno, leyendo únicamente lo guardado en Firebase. No cambia el censo original ni escribe escalas manuales.

## Reglas

1. Identificar al paciente por documento; admitir correcciones de nombres sólo con respaldo inequívoco del censo. Mantener separados RN, progenitores, pasaportes y reingresos.
2. Identificar la hospitalización y reconstruir la presencia del paciente con censos, movimientos y contexto documental revisado. Un registro CUDYR prueba su existencia, pero no que el censo incluya a todas las personas.
3. Vincular el dato de Eloísa al turno nocturno. Sin hora, el día calendario D del informe corresponde normalmente al turno D−1; los episodios ambiguos permanecen pendientes. No se inventa una hora de aplicación.
4. Recuperar primer ingreso hospitalario, cama y modalidad del día. Una estancia inicial en UEA no excluye las noches posteriores en Hospitalizados.
5. Separar disponibilidad del resultado de elegibilidad estadística. CMA, cuna RN, UEA, estadía menor de ocho horas y exclusiones justificadas conservan su registro aunque no entren al denominador. La referencia de duración sigue siendo la 01:00 del día siguiente.
6. Declarar ausencia sólo tras un vínculo inequívoco y una fuente completa para el período. Un error de consulta no equivale a ausencia.

## Contexto revisado

`save-verified-context` conserva la justificación, el operador, los documentos de respaldo, los vínculos a informes originales y revisiones con control de concurrencia. Rechaza valores CUDYR manuales. Permite retirar una corrección sin borrar su auditoría. La aprobación oficial del mes pertenece a la siguiente etapa y no se infiere al guardar este contexto.

## Reproducibilidad

Los casos se expresan como reglas generales y pruebas sintéticas. No se codifican excepciones por nombre de paciente. La normalización de nombres es la misma que utiliza la sincronización del censo. El desglose de la recuperación distingue resultado encontrado, ausencia comprobada y vínculo pendiente.
