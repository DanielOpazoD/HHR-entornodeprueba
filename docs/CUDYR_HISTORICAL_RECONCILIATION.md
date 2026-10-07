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
