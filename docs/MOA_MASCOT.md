# Moa: mascota de HHR

Moa acompaña el resumen de camas del censo. La piedra gris, el contorno pixelado
y la ola turquesa conservan su identidad. Todas las escenas, incluidos los cuatro gestos originales, utilizan
dieciocho atlas propios, cada uno con seis fotogramas ilustrados
con expresiones y posturas distintas. Las tiras PNG con transparencia se presentan
al tamaño de 144 × 84 px con resolución doble para pantallas Retina.

Está **desactivado por defecto**. Su retrato en la barra lo muestra u oculta.
Solo la X acompaña a Moa; Escape también lo oculta y devuelve el foco al activador.
Una elección explícita se conserva en `hhr_moa_visible_v1` y se comunica entre pestañas.
Sin almacenamiento, comienza oculto y permite elegir durante la sesión.

Cada toque recorre estas dieciocho escenas, sin repetición inmediata:

- Coca-Cola en lata; malabares; atención con jeringa a una mascota ficticia.
- Despedida y descanso en una almohada; bostezo; flexiones en el suelo.
- Vuelta de carnero; salto; carrera; guiño.
- Enamorado con corazones; enojo con nube de pensamientos caóticos.
- Recuerdo cariñoso de su mamita; surf con tabla y olas.

Después siguen saludo, curiosidad, paseo y alegría. La bienvenida utiliza el mismo
saludo y el reposo conserva su primer fotograma: no alternar dibujos de otra generación.
Cada escena dura entre 3 y 6 segundos y termina en reposo estático. La pestaña oculta pausa el movimiento;
la preferencia de movimiento reducido presenta escenas quietas y también vuelve
al reposo al finalizar, mediante un reloj CSS sin movimiento visible. Cerrar Moa detiene
sus animaciones. No hay sonido, destellos, gestos automáticos repetitivos ni panel de texto.

El área táctil sigue midiendo 144 × 84 px, dentro del flujo del censo. En teléfonos
se coloca debajo del resumen. La impresión excluye tanto Moa como su activador.
La mascota paciente es ilustrada, independiente de los pacientes del hospital.
Moa no recibe información clínica, consulta servicios ni modifica registros.

El código, los estilos de las escenas y el atlas son opcionales y quedan fuera del
precache de instalación. El retrato estático permanece disponible. La primera
activación requiere descargar el módulo; si no puede cargarse, el censo permanece
usable y se puede ocultar Moa o confirmar una recarga. No se añaden estrategias de
caché ni se cambian presupuestos. La barra y el preboot comparten el degradado azul,
sin solicitar el antiguo paisaje de Rapa Nui.

Las flexiones y la carrera repiten un ciclo corto durante un tiempo limitado;
las historias se reproducen una vez. La animación comienza después de cargar
su imagen. Se descarga el saludo compartido para el reposo y el atlas de la escena seleccionada. Un fallo de
imagen vuelve al reposo sin bloquear el censo ni abrir un mensaje de error.
Con movimiento reducido se elige un fotograma representativo de cada escena.

Los originales generados tienen seis celdas de 512 × 512 px, organizadas 3 × 2.
`scripts/build-moa-atlases.mjs <directorio-origen>` prepara los dieciocho PNG de
1728 × 168 px, con un recorte común por escena y seis escenarios de 288 × 168 px.
No altera personajes, expresiones ni transparencia. Mantener la misma escala y
origen dentro de cada secuencia; revisar cuerpo, emoción, continuidad y legibilidad
al tamaño real antes de reemplazar un atlas. El sufijo v2 evita reutilizar arte antiguo.

## Identidad y movimiento

Conservar la cabeza de piedra gris, orejas redondeadas, ojos negros con borde blanco,
cejas oscuras, extremidades cortas y ola turquesa. Misma dirección de luz, grosor de
contorno pixelado y proporción entre cabeza y cuerpo. Cambia la expresión; no cambia
el personaje. Los accesorios no deben sustituir su silueta ni esconder su identidad.

Toda acción usa poses ilustradas con anticipación, movimiento y descanso. Dibujar
brazos, piernas, mirada y emoción propios de la acción; no mover una figura rígida
para simular caminar. El renderer, encuadre, pausa y movimiento reducido son comunes.
Revisar las seis poses en orden, ampliadas y a 144 × 84 px. Comprobar continuidad de
escala, pies alternos en marcha/carrera, manos y transiciones al retrato de reposo.
