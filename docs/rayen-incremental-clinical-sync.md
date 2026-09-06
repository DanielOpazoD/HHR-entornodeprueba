# Sincronización clínica incremental Eloísa → HHR

## Objetivo

La sincronización trata a Eloísa como una fuente de hechos clínicos estables, pero corregibles. HHR
conserva su censo como proyección local y sólo persiste un cambio cuando un hecho nuevo o una
corrección altera el resultado clínico. Repetir una sincronización con la misma información debe ser
un _no-op_ por paciente.

El alcance inicial comprende signos vitales, Braden/Downton y evidencia de actividad de Enfermería /
TENS. No introduce _event sourcing_, infraestructura nueva ni escrituras paralelas.

## Identidad, checkpoint y correcciones

- Cada paciente/episodio guarda un `clinicalSyncCheckpoint` por fuente.
- El contrato tiene versiones independientes de esquema y huella. Una versión desconocida se ignora
  y se reconstruye desde la fuente; nunca bloquea la sincronización.
- Si Eloísa entrega identidad estable (`encounterEventId`), ésta identifica el hecho. Si no existe,
  se usa una huella determinista del contenido como alternativa.
- Las identidades y contenidos se guardan únicamente como hashes. El checkpoint y la telemetría no
  almacenan nombres, RUT, profesionales ni valores clínicos en texto claro.
- El mismo identificador con igual huella es duplicado; con distinta huella es una corrección. La
  corrección reemplaza la proyección anterior y conserva la trazabilidad normal del censo.
- Cada fuente conserva una ventana acotada de 128 hechos recientes. Es el solapamiento que permite
  reconocer reintentos y correcciones tardías sin crecimiento ilimitado.

## Escrituras y consistencia

### Fecha y hora de signos vitales

HHR y la extensión resuelven el campo clínico de la toma en UTC cuando no declara offset,
y muestran fecha y hora del mismo instante en `Pacific/Easter`. Una toma retrospectiva
conserva su hora clínica, aunque se haya registrado después.

Si ese campo apunta a un instante posterior al sello resoluble del propio registro
(`effectiveWhen`, incluyendo revisiones de campos), es contradictorio: se usa el sello
del registro con offset, que en el incidente observado coincide con el historial original.
Esto no demuestra la hora real de una toma en todos los casos; es una recuperación del
registro fuente, no una corrección de Eloísa. Sin un sello con offset no se inventa una
corrección. No se usa el reloj del equipo ni una resta horaria fija.

Ambos lectores ordenan por el instante resuelto y sólo desempatan por identificador de
evento. Al reimportar, HHR reemplaza la hora anterior del mismo `sourceEventId` sin crear
otra toma. La recuperación requiere releer la fuente; no modifica datos en Eloísa.

- Las lecturas remotas mantienen concurrencia acotada e independiente por fuente.
- Las escrituras del censo se serializan para evitar conflictos de versión entre pacientes de una
  misma ejecución.
- El primer parche clínico exitoso captura una copia histórica completa. Los restantes parches de la
  misma ejecución omiten esa copia repetida. Si el primer parche falla, el siguiente vuelve a pedirla.
- Una ejecución sin cambios produce cero parches por paciente; sólo puede actualizar el evento de
  auditoría agregado.
- La ausencia de un hecho en una lectura parcial o fallida nunca se interpreta como eliminación.
- CUDYR, D-7, zona `Pacific/Easter`, doble fuente de escalas, vínculo madre-cuna y trazabilidad de cama
  mantienen sus reglas existentes.

## Destilación del flujo

La sincronización conserva sólo los pasos que agregan evidencia o protegen consistencia:

1. captura atómica del censo de Ficha Médico y el reporte administrativo de Gestión de Camas;
2. conciliación del censo y consulta de evidencia individual únicamente cuando una cama, un egreso o
   un ingreso nocturno lo requiere;
3. aplicación del cambio confirmado y enriquecimiento clínico independiente;
4. persistencia granular sólo de hechos nuevos o corregidos.

Dentro de una ejecución, las consultas repetidas del mismo informe oficial de trazabilidad se
coalescen por `ENC_ID`. Una respuesta válida puede alimentar tanto la reconstrucción histórica como
la verificación del ingreso nocturno sin volver a descargar el PDF. La caché vive sólo durante esa
sincronización y descarta respuestas vacías, errores y excepciones para conservar el reintento. No se
comparte entre ejecuciones: una sincronización posterior siempre puede observar movimientos nuevos.

No se eliminan las lecturas completas de signos vitales, escalas o actividad clínica porque Eloísa no
ofrece todavía un cursor remoto que permita demostrar que una lectura parcial contiene correcciones
y elementos archivados. Tampoco se paralelizan escrituras del mismo censo ni se eleva la concurrencia
remota sin evidencia de capacidad; ambos atajos reducen tiempo a costa de consistencia o estabilidad.

## Reanudación y recuperación

- Sólo existe una ejecución clínica activa y una pendiente. Solicitudes repetidas del mismo `runId`
  se coalescen; si llegan distintas solicitudes mientras hay una activa, sólo se conserva la última.
- Un evento de censo en estado `applied` se reanuda desde “Reintentar” sin volver a capturar ni aplicar
  el censo completo.
- La reconciliación completa queda como recuperación deliberada cuando cambia la versión del
  checkpoint o se sospecha pérdida de evidencia. No es el camino habitual.

## Telemetría segura

El evento de sincronización registra sólo contadores agregados: recibidos, nuevos, duplicados,
correcciones, parches por paciente y copias históricas. El historial los muestra para distinguir una
ejecución útil de una repetición idempotente sin exponer información clínica o identificatoria.

## Estrategia de activación

La fusión incremental se valida contra la proyección completa mediante pruebas de regresión: mismo
resultado clínico, repetición sin escrituras, corrección tardía convergente, fallas parciales sin
borrado y una sola copia histórica por ejecución. Los endpoints actuales no ofrecen un cursor remoto
confiable; por eso esta etapa reduce primero el procesamiento y las escrituras observadas en HHR sin
recortar de forma insegura la lectura de la fuente. Un filtro remoto sólo debe habilitarse cuando el
contrato de Eloísa permita demostrar equivalencia con la lectura completa.
