# Diccionario de variables MEDIF

Versión del esquema: `1.0.0`. El inventario conserva los nombres exactos de los 137 campos AcroForm del PDF: 69 campos de texto y 68 casilleros de texto para `X`. Las coordenadas, página, tipo original y propiedades de cada campo permanecen en [medifSchema.json](../src/features/clinical-library/domain/medifSchema.json).

## Convenciones

- `id` y `name` identifican el mismo campo del PDF. La exportación utiliza ese nombre exacto.
- Todos los valores del PDF se representan como cadenas. Un casillero de marca contiene `"X"` si está seleccionado y `""` si está vacío.
- Las opciones de cada grupo `choice` son excluyentes (`multiple: false`). Se permite dejar el grupo sin respuesta. Al elegir una opción, deben limpiarse las demás opciones del mismo grupo.
- `inputType` orienta el control HTML. Las fechas y edades se mantienen como texto para respetar la flexibilidad del formulario. No se agregan requisitos clínicos ni campos obligatorios.
- `suggestedSource` indica el origen previsto: `manual`, `hhr` o `medical-review`. Los siete campos compatibles con HHR se proponen como borrador mediante el adaptador y requieren confirmación. El formulario también funciona íntegramente en modo manual.
- Las decisiones médicas no se deducen del censo. El check verde aplica solo las respuestas habituales solicitadas por el usuario a preguntas todavía sin respuesta; oxígeno y las demás respuestas no incluidas permanecen manuales.
- Las firmas del PDF son campos de texto. Escribir un nombre no genera una firma electrónica.

## Índice técnico del PDF

Estas diez secciones conservan la ubicación documental de las 137 variables. La interfaz reúne sus 57 grupos en una vista continua con siete bloques: Paciente y vuelo; Diagnóstico y evaluación; Riesgo y autonomía; Asistencia y acompañante; Tratamiento y traslado; Psiquiatría; Médico y declaraciones. El PDF sigue teniendo tres páginas.

1. Paciente · partes 1 y 2 · páginas 1 y 2 · 6 variables
2. Itinerario y contacto · parte 1 · página 1 · 10 variables
3. Asistencia y acompañante · parte 1 · página 1 · 22 variables
4. Declaración del pasajero · parte 1 · página 1 · 5 variables
5. Médico y diagnóstico · parte 2 · página 2 · 16 variables
6. Riesgo y autonomía · parte 2 · página 2 · 25 variables
7. Oxígeno y equipo portátil · parte 2 · página 2 · 9 variables
8. Medicación y hospitalización · parte 2 · página 2 · 22 variables
9. Cirugía y movilidad · parte 2 · página 3 · 11 variables
10. Psiquiatría y declaración · parte 2 · página 3 · 11 variables

## Variables

### Paciente

Identificación del pasajero en ambas partes del formulario y seguro de viaje.

| Variable exacta      | Página | Etiqueta                           | Tipo HTML / PDF | Origen posible                  |
| -------------------- | -----: | ---------------------------------- | --------------- | ------------------------------- |
| `p1_nombre_pasajero` |      1 | Nombre completo                    | `text` / texto  | Candidato HHR; confirmar        |
| `p1_edad`            |      1 | Edad                               | `text` / texto  | Candidato HHR; confirmar        |
| `p1_seguro_viaje`    |      1 | Seguro de viaje / número de póliza | `text` / texto  | Manual                          |
| `p2_nombre_paciente` |      2 | Nombre completo                    | `text` / texto  | Candidato HHR; confirmar        |
| `p2_genero`          |      2 | Género                             | `text` / texto  | HHR: sexo registrado (editable) |
| `p2_edad`            |      2 | Edad                               | `text` / texto  | Candidato HHR; confirmar        |

### Itinerario y contacto

Tramos del viaje y contacto con la oficina o agencia.

