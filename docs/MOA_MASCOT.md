# Moa: mascota de HHR

La mascota conserva la opción gráfica 2 elegida por el usuario: piedra gris,
contorno pixelado y una pequeña ola turquesa directamente sobre el torso.
El atlas `public/images/moa/moa-poses-v1.webp` contiene seis cuadros de
136 × 152 px: reposo, parpadeo, atención, saludo, pensando y sonrisa.
El cuadro de reposo procede de la imagen elegida; las otras poses se generaron
usando ese personaje como referencia. Los cuadros comparten el anclaje de los pies.

Moa ocupa el botón de ayuda existente. «Mostrar mascota Moa», dentro de la
ayuda, permite ocultarla y volver a mostrarla. La preferencia se guarda solo en
el navegador (`hhr_moa_visible_v1`); si el almacenamiento falla, el control sigue
funcionando durante la sesión.

La secuencia de presentación dura 4,8 segundos y el saludo al pasar el cursor
o enfocar con teclado dura 2,4 segundos. Cada secuencia termina en reposo,
sin repetición automática. `prefers-reduced-motion: reduce` muestra únicamente
el cuadro de reposo. Ocultar la mascota desmonta sus imágenes y animaciones.

La ilustración es decorativa y no recibe datos de pacientes. La ayuda local
sigue disponible cuando se oculta Moa o falla la descarga del atlas. Esta
versión no incorpora IA ni ejecuta tareas de la aplicación.

El atlas se excluye del precache de instalación de la PWA y se almacena al usarlo
mediante la ruta de imágenes existente. En un primer acceso sin red puede verse
el icono de ayuda. El código de ayuda y su alternativa permanecen en el precache.
Cambiar el contenido del atlas requiere una nueva versión en el nombre del archivo
para evitar reutilizar una ilustración antigua del caché de imágenes.

El paisaje de la barra usa igualmente una URL nueva (`rapa-nui-coast-v2.webp`),
tanto antes de cargar React como en la navegación, para que una instalación
anterior no conserve los moáis antiguos en su caché de imágenes.
