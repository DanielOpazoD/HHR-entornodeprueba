# Contrato operativo de HHR

Reglas de negocio que deben mantenerse aunque cambien pantallas, código o mecanismos
de sincronización. Explican la intención del producto, no su implementación.
Ámbito inicial: identidad, censo, recién nacidos, CUDYR y persistencia compartida.
No pretende definir todavía todos los módulos del hospital.

## Uso por personas e IA

1. Leer estas reglas y el [glosario](GLOSSARY.md) antes de modificar el área afectada.
2. Identificar qué reglas debe conservar el cambio; usar sus identificadores en la revisión.
3. Si código y regla divergen, señalar la discrepancia. No convertir un error existente
   en una nueva regla ni corregir datos clínicos por suposición.
4. Cambiar una regla requiere una decisión explícita del responsable del producto,
   su motivo y ejemplos de aceptación actualizados. Un refactor no autoriza ese cambio.

Una **invariante** protege una distinción permanente, por ejemplo identidad frente a
ubicación. Una **política operativa** fija una decisión vigente, por ejemplo un horario.
Ambas deben conservarse durante cambios técnicos; una política puede revisarse por una
decisión clínica u operativa explícita. Los identificadores siguientes son estables.

## Identidad y fuentes

| ID | Comportamiento esperado | Por qué |
| --- | --- | --- |
| ID-01 | Identificar primero por documento y tipo de documento. Usar nombres normalizados como respaldo sólo con coincidencia inequívoca y contexto del episodio. | Una cama cambia; un nombre puede venir mal escrito. Un pasaporte no se convierte en RUN. |
| ID-02 | Separar persona, hospitalización y ubicación. Un reingreso es otro episodio, aunque ocurra el mismo día y en la misma cama. | Evita prolongar estadías o trasladar resultados entre hospitalizaciones. |
| ID-03 | El RUN materno vincula al RN con su madre; no convierte a ambos en la misma persona. Un identificador de otro progenitor no demuestra ese vínculo materno. | El RN tiene registro y resultados propios, incluso sin documento propio. |
| SRC-01 | Distinguir fuente clínica, canal de extracción y almacenamiento. Eloísa Gestión de Camas y Eloísa Ficha Clínica aportan evidencia; la extensión la rescata y Firebase/HHR la conservan. | Cambiar el canal no cambia el origen ni da mayor autoridad al dato. |
| SRC-02 | Conservar procedencia y correcciones justificadas. HHR contiene información sincronizada y datos locales; no todo campo es una copia automática de Eloísa. | Permite explicar qué se observó, qué se corrigió y con qué respaldo. |

## Fechas y población del censo

| ID | Comportamiento esperado | Por qué |
| --- | --- | --- |
| TIME-01 | Separar fecha real del evento y día del censo al que corresponde el turno. Un evento de madrugada puede pertenecer al turno nocturno anterior sin cambiar su fecha real. | Eloísa informa días calendario; HHR también representa turnos. |
| TIME-02 | Interpretar horarios en Rapa Nui. No corregir discrepancias sumando o restando dos horas por aproximación. | El desfase puede deberse a zona horaria o a eventos distintos; los minutos iguales sólo son una pista. |
| TIME-03 | Mostrar el alta con fecha y hora del egreso estadístico que libera la cama. No sustituirlas por la hora de emisión de la epicrisis ni por la hora de sincronización. | Son hechos distintos, aunque pertenezcan al mismo episodio. |
| CEN-01 | Una lectura sin errores no demuestra que un censo histórico contenga a todos los pacientes. Reconstruir presencia con ingresos, movimientos, egresos y otras fuentes disponibles. | Una sincronización antigua puede haber omitido pacientes. |
| CEN-02 | Si la evidencia acredita una hospitalización omitida, incluirla en la reconstrucción del turno correspondiente, manteniendo el censo original y la trazabilidad. | La ausencia en una copia local no demuestra ausencia del hospital. |

## Recién nacidos: identidad primero, ubicación después