| Variable exacta         | Página | Etiqueta                | Tipo HTML / PDF | Origen posible |
| ----------------------- | -----: | ----------------------- | --------------- | -------------- |
| `p1_itinerario_1_desde` |      1 | Desde                   | `text` / texto  | Manual         |
| `p1_itinerario_1_hacia` |      1 | Hacia                   | `text` / texto  | Manual         |
| `p1_itinerario_1_fecha` |      1 | Fecha                   | `text` / texto  | Manual         |
| `p1_itinerario_1_pnr`   |      1 | PNR / código de reserva | `text` / texto  | Manual         |
| `p1_itinerario_2_desde` |      1 | Desde                   | `text` / texto  | Manual         |
| `p1_itinerario_2_hacia` |      1 | Hacia                   | `text` / texto  | Manual         |
| `p1_itinerario_2_fecha` |      1 | Fecha                   | `text` / texto  | Manual         |
| `p1_itinerario_2_pnr`   |      1 | PNR / código de reserva | `text` / texto  | Manual         |
| `p1_oficina_agencia`    |      1 | Oficina o agencia       | `text` / texto  | Manual         |
| `p1_telefono_agencia`   |      1 | Teléfono de la agencia  | `tel` / texto   | Manual         |

### Asistencia y acompañante

Movilidad, acompañante, traslado y necesidades del pasajero durante el vuelo.

| Variable exacta                 | Página | Etiqueta                                                                         | Tipo HTML / PDF              | Origen posible |
| ------------------------------- | -----: | -------------------------------------------------------------------------------- | ---------------------------- | -------------- |
| `p1_silla_si`                   |      1 | Necesita silla de ruedas · Sí                                                    | Opción exclusiva / texto `X` | Manual         |
| `p1_silla_no`                   |      1 | Necesita silla de ruedas · No                                                    | Opción exclusiva / texto `X` | Manual         |
| `p1_camina_si`                  |      1 | Puede desplazarse por sí solo distancias cortas · Sí                             | Opción exclusiva / texto `X` | Manual         |
| `p1_camina_no`                  |      1 | Puede desplazarse por sí solo distancias cortas · No                             | Opción exclusiva / texto `X` | Manual         |
| `p1_acompanante_1`              |      1 | Datos del acompañante · línea 1                                                  | `text` / texto               | Manual         |
| `p1_acompanante_2`              |      1 | Datos del acompañante · línea 2                                                  | `text` / texto               | Manual         |
| `p1_acompanante_3`              |      1 | Datos del acompañante · línea 3                                                  | `text` / texto               | Manual         |
| `p1_acompanante_4`              |      1 | Datos del acompañante · línea 4                                                  | `text` / texto               | Manual         |
| `p1_contacto_sin_acompanante_1` |      1 | Nombre y teléfono · línea 1                                                      | `text` / texto               | Manual         |
| `p1_contacto_sin_acompanante_2` |      1 | Nombre y teléfono · línea 2                                                      | `text` / texto               | Manual         |
| `p1_perro_asistencia`           |      1 | Indique si viaja con perro de asistencia                                         | `textarea` / texto           | Manual         |
| `p1_coord_ambulancia_si`        |      1 | Requiere coordinación para ingresar la ambulancia al aeropuerto · Sí             | Opción exclusiva / texto `X` | Manual         |
| `p1_coord_ambulancia_no`        |      1 | Requiere coordinación para ingresar la ambulancia al aeropuerto · No             | Opción exclusiva / texto `X` | Manual         |
| `p1_compania_ambulancia`        |      1 | Compañía de ambulancia                                                           | `text` / texto               | Manual         |
| `p1_telefono_ambulancia`        |      1 | Teléfono de la ambulancia                                                        | `tel` / texto                | Manual         |
| `p1_direccion_destino`          |      1 | Dirección de destino                                                             | `text` / texto               | Manual         |
| `p1_hipoxia_si`                 |      1 | La reducción de oxígeno durante el vuelo afectará su condición · Sí              | Opción exclusiva / texto `X` | Manual         |
| `p1_hipoxia_no`                 |      1 | La reducción de oxígeno durante el vuelo afectará su condición · No              | Opción exclusiva / texto `X` | Manual         |
| `p1_hipoxia_inseguro`           |      1 | La reducción de oxígeno durante el vuelo afectará su condición · No estoy seguro | Opción exclusiva / texto `X` | Manual         |
| `p1_especiales_si`              |      1 | Tiene requerimientos especiales en vuelo · Sí                                    | Opción exclusiva / texto `X` | Manual         |
| `p1_especiales_no`              |      1 | Tiene requerimientos especiales en vuelo · No                                    | Opción exclusiva / texto `X` | Manual         |
| `p1_requerimientos_detalle`     |      1 | Especifique los requerimientos                                                   | `text` / texto               | Manual         |

