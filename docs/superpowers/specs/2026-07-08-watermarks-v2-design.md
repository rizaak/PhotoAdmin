# PhonoManager — Marcas de agua v2 (set del estudio: texto/imagen, opacidad, tamaño, posición)

**Fecha:** 2026-07-08
**Estado:** Aprobado por el usuario (diseño validado por secciones)
**Reemplaza:** el modelo de marca de F4 (un texto por galería, patrón fijo, opacidad fija 35%).

## Resumen

Las marcas de agua pasan a ser un **set global del estudio** de hasta **3 marcas simultáneas**,
configurado en una página de Configuración independiente de las galerías, con **preview en vivo**
sobre una imagen estándar. Cada marca es **texto o imagen (PNG)** con **opacidad**, **tamaño** y
**posición** propias. Las galerías/secciones/fotos siguen decidiendo **cuándo** aplica la marca
(modo vista/descarga/ambas con herencia de 3 niveles — sin cambios); el estudio define **qué** se
aplica.

## Modelo de datos

- Nueva tabla **`watermarks`** (máx. 3 filas por estudio, orden por `position` de slot `0..2`):
  - `id`, `studioId` (FK cascade), `slot` (int 0-2, unique por estudio),
  - `type`: `"text" | "image"`,
  - `text`: string nullable (1..100, requerido si type=text),
  - `imageKey`: string nullable (clave R2 del PNG, requerido si type=image),
  - `opacityPct`: int 5..100,
  - `sizePct`: int 5..50 (porcentaje del ANCHO de la foto que ocupa la marca),
  - `placement`: enum `tl | tc | tr | ml | center | mr | bl | bc | br | tile`
    (grid 3×3 + mosaico diagonal repetido),
  - `createdAt`.
- **Sin biblioteca de logos** (decisión YAGNI aprobada): con un solo set por estudio, cada slot de
  tipo imagen guarda su propio PNG. Al eliminar o reemplazar el slot se borra el objeto R2.
- PNG de logos en `studios/{studioId}/watermarks/{uuid}.png`; subida con el flujo de URLs
  prefirmadas existente; solo `image/png`, máx. 5 MB.
- Se **eliminan** `galleries.watermark_text` y `galleries.watermark_image_key` (migración 0004).

## Gate y herencia (delivery)

- `effectiveWatermarkMode` conserva su semántica (foto override → sección → galería) pero el gate
  cambia: en vez de `gallery.watermarkText != null`, recibe `hasWatermarks: boolean`
  (= el estudio tiene ≥1 marca configurada). Sin marcas → modo efectivo SIEMPRE `none`.
- Vista del cliente, descargas y ZIP no cambian de lógica: siguen decidiendo variante limpia vs
  `-wm` con las mismas funciones puras, fail-closed (foto sin variante requerida → excluida).

## Renderizado (pipeline sharp)

- Cada marca se materializa como **PNG overlay** al tamaño objetivo:
  - **Texto**: SVG rasterizado — una sola instancia con `font-size` derivado de `sizePct` y
    `fill-opacity = opacityPct/100`; para `tile`, el patrón diagonal actual parametrizado con
    la opacidad/tamaño del slot.
  - **Imagen**: PNG redimensionado a `sizePct` del ancho de la foto; la opacidad se aplica
    multiplicando el canal alfa (helper `applyOpacity(png, pct)` con sharp: extraer alfa,
    `linear(pct/100, 0)`, re-unir canales).
- Composición sobre cada variante (thumb/web/high):
  - Posiciones del grid → `composite` con `gravity` mapeado (northwest, north, …) y un margen
    del 2% (padding transparente en el overlay, porque gravity pega al borde).
  - `tile` → `composite` con `tile: true`.
  - Las ≤3 marcas se aplican en orden de slot en UNA pasada de composite (array de inputs).
- `makeDerivatives(original, opts)` cambia a `opts: { watermarks: WatermarkSpec[] }` con
  `WatermarkSpec = { type, text?, imageBuffer?, opacityPct, sizePct, placement }`. Variantes
  `-wm` se generan sii `watermarks.length > 0`.
- `processPhoto` carga las marcas del estudio y descarga los PNG de logos UNA vez por invocación
  (no por variante). Claves fijas `{dir}/…-wm.jpg` sin cambios; limpieza de `-wm` obsoletas igual
  que hoy.

## Invalidación y regeneración