| ID | Comportamiento esperado | Por qué |
| --- | --- | --- |
| RN-01 | Asociar por RUN materno; como alternativa, por «RN de…» con madre identificada inequívocamente. La cama sola nunca identifica a la madre. | Una ubicación mal registrada no debe crear parentescos. |
| RN-02 | Si madre identificada y cuna coinciden, sincronizar sin otra pregunta. Si difieren, pedir ubicación: cuna con madre o cama independiente, mostrando las unidades y su disponibilidad. | Sólo una discrepancia real necesita una decisión. |
| RN-03 | Ante asociación incierta, solicitar confirmación y conservar los vínculos comprobados. Una cuna sin madre hospitalizada puede permanecer independiente; no inventar una madre ni forzar anidamiento. | No todo RN debe quedar bajo una mujer del censo. |
| RN-04 | Respetar la clasificación del RN hospitalizado en cama independiente médico-quirúrgica. No tratarlo como RN sano en cuna por su edad o por el prefijo «RN». | Puede requerir CUDYR; su elegibilidad se evalúa con sus propias condiciones. |
| RN-05 | Si Eloísa corrige la ubicación y coincide con la ya confirmada, aceptar sin otra confirmación. Un cambio posterior a otra ubicación vuelve a requerir revisión. Mantener un aviso breve de corregir Gestión de Camas mientras exista discrepancia. | Una decisión resuelve una discrepancia concreta, no todos los cambios futuros. |

## CUDYR: registro y elegibilidad son decisiones separadas

| ID | Comportamiento esperado | Por qué |
| --- | --- | --- |
| CUD-01 | Eloísa es la única fuente del registro CUDYR. HHR no admite puntajes manuales ni inventa autor u hora; una excepción manual sólo cambia elegibilidad. | Tener autorización para corregir el censo no autoriza crear una escala. |
| CUD-02 | Conservar todo CUDYR válido encontrado, aunque el paciente no sea elegible. La estadística usa sólo pacientes-día elegibles. | «Registrado» y «elegible» responden preguntas distintas. |
| CUD-03 | Evaluar elegibilidad por paciente, episodio y turno: excluir CMA en Pabellón u Hospitalizados, RN sano en cuna, Urgencias/UEA, duración insuficiente y exclusión manual justificada. Una estancia inicial en UEA no excluye las noches posteriores en Hospitalizados. | La situación de ingreso no define toda la estadía. |
| CUD-04 | Usar la 01:00 del día siguiente como referencia fija para exigir más de ocho horas del tramo hospitalario válido. No es una hora obligatoria de llenado. | Un CUDYR de las 00:05, 03:00 o 11:59 puede corresponder al mismo turno. |
| CUD-05 | La ventana de registro del turno D va desde las 00:01 hasta las 11:59 de D+1. Una sincronización la noche de D no puede demostrar ausencia del CUDYR de ese turno antes de abrirse la ventana. | Evita presentar como error un registro que aún no corresponde consultar. |
| CUD-06 | Sin hora en el informe histórico, atribuir el registro a la madrugada anterior a las 08:00 del día calendario informado y al turno previo. Conservarlo como supuesto operativo, sin inventar una hora exacta; resolver ambigüedades de episodio con evidencia. | Recupera el turno sin fabricar datos documentales. |
| CUD-07 | Distinguir resultado encontrado, consulta final completa sin resultado y consulta pendiente/fallida. Usar «No registrado» sólo en el segundo caso. Para un excluido sin registro esperado, mostrar «No aplica»; si tiene CUDYR, conservar «Registrado» y la exclusión. | Un fallo técnico no demuestra ausencia; una exclusión no es una tarea pendiente de aplicación. |
| CUD-08 | Admitir el resultado del Excel mensual aunque falten autor u hora. Marcar su procedencia y recuperar también la mañana del primer día del mes siguiente. | Es un registro válido; el último turno del mes cruza la medianoche. |
| CUD-09 | Cumplimiento = pacientes-día elegibles con CUDYR / pacientes-día elegibles. Separar personas de pacientes-día y excluir el día abierto del acumulado cerrado. | Evita sumar personas repetidas o penalizar registros aún dentro de ventana. |