### Declaración del pasajero

Datos que acompañan la declaración impresa del pasajero. Revise el texto completo en el PDF.

| Variable exacta           | Página | Etiqueta                   | Tipo HTML / PDF | Origen posible              |
| ------------------------- | -----: | -------------------------- | --------------- | --------------------------- |
| `p1_medico_autorizado`    |      1 | Médico autorizado          | `text` / texto  | Copia de `p2_nombre_medico` |
| `p1_declaracion_lugar`    |      1 | Lugar                      | `text` / texto  | Manual                      |
| `p1_declaracion_fecha`    |      1 | Fecha                      | `text` / texto  | Manual                      |
| `p1_declaracion_firma`    |      1 | Firma del pasajero (texto) | `text` / texto  | Manual                      |
| `p1_declaracion_telefono` |      1 | Teléfono del contacto      | `tel` / texto   | Manual                      |

### Médico y diagnóstico

Informe, diagnóstico actual, antecedentes y evolución. Su contenido requiere revisión del médico tratante.

| Variable exacta            | Página | Etiqueta                                           | Tipo HTML / PDF              | Origen posible           |
| -------------------------- | -----: | -------------------------------------------------- | ---------------------------- | ------------------------ |
| `p2_nombre_medico`         |      2 | Nombre del médico tratante                         | `text` / texto               | Manual                   |
| `p2_identificacion_medico` |      2 | RUT / ID / DNI                                     | `text` / texto               | Manual                   |
| `p2_telefono_medico`       |      2 | Teléfono del médico                                | `tel` / texto                | Manual                   |
| `p2_especialidad_medico`   |      2 | Especialidad                                       | `text` / texto               | Manual                   |
| `p2_email_medico`          |      2 | Correo electrónico                                 | `email` / texto              | Manual                   |
| `p2_informe_medico`        |      2 | Informe médico y diagnóstico detallado             | `textarea` / texto           | Revisión médica manual   |
| `p2_diagnostico_actual`    |      2 | Diagnóstico médico o quirúrgico actual             | `textarea` / texto           | Candidato HHR; confirmar |
| `p2_antecedente_1`         |      2 | Antecedente 1                                      | `text` / texto               | Revisión médica manual   |
| `p2_antecedente_2`         |      2 | Antecedente 2                                      | `text` / texto               | Revisión médica manual   |
| `p2_antecedente_3`         |      2 | Antecedente 3                                      | `text` / texto               | Revisión médica manual   |
| `p2_antecedente_4`         |      2 | Antecedente 4                                      | `text` / texto               | Revisión médica manual   |
| `p2_antecedente_5`         |      2 | Antecedente 5                                      | `text` / texto               | Revisión médica manual   |
| `p2_primeros_sintomas`     |      2 | Fecha de los primeros síntomas                     | `text` / texto               | Revisión médica manual   |
| `p2_fecha_diagnostico`     |      2 | Fecha de diagnóstico o tiempo de evolución         | `text` / texto               | Revisión médica manual   |
| `p2_condiciones_volar_si`  |      2 | Está en condiciones de transportarse en avión · Sí | Opción exclusiva / texto `X` | Revisión médica manual   |
| `p2_condiciones_volar_no`  |      2 | Está en condiciones de transportarse en avión · No | Opción exclusiva / texto `X` | Revisión médica manual   |

### Riesgo y autonomía

Evaluación médica para el viaje. Las opciones no se calculan a partir de los datos importados.

