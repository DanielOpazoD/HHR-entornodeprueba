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
Cada corrección de egreso actualiza un marcador del episodio en la misma transacción.
Sólo se invalidan los informes oficiales que contienen ese episodio, incluidos los
meses consecutivos de una misma hospitalización. Se consultan los marcadores cambiados
en lotes de hasta 30 episodios, sin leer historias clínicas ni reconstruir el censo.
Una marca separada impide publicar una reconstrucción si hubo una corrección durante
su lectura. No invalida los meses oficiales ajenos al caso. El marcador hospitalario
anterior se conserva para detectar cambios de escritores antiguos, sin migrar ni
reaprobar los informes guardados. Una lectura fallida no declara el mes completo.
Las diferencias con el censo local original permanecen como respaldo, sin reescribirlo.

La interfaz ofrece el cierre dentro del detalle del archivo mensual. Los meses
oficiales se leen directamente desde Firebase y usan caché local por sesión.
Las pruebas automatizadas usan datos sintéticos y Firebase Emulator; no certifican
un despliegue ni sustituyen la aceptación de un mes real en la versión desplegada.