- **Cualquier** cambio en el set (crear/editar/eliminar una marca) anula `thumbWmKey/webWmKey/
  highWmKey` de TODAS las fotos de TODAS las galerías del estudio, en una transacción con el
  cambio. Efecto: banner "Actualizar fotos" en cada galería + exclusión fail-closed en la vista
  del cliente hasta regenerar (mismo mecanismo de F4).
- La heurística del banner cambia su gate a `hasWatermarks` (antes `gallery.watermarkText`).
- El endpoint `reprocess` y el banner con progreso/reintento de F4 se reutilizan sin cambios.

## Página de Configuración (`/admin/settings`)

- Nueva ruta protegida con enlace "Configuración" en el header del admin.
- Sección **Marcas de agua**: hasta 3 slots. Por slot: tipo (texto/imagen), campo de texto o zona
  de subida PNG, slider opacidad 5–100%, slider tamaño 5–50%, selector de posición (grid 3×3
  clicable + botón "Mosaico"), botón eliminar. "+ Agregar marca" visible solo con espacio (<3).
- **Preview en vivo**: `POST /api/watermarks/preview` recibe el set (Zod; los logos por
  `imageKey` ya subido o el slot en edición por clave temporal) y aplica el **pipeline real** de
  sharp sobre una imagen de muestra empaquetada (`public/watermark-sample.jpg`, ~1600px), devuelve
  JPEG. El cliente lo pide con debounce ~500 ms. Fidelidad exacta con el resultado final.
  Auth: requireStudio; el preview renderiza solo assets del propio estudio.
- Al guardar cambios: aviso "Las fotos existentes necesitarán actualizarse — verás el banner en
  cada galería".

## Limpieza en el detalle de galería

- Se elimina el input "Texto de la marca de agua". Junto al select de modo queda una nota-enlace:
  "Las marcas se configuran en Configuración →". Modo por galería, overrides por sección y por
  foto: intactos.

## Migración (0004)

1. Crear tabla `watermarks`.
2. Data: por estudio, si alguna galería tiene `watermark_text` no nulo, insertar UNA marca
   `type=text, placement=tile, opacityPct=35, sizePct=15` con el texto de la galería actualizada
   más recientemente (si había textos distintos entre galerías, sobrevive el más reciente —
   impacto nulo hoy: un solo estudio).
3. Drop `galleries.watermark_text` y `galleries.watermark_image_key`.
4. Las fotos con variantes `-wm` existentes conservan sus claves (el texto migrado produce el
   mismo render conceptual); el fotógrafo puede regenerar cuando quiera desde el banner si edita
   el set.

## Pruebas

- **Dominio (TDD, PGlite)**: CRUD de watermarks (máx. 3 → `Error("MAX_WATERMARKS")`, slots únicos,
  Zod de rangos, type/text/imageKey coherentes, aislamiento intruder); invalidación global de
  claves `-wm` al mutar el set; gate `hasWatermarks` en delivery (reemplaza los tests de
  watermarkText).
- **Renderizado (sharp real)**: sobre lienzo negro — cada `placement` del grid produce brillo en
  el cuadrante correcto y NO en el opuesto; `tile` cubre 4 cuadrantes (test F4 existente
  parametrizado); mayor `opacityPct` → mayor media de brillo; marca de imagen (PNG sintético)
  compone con alfa y tamaño correcto.
- **UI/preview**: gates de build; walkthrough manual (configurar 3 marcas mixtas, preview,
  guardar, banner en galerías, regenerar, verificar en vista cliente y descargas).

## Fuera de alcance

- Presets con nombre por estudio (elegido: un set global).
- Coordenadas libres / drag de posición (elegido: grid 3×3 + mosaico).
- Biblioteca de logos reutilizables (innecesaria con set global).
- Rotación, color de texto, fuentes personalizadas.

## Addendum (2026-07-08): selección por galería

Corrección de producto: las ≤3 marcas NO se componen — son alternativas. `galleries.watermark_id`
(FK nullable → watermarks, SET NULL) selecciona la marca de la galería; el gate de delivery pasa a
`!!gallery.watermarkId`. Invalidación acotada: mutar una marca limpia claves `-wm` solo de las
galerías que la seleccionaron; cambiar la selección limpia solo esa galería; crear una marca nueva
no limpia nada. El preview de Configuración muestra una marca a la vez (picker de slot).
Migración 0006: cada galería queda con la marca de slot más bajo de su estudio (comportamiento
previo más cercano).