| Variable exacta             | Página | Etiqueta                                                                 | Tipo HTML / PDF              | Origen posible                   |
| --------------------------- | -----: | ------------------------------------------------------------------------ | ---------------------------- | -------------------------------- |
| `p2_prognosis`              |      2 | Prognosis para el viaje                                                  | `text` / texto               | Revisión médica manual           |
| `p2_riesgo_bajo`            |      2 | Riesgo vital durante el viaje · Bajo o sin riesgo                        | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_riesgo_medio`           |      2 | Riesgo vital durante el viaje · Medio                                    | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_riesgo_alto`            |      2 | Riesgo vital durante el viaje · Alto                                     | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_riesgo_no_volar`        |      2 | Riesgo vital durante el viaje · Se recomienda no volar                   | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_contagiosa_si`          |      2 | Tiene una enfermedad contagiosa o transmisible al momento del viaje · Sí | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_contagiosa_no`          |      2 | Tiene una enfermedad contagiosa o transmisible al momento del viaje · No | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_contagiosa_fecha_tipo`  |      2 | Enfermedad y fecha de inicio                                             | `text` / texto               | HHR: fecha de ingreso (editable) |
| `p2_esfinter_si`            |      2 | Presenta alteración del control de esfínter · Sí                         | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_esfinter_no`            |      2 | Presenta alteración del control de esfínter · No                         | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_conducta_si`            |      2 | Presenta alteración de conducta · Sí                                     | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_conducta_no`            |      2 | Presenta alteración de conducta · No                                     | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_otra_alteracion`        |      2 | Otra alteración                                                          | `text` / texto               | Revisión médica manual           |
| `p2_comer_si`               |      2 | Es independiente para comer durante el vuelo · Sí                        | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_comer_no`               |      2 | Es independiente para comer durante el vuelo · No                        | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_bano_si`                |      2 | Es independiente para ir al baño durante el vuelo · Sí                   | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_bano_no`                |      2 | Es independiente para ir al baño durante el vuelo · No                   | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_instrucciones_si`       |      2 | Puede entender las instrucciones de seguridad · Sí                       | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_instrucciones_no`       |      2 | Puede entender las instrucciones de seguridad · No                       | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_autonomia_otros`        |      2 | Otras necesidades                                                        | `text` / texto               | Revisión médica manual           |
| `p2_acompanante_familiar`   |      2 | Tipo de acompañante · Familiar                                           | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_acompanante_medico`     |      2 | Tipo de acompañante · Médico                                             | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_acompanante_enfermera`  |      2 | Tipo de acompañante · Enfermera                                          | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_acompanante_paramedico` |      2 | Tipo de acompañante · Paramédico                                         | Opción exclusiva / texto `X` | Revisión médica manual           |
| `p2_acompanante_otro`       |      2 | Otro tipo de acompañante                                                 | `text` / texto               | Revisión médica manual           |

### Oxígeno y equipo portátil

Requerimiento de oxígeno, concentrador, autonomía de batería y desconexión breve.

| Variable exacta               | Página | Etiqueta                                                | Tipo HTML / PDF              | Origen posible         |
| ----------------------------- | -----: | ------------------------------------------------------- | ---------------------------- | ---------------------- |
| `p2_oxigeno_si`               |      2 | Requiere oxígeno y concentrador portátil propio · Sí    | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_oxigeno_no`               |      2 | Requiere oxígeno y concentrador portátil propio · No    | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_oxigeno_modelo`           |      2 | Modelo del concentrador                                 | `text` / texto               | Revisión médica manual |
| `p2_oxigeno_marca`            |      2 | Marca del concentrador                                  | `text` / texto               | Revisión médica manual |
| `p2_oxigeno_flujo`            |      2 | Flujo de oxígeno (L/min)                                | `text` / texto               | Revisión médica manual |
| `p2_oxigeno_bateria_duracion` |      2 | Duración de la batería                                  | `text` / texto               | Revisión médica manual |
| `p2_oxigeno_horas_requeridas` |      2 | Horas del 150 % del viaje                               | `text` / texto               | Revisión médica manual |
| `p2_oxigeno_desconexion_si`   |      2 | Se puede desconectar del oxígeno por lapsos breves · Sí | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_oxigeno_desconexion_no`   |      2 | Se puede desconectar del oxígeno por lapsos breves · No | Opción exclusiva / texto `X` | Revisión médica manual |

### Medicación y hospitalización

Medicamentos, vía de administración, hospitalización y coordinación en escalas o destino.

