# Cierre mensual CUDYR

La recuperación documental y la aprobación del mes son operaciones distintas.
Una persona autorizada confirma explícitamente la población reconstruida y su motivo.
La aprobación requiere todos los días cerrados, fuentes comprobadas y elegibilidad resuelta.
Se conservan responsable, fecha, revisión y huellas del contenido de cada día.

Firebase guarda una proyección mensual comprimida y verifica su integridad. La publicación
rechaza fuentes o contenidos que hayan cambiado desde la aprobación, y las peticiones
concurrentes reutilizan el mismo resultado. Sólo roles de revisión pueden publicar.

El cierre conserva el estado clínico aprobado. Una actualización rutinaria del censo
no lo invalida. Nuevos informes históricos, revisiones documentales o excepciones
diarias y correcciones explícitas de egresos sí invalidan la proyección.
Las correcciones de egreso se vigilan mediante un marcador actualizado en la misma transacción del egreso;
pueden invalidar también otros meses cerrados, de forma conservadora. Una lectura fallida no declara el mes completo.
Las diferencias con el censo local original permanecen como respaldo, sin reescribirlo.

La interfaz ofrece el cierre dentro del detalle del archivo mensual. Este PR prepara
la persistencia oficial; la lectura directa y el caché de navegación se completan en el
siguiente bloque. Las pruebas usan datos sintéticos y Firebase Emulator.