## Guardado y condición oficial

| ID | Comportamiento esperado | Por qué |
| --- | --- | --- |
| SAVE-01 | Distinguir captura, propuesta, guardado local y confirmación remota. Reintentar sin duplicar ni perder cambios; conservar los que todavía no se han enviado. | Ver un dato en pantalla no acredita su guardado compartido. |
| SAVE-02 | Un conflicto entre equipos requiere conciliación; ni la última escritura ni el reloj de un navegador deciden por sí solos la verdad clínica. | Protege decisiones y datos de otros usuarios. |
| SAVE-03 | Retirar sólo pendientes demostrablemente obsoletos, conservando respaldo. Nunca retirar resultados válidos ni presentar un envío retirado como confirmado. | Simplificar la interfaz no permite ocultar pérdidas. |
| OFF-01 | Recuperar un mes no lo aprueba automáticamente. «Oficial» exige población reconstruida, resultados y elegibilidad resueltos, aprobación autorizada y trazabilidad. No significa cumplimiento del 100%. | Se certifica la calidad del cálculo, no que todos tengan CUDYR. |
| OFF-02 | Consultar el mes oficial desde su proyección guardada en Firebase y reutilizar su copia local válida. Abrir o navegar no debe volver a consultar Eloísa ni reconstruir el mes. | Los datos ya resueltos deben estar disponibles rápidamente. |
| OFF-03 | Una corrección documental, de egreso o de elegibilidad relevante exige revisar la vigencia del informe oficial afectado. Una lectura rutinaria no equivale a una corrección. | Mantiene rapidez sin declarar inmutable un informe que realmente cambió. |

## Ejemplos de aceptación

- **Madre en R3, RN identificado y cuna C-R3:** importar sin pregunta (RN-01, RN-02).
- **Madre en R3, cuna informada C-R2:** pedir ubicación real y avisar de corregir Gestión
  de Camas. Si luego Eloísa informa C-R3 y ésa fue la elección, no volver a preguntar;
  una ubicación posterior distinta se revisa (RN-02, RN-05).
- **RN enfermo en cama independiente:** conservar su clasificación y evaluar CUDYR
  con las reglas del caso; no excluirlo sólo por ser RN (RN-04, CUD-03).
- **Alta a las 01:47 del día 10, en turno nocturno del 9:** mostrar día 10, 01:47,
  dentro del censo del 9. Una epicrisis emitida a otra hora no cambia el egreso (TIME-01, TIME-03).
- **Ingreso el día 2 a las 14:00, omitido en censo local; CUDYR del día 3:** reconstruir
  presencia del turno del 2 con evidencia del episodio. Conservar el resultado y evaluar
  elegibilidad por separado (CEN-02, CUD-02, CUD-06).
- **CMA con CUDYR registrado:** mostrar resultado y exclusión; no sumarlo al cumplimiento
  ni etiquetarlo como pendiente de aplicación (CUD-02, CUD-07).
- **Consulta fallida:** mantener verificación pendiente; no mostrar «No registrado» (CUD-07).
- **Mes oficial al volver a abrir:** leer la proyección guardada; no lanzar recuperación
  histórica de Eloísa (OFF-02).

## Documentos de detalle

Estos documentos conservan la mecánica y evidencia de cada área, sin reemplazar la intención:

- [Verdad compartida del censo](ADR_DAILY_CENSUS_TRUTH_CONTRACT.md).
- [Recuperación del censo y ubicación neonatal](RUNBOOK_DAILY_CENSUS_RECOVERY.md).
- [Control diario CUDYR](CUDYR_DAILY_CONTROL.md).
- [Fuentes y conciliación histórica](CUDYR_HISTORICAL_METHOD.md).
- [Conciliación por episodio y turno](CUDYR_CLINICAL_DAY_RECONCILIATION.md).
- [Cierre mensual oficial](CUDYR_OFFICIAL_MONTH.md).

Si aparece un comportamiento no cubierto, documentar primero la duda y su evidencia.
No completar este contrato inventando reglas para módulos aún no revisados.