| Variable exacta                 | Página | Etiqueta                                                        | Tipo HTML / PDF              | Origen posible         |
| ------------------------------- | -----: | --------------------------------------------------------------- | ---------------------------- | ---------------------- |
| `p2_medicacion_1`               |      2 | Medicamento y vía 1                                             | `text` / texto               | Revisión médica manual |
| `p2_medicacion_2`               |      2 | Medicamento y vía 2                                             | `text` / texto               | Revisión médica manual |
| `p2_medicacion_3`               |      2 | Medicamento y vía 3                                             | `text` / texto               | Revisión médica manual |
| `p2_medicacion_4`               |      2 | Medicamento y vía 4                                             | `text` / texto               | Revisión médica manual |
| `p2_medicacion_5`               |      2 | Medicamento y vía 5                                             | `text` / texto               | Revisión médica manual |
| `p2_medicacion_6`               |      2 | Medicamento y vía 6                                             | `text` / texto               | Revisión médica manual |
| `p2_medicacion_previa_si`       |      2 | Requiere medicación previa al vuelo · Sí                        | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_medicacion_previa_no`       |      2 | Requiere medicación previa al vuelo · No                        | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_medicacion_durante_si`      |      2 | Requiere medicación durante el vuelo · Sí                       | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_medicacion_durante_no`      |      2 | Requiere medicación durante el vuelo · No                       | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_hospitalizacion_si`         |      2 | Requiere hospitalización · Sí                                   | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_hospitalizacion_no`         |      2 | Requiere hospitalización · No                                   | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_hospitalizacion_escalas_si` |      2 | Requiere hospitalización durante las escalas · Sí               | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_hospitalizacion_escalas_no` |      2 | Requiere hospitalización durante las escalas · No               | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_hospitalizacion_destino_si` |      2 | Requiere hospitalización o ambulancia al llegar al destino · Sí | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_hospitalizacion_destino_no` |      2 | Requiere hospitalización o ambulancia al llegar al destino · No | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_hospitalizacion_arreglos`   |      2 | Arreglos efectuados o acción no tomada                          | `text` / texto               | Revisión médica manual |
| `p2_anticoagulante_si`          |      2 | Utiliza anticoagulante al momento del viaje · Sí                | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_anticoagulante_no`          |      2 | Utiliza anticoagulante al momento del viaje · No                | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_anticoagulante_cual`        |      2 | Nombre del anticoagulante                                       | `text` / texto               | Revisión médica manual |
| `p2_estable_si`                 |      2 | Está estable para tolerar todo el vuelo y las escalas · Sí      | Opción exclusiva / texto `X` | Revisión médica manual |
| `p2_estable_no`                 |      2 | Está estable para tolerar todo el vuelo y las escalas · No      | Opción exclusiva / texto `X` | Revisión médica manual |

### Cirugía y movilidad

Tipo de cirugía, complicaciones y movilidad durante el viaje.

