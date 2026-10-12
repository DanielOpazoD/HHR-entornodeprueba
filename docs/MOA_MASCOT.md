# Moa: mascota de HHR

Moa vive junto al resumen de camas y movimientos del censo diario. Conserva
la opción gráfica 2: piedra gris, contorno pixelado y ola turquesa sobre el torso.
El atlas `public/images/moa/moa-poses-v1.webp` conserva sus seis cuadros de
136 × 152 px: reposo, parpadeo, atención, saludo, pensando y sonrisa.

Su personalidad es tranquila, cercana y curiosa. Al aparecer saluda; en reposo
respira suavemente y parpadea. Al acercar el cursor o enfocar con teclado se
asoma. Cada clic o toque recorre saludo, curiosidad, paseo corto y alegría;
las secuencias de 2,8–4 segundos vuelven al reposo. Se mueve dentro de un área
de 144 × 84 px, junto al resumen, y su área de interacción permanece estable.
En teléfonos se coloca debajo de la tarjeta para conservar sus cifras legibles.

El botón (?) muestra u oculta Moa directamente. La X de su espacio y Escape
hacen lo mismo y devuelven el foco al botón de la barra. No hay panel de texto.
La preferencia `hhr_moa_visible_v1` se conserva al recargar y se sincroniza con
otras pestañas; si el almacenamiento falla, sigue funcionando en la sesión.
El control de pausa detiene los gestos y las expresiones. Con movimiento
reducido no hay desplazamientos ni animaciones, pero tocarla cambia su expresión.
Moa se excluye de la impresión.

La mascota no recibe datos de pacientes, consulta servicios ni modifica
registros. Esta entrega desarrolla gráficos e interacciones locales; no
incorpora IA. Su código se carga aparte cuando está visible y permanece en
el precache de la PWA. Si falla ese módulo, el censo sigue disponible y la
recarga requiere confirmación para evitar perder cambios. Si falla el atlas,
el control sigue accesible mediante el icono alternativo.

El atlas queda fuera del precache de instalación y utiliza el caché de imágenes
existente al descargarse. El paisaje panorámico de 430 × 52 px usa una URL nueva
(`rapa-nui-coast-v3.webp`), también en la carga anterior a React, para evitar
conservar una imagen anterior después de F5. Cambiar una ilustración requiere
una versión nueva en su nombre. No se elevan presupuestos de carga ni se añaden
dependencias o estrategias de caché.
