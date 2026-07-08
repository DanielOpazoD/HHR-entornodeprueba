# PDF mensual de recetas

El visor de recetas permite imprimir en PDF todas las recetas disponibles del mes seleccionado, desde el primer dia del mes hasta el ultimo dia con respaldo cargado.

## Niveles de calidad de imagen

- Media: usa la imagen original. Es el valor predeterminado.
- Reducida: baja el peso manteniendo buena legibilidad.
- Compacta: aplica mas compresion y suele ser la recomendada para meses completos.
- Baja: busca maximo ahorro de tamano; revisar legibilidad antes de archivar o compartir.

Los niveles reducida, compacta y baja pasan por `/.netlify/functions/prescription-image-proxy`, que descarga la imagen autorizada de Firebase Storage y genera un JPEG optimizado. Si la optimizacion falla, el proxy devuelve la imagen original para no romper la impresion.

Cuando ocurre ese fallback, el visor muestra una advertencia no bloqueante, por ejemplo: `1 imagen se imprimira en calidad original por error de optimizacion.` El PDF se sigue generando.

El navegador prepara las imagenes optimizadas con un limite de concurrencia y timeout por imagen. Si el proxy demora demasiado, esa receta cae a imagen original y suma a la misma advertencia no bloqueante.

La ultima configuracion usada se guarda localmente en el navegador: recetas por pagina, color/B/N y calidad. Esto solo afecta la proxima impresion en ese equipo.

## Smoke local del proxy

Con la app levantada en `http://localhost:3021`, ejecutar:

```bash
npm run smoke:prescription-image-proxy
```

El smoke levanta una imagen fixture local temporal, la consulta a traves de `/.netlify/functions/prescription-image-proxy` y exige una respuesta `image/jpeg` con header `X-Prescription-Image-Optimization: optimized`.