| Variable exacta            | Página | Etiqueta                                         | Tipo HTML / PDF              | Origen posible         |
| -------------------------- | -----: | ------------------------------------------------ | ---------------------------- | ---------------------- |
| `p3_cirugia_abierta`       |      3 | Tipo de cirugía · Abierta                        | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_cirugia_laparoscopica` |      3 | Tipo de cirugía · Laparoscópica                  | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_cirugia_otra`          |      3 | Tipo de cirugía · Otra                           | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_complicaciones_si`     |      3 | Hubo complicaciones durante la cirugía · Sí      | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_complicaciones_no`     |      3 | Hubo complicaciones durante la cirugía · No      | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_silla_ruedas_si`       |      3 | Necesita silla de ruedas · Sí                    | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_silla_ruedas_no`       |      3 | Necesita silla de ruedas · No                    | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_flectar_rodillas_si`   |      3 | Puede flectar las rodillas durante el viaje · Sí | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_flectar_rodillas_no`   |      3 | Puede flectar las rodillas durante el viaje · No | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_flectar_cadera_si`     |      3 | Puede flectar la cadera durante el viaje · Sí    | Opción exclusiva / texto `X` | Revisión médica manual |
| `p3_flectar_cadera_no`     |      3 | Puede flectar la cadera durante el viaje · No    | Opción exclusiva / texto `X` | Revisión médica manual |

### Psiquiatría y declaración

Antecedentes psiquiátricos, estabilidad y declaración del médico tratante. Revise la declaración completa en el PDF.

| Variable exacta                  | Página | Etiqueta                                    | Tipo HTML / PDF              | Origen posible              |
| -------------------------------- | -----: | ------------------------------------------- | ---------------------------- | --------------------------- |
| `p3_patologia_psiquiatrica_si`   |      3 | Posee alguna patología psiquiátrica · Sí    | Opción exclusiva / texto `X` | Revisión médica manual      |
| `p3_patologia_psiquiatrica_no`   |      3 | Posee alguna patología psiquiátrica · No    | Opción exclusiva / texto `X` | Revisión médica manual      |
| `p3_esquizofrenia`               |      3 | Patología psiquiátrica · Esquizofrenia      | Opción exclusiva / texto `X` | Revisión médica manual      |
| `p3_bipolaridad`                 |      3 | Patología psiquiátrica · Bipolaridad        | Opción exclusiva / texto `X` | Revisión médica manual      |
| `p3_otra_patologia_psiquiatrica` |      3 | Otra patología                              | `text` / texto               | Revisión médica manual      |
| `p3_patologia_estable_si`        |      3 | Se encuentra estable o bien controlada · Sí | Opción exclusiva / texto `X` | Revisión médica manual      |
| `p3_patologia_estable_no`        |      3 | Se encuentra estable o bien controlada · No | Opción exclusiva / texto `X` | Revisión médica manual      |
| `p3_medico_declaracion`          |      3 | Nombre del médico tratante                  | `text` / texto               | Copia de `p2_nombre_medico` |
| `p3_fecha_declaracion`           |      3 | Fecha                                       | `text` / texto               | Revisión médica manual      |
| `p3_lugar_declaracion`           |      3 | Lugar                                       | `text` / texto               | Revisión médica manual      |
| `p3_firma_medico_texto`          |      3 | Firma del médico (texto)                    | `text` / texto               | Revisión médica manual      |

## Decisiones y puntos de integración

1. Identificación repetida: el nombre y la edad aparecen en las partes del pasajero y del médico. Son campos PDF diferentes con un único control de nombre y un único control de edad en la interfaz. Al editarlos se sincronizan ambas apariciones; el nombre del médico también se comparte expresamente entre `p2_nombre_medico` (control único en Datos del médico), `p1_medico_autorizado` y `p3_medico_declaracion`. Las demás respuestas permanecen independientes.
2. Silla de ruedas: las partes del pasajero y del médico tienen preguntas independientes. No deben sincronizarse automáticamente porque corresponden a declaraciones diferentes.
3. Acompañante, cirugía y patología psiquiátrica: las preguntas originales están en singular. Este esquema usa una selección exclusiva por grupo, sin inferir exclusión clínica entre diagnósticos. Los campos «Otro» del formulario se mantienen como texto independiente.
4. Medicación y antecedentes: cada línea/casillero del PDF conserva su variable. No dividir ni truncar automáticamente contenido importado.
5. Hospitalización: son tres preguntas distintas (general, escalas y destino), cada una con su propio par Sí/No.
6. Origen HHR: el adaptador [medifPatientPrefill.ts](../src/features/clinical-library/domain/medifPatientPrefill.ts) propone siete campos a partir de nombre, edad, diagnóstico actual, sexo registrado y fecha de ingreso. Por mapeo solicitado, `biologicalSex` se copia al campo Género y `admissionDate` a Enfermedad y fecha de inicio; ambos valores siguen editables y conservan su procedencia.
7. Modo manual: la ausencia de paciente asociado no limita ninguno de los 137 campos. Una referencia a cama o paciente pertenece a los metadatos de la aplicación, no a un campo nuevo del PDF.
8. No se incorporan instrucciones de envío, plazos de aerolínea o datos externos como automatismos. El usuario debe revisar el formulario vigente y la declaración impresa.

## Cobertura comprobada

- 137 nombres únicos presentes en el manifiesto y en el esquema.
- 69 campos de texto y 68 casilleros para X.
- 10 secciones técnicas, 57 grupos y 31 grupos de opciones.
- Los 57 grupos aparecen exactamente una vez en los siete bloques del editor continuo.
- Los 137 campos PDF se conservan en el esquema; la interfaz deduplica `p2_nombre_paciente` y `p2_edad` mediante sus alias de página 1, y los dos nombres de médico de las declaraciones mediante `p2_nombre_medico`. El preset deja 91 casilleros PDF visibles y 87 controles de entrada.
- Ninguna coordenada, nombre de campo o PDF fue modificado por esta documentación.

## Modelo de edición y preferencias

El editor utiliza [medifDraft.ts](../src/features/clinical-library/domain/medifDraft.ts) para mantener los 137 valores en memoria. El nombre y la edad se sincronizan entre ambas partes; el nombre del médico se sincroniza en sus tres casilleros. Las otras preguntas repetidas permanecen independientes. La importación de borradores rechaza campos desconocidos, valores que no sean texto, marcas diferentes de `X` o vacío y respuestas contradictorias en una pregunta o en los alias de identidad.

Los borradores antiguos usan el valor de `p2_nombre_medico` como nombre del médico en las tres ubicaciones. Si ese campo está vacío, se recupera un único nombre no vacío de las declaraciones. Si estas contienen nombres distintos y falta el dato principal, se rechaza la importación para que se corrija el médico. Borrar el control único vacía las tres copias.

Las preferencias de [medifPreferences.ts](../src/features/clinical-library/domain/medifPreferences.ts) contienen exclusivamente la versión `2` y una lista `hiddenFieldIds`. El preset de [medifDefaultHiddenFields.ts](../src/features/clinical-library/domain/medifDefaultHiddenFields.ts) corresponde a las 44 marcas X de la lista revisada por el usuario. Su normalización agrega `p2_instrucciones_si` (nº 077) y `p2_estable_si` (nº 114), porque las alternativas No de esas preguntas estaban marcadas. El resultado es **46 campos ocultos y 91 visibles**. No se elimina ninguna variable del esquema.

Ocultar una alternativa oculta la pregunta completa; ocultar nombre o edad oculta ambas apariciones, y ocultar el nombre del médico oculta sus tres copias. Las preguntas de silla de ruedas del pasajero y del médico permanecen independientes y sus etiquetas explicitan el contexto. La configuración puede persistirse localmente y exportarse/importarse como JSON sin valores del paciente. Mostrar todos permite habilitar los 137 campos PDF.

La clave de almacenamiento `hhr.medif.preferences.v1` se conserva. Los datos antiguos v1 guardados se migran combinando sus ocultos con el preset; los guardados v2 preservan las decisiones posteriores de mostrar u ocultar. Una importación explícita v1 o v2 respeta la selección contenida en el archivo y la convierte a v2 tras normalizar los grupos. El [flujo completo](medif.md) describe esta diferencia entre migración e importación.

Ocultar un campo no borra su valor durante la sesión. La preparación de valores para PDF omite los campos ocultos y el generador los deja en blanco. El botón Guardar borrador conserva todos los valores, incluidos los ocultos, para recuperarlos posteriormente. Volver a mostrar el campo recupera su valor mientras continúe la sesión. La persistencia del navegador se limita a preferencias; los borradores con datos se descargan solamente por una acción explícita del usuario.

## Correspondencia confirmada con el censo HHR

La lectura usa el registro diario seleccionado y sus camas ocupadas. Para una cuna clínica se utiliza `record.beds[bedId].clinicalCrib` en lugar del paciente principal. No se escribe sobre el censo.

| Dato HHR      | Campos MEDIF                               | Tratamiento                                                                                                             |
| ------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `patientName` | `p1_nombre_pasajero`, `p2_nombre_paciente` | Copia editable; confirmar identidad.                                                                                    |
| `age`         | `p1_edad`, `p2_edad`                       | Conserva las unidades originales. Si está vacío, puede calcularse desde `birthDate` con una fecha `record.date` válida. |
| `pathology`   | `p2_diagnostico_actual`                    | Propuesta de borrador que requiere revisión médica; confirmar resolución o alta cuando corresponda.                     |

El seguro de salud del censo no se utiliza como seguro de viaje; la especialidad de hospitalización no se utiliza como especialidad del médico; la fecha de ingreso no se utiliza como fecha de diagnóstico. No se importan automáticamente las decisiones médicas ni las marcas de aptitud para volar.
