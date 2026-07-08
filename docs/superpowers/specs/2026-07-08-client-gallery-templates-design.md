# PhonoManager — Galería del cliente: plantillas de diseño premium

**Fecha:** 2026-07-08
**Estado:** Aprobado por el usuario (dirección visual validada con mockups en el visual companion)
**Alcance:** Rediseño completo de la experiencia del cliente en `/g/[slug]` — puerta de acceso, galería y lightbox — con plantillas seleccionables por galería. Solo presentación: el dominio (likes, comentarios, descargas, zip, marcas de agua, sesiones) no cambia.

## Resumen

El fotógrafo elige UNA plantilla por galería entre 4, pensadas para sus tipos de sesión
(bodas, graduaciones, smash cake, newborn, familiares, personales). Cada plantilla define
paleta, tipografías, portada y tratamiento de fotos; las tres pantallas del cliente comparten
estructura y componentes. Objetivo: que el cliente se sorprenda al abrir su galería.

## Plantillas (catálogo v1)

| Clave | Nombre | Sesiones típicas | Rasgos |
|---|---|---|---|
| `editorial` | Editorial (DEFAULT) | bodas, XV, personal | Serif fina espaciada, blanco, portada full-bleed 100vh con flecha de scroll |
| `cinematico` | Cinemático oscuro | graduaciones, boda de noche | Fondo carbón, acento dorado, serif itálica, título abajo-izquierda con degradado |
| `luminoso` | Luminoso tierno | smash cake, newborn, infantil | Fondos cálidos suaves, esquinas redondeadas, tipografía amable, degradado cálido inferior |
| `clasico` | Clásico elegante | familiares formales, retratos | Marfil, portada partida texto/foto con filete dorado, fotos con marco blanco y sombra |

- Tipografías vía `next/font/google` (self-hosted en build): Cormorant Garamond + Inter
  (editorial), Playfair Display + Inter (cinematico), Nunito (luminoso), EB Garamond + Lato (clasico).
- Definición central en `src/app/g/[slug]/templates.ts`: tokens por plantilla (colores de fondo/
  texto/acento, familia display y body, radio de foto, marco/sombra, variante de portada).
  Los componentes consumen tokens; SOLO la portada tiene 4 variantes estructurales.

## Modelo de datos y admin

- Se reutiliza `galleries.cover_template` (hoy `"classic"` sin uso en UI): pasa a ser la
  plantilla, valores `editorial|cinematico|luminoso|clasico`, default `editorial`.
- Migración 0007: default nuevo + data `classic → editorial`.
- La plantilla es dueña de su paleta ⇒ el select "Tema claro/oscuro" del detalle de galería se
  REEMPLAZA por el select "Plantilla" (4 opciones con nombre). La columna `theme` queda en DB sin
  uso (drop en migración futura); `updateGallerySchema` deja de aceptar `theme` y acepta
  `coverTemplate` (enum de 4).
- Zod/action del detalle actualizados; sin otros cambios de dominio. Tenant-scoping intacto.

## Pantalla 1 — Puerta de acceso

- Fondo: la foto de portada de la galería a pantalla completa, desenfocada (blur) y oscurecida
  sutilmente; sin portada → color de fondo de la plantilla.
- Centro: tarjeta mínima con el título en la tipografía display de la plantilla, campos
  email/nombre/contraseña (los actuales, misma acción y rate limit) y botón. Entrada con fade.

## Pantalla 2 — Galería

- **Portada por plantilla** (variantes estructurales): editorial full-bleed 100vh, título serif
  centrado + flecha scroll; cinematico degradado a carbón con título abajo-izquierda; luminoso
  degradado cálido inferior; clasico split texto/foto con línea dorada. Punto focal
  (`coverFocalX/Y`) respetado en todas.
- **Grid de filas justificadas** (sin librería): cada foto conserva su proporción real usando
  `width/height` de DB (fotos sin dimensiones asumen 3:2) y el ORDEN de entrega se preserva
  (requisito: `photoOrder` del fotógrafo). Helper puro `justifyRows(photos, targetHeight,
  containerWidth)` con tests. Altura objetivo ~280px escritorio, ~180px móvil.
- **Tratamiento por plantilla**: esquinas rectas (editorial/cinematico), redondeadas (luminoso),
  marco blanco + sombra (clasico).
- **Animaciones** (framer-motion/`motion`, dependencia nueva aprobada): fade-up escalonado de
  fotos al entrar al viewport; respetar `prefers-reduced-motion` (sin animación).
- **Header pegajoso**: al pasar la portada aparece barra fina con título y menú de descarga ZIP
  (ámbito galería/favoritas + resolución; por sección queda el icono junto al encabezado de
  sección como hoy). Se eliminan los selects sueltos actuales.
- **Miniaturas**: corazón (like) y globo (hay comentario) como SVG de línea fina, visibles al
  hover / siempre en táctil. Sin emojis en toda la experiencia.

## Pantalla 3 — Lightbox inmersivo (mockup aprobado)

- La foto ocupa todo; fondo negro. Apertura con zoom desde la miniatura (motion), cierre con ✕,
  Escape o arrastre vertical en móvil.
- Navegación: flechas laterales, teclado (←/→), swipe. SIN contador ni textos.
- Acciones flotantes inferiores (píldoras con blur, iconos SVG de línea): ♥ like (se rellena al
  marcar), comentario (abre panel deslizante bajo demanda con el textarea de un comentario
  editable por foto, igual que hoy), descarga (popover hacia arriba con las resoluciones
  habilitadas; solo si la foto permite descarga).
- Auto-ocultado: controles se desvanecen tras ~2.5 s sin actividad; reaparecen al mover
  cursor/tocar.
- Los errores dejan de ser `alert()`: aviso inline discreto (banda breve sobre los controles
  del lightbox o bajo el header en la galería) acorde a la plantilla.

## Estructura de código

- `src/app/g/[slug]/templates.ts` — tokens + fuentes por plantilla (con test de completitud).
- `client-gallery.tsx` (240 líneas, todo mezclado) se divide: portada (4 variantes), header
  pegajoso + menú zip, grid justificado, lightbox, y el contenedor con el estado (likes/
  comentarios/descargas — la lógica de acciones actual se conserva tal cual).
- `access-form.tsx` rediseñado con los mismos props + `coverUrl` y tokens de plantilla.
- El page.tsx pasa además `template`, `coverUrl` ya existe, y `width/height` por foto.

## Verificación

- Dominio intacto ⇒ los 89 tests actuales siguen verdes sin tocar (salvo los de
  `updateGallerySchema` theme→coverTemplate).
- Nuevos tests: `justifyRows` (orden preservado, proporciones, última fila no estirada,
  fallback 3:2) y `templates.ts` (las 4 plantillas definen todos los tokens).
- Gates: `npm test && npx tsc --noEmit && npm run build && npx eslint src tests` cero warnings.
- Walkthrough manual del usuario: las 4 plantillas en escritorio y móvil (acceso, portada,
  grid, lightbox con like/comentario/descarga, zip desde header).

## Fuera de alcance

- Editor de plantillas personalizado / colores custom por galería (elegido: 4 fijas bien pulidas).
- Cambiar dominio de entrega, marcas de agua o sesiones.
- Drop de `galleries.theme` (migración futura).
- Reordenar fotos drag&drop y más plantillas de portada (fase 5 del spec maestro).
