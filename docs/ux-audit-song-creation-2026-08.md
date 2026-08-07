# Auditoría UX del flujo de creación de canciones — Agosto 2026

**Detonante:** comentario de la clienta Karmenzita Mtz: *"Es difícil. Redactar. Los datos e información. No es claro para llenar los espacios. Yo traté y el sistema me saca. Y me saca."*

**Método:** lectura completa del código del funnel (`App.jsx` + los 6 pasos) y recorrido en vivo en el navegador a tamaño de teléfono (375px), actuando como una persona de 50-60 años con poca experiencia tecnológica — que es el comprador núcleo (adultos 30-40 comprando para padres/madres 50-70, y muchas veces la persona de 50-70 comprando directamente).

**Dato de contexto que valida a Karmenzita:** el 15-20% de los pedidos ya llegan con la casilla de historia VACÍA y terminan en quejas de "esta no es mi canción". Ella no es un caso raro; es la voz de una parte grande de los compradores.

---

## Hallazgo #0 — "El sistema me saca" es literal: hay 4 formas de ser expulsado sin querer

### A. El botón "atrás" del teléfono está roto (confirmado en vivo)
La app usa un router hecho a mano (`App.jsx`) que hace `pushState` al avanzar **pero no escucha `popstate`**. Resultado verificado en el navegador:

1. Estando en el paso 5 (email), presioné atrás → la URL cambió a `/create/details` pero **la pantalla no cambió**: se quedó congelada en "Confirma tu Creación".
2. Presioné atrás otra vez → URL en `/create/names`, pantalla igual de congelada.
3. Un par de "atrás" más y el usuario sale del sitio por completo.

Para una persona mayor, el botón atrás del teléfono ES el botón de navegación. Lo presiona, no pasa nada, lo vuelve a presionar… y de repente está fuera del sitio. **"Me saca. Y me saca."** — descripción exacta.

Agravante: en la página de comparación/checkout, `ExitIntentPopup.jsx` además **secuestra el botón atrás** (hace `pushState` y re-push en cada `popstate`) para mostrar un popup de descuento con cuenta regresiva. Para un usuario con poca experiencia eso es: "presioné atrás y me apareció una oferta con un reloj corriendo".

### B. Refrescar (o cambiar de app) borra visualmente todo lo escrito (confirmado en vivo)
Cada paso guarda su texto en `useState(formData.X)` al montarse, pero `formData` se carga de `localStorage` en un `useEffect` **después** del primer render. Al recargar en medio del flujo:

- Los campos aparecen **vacíos** aunque el usuario ya había escrito todo.
- En el teléfono esto pasa solo: contestas un WhatsApp, el navegador recarga la pestaña al volver, y tu historia desapareció.
- (En desarrollo, con StrictMode, la carrera de efectos llega a **sobrescribir el localStorage con datos vacíos** — lo verifiqué: `rqc_formData` quedó con `recipientName: ""` después de recargar.)

Escribes → te saca → escribes de nuevo → te saca. Otra lectura literal del comentario.

### C. La primera tarjeta del paso 1 te manda a otro sitio web
En "Elige el Ritmo", la primera tarjeta (arriba-izquierda, la posición que más se toca) es **"🇺🇸 Inglés"** con insignia "⭐ POPULAR" — y es un link externo a giftsthatsing.com. Una persona que toca lo primero que ve "popular" acaba en un sitio distinto, en inglés, sin explicación de cómo volver.

### D. Logo y botón ✕ tiran tu progreso sin confirmación
En cada paso, el logo "RegalosQueCantan" (esquina superior, enorme) y un botón "✕" llevan al landing con un toque. Sin "¿seguro que quieres salir?". Un toque accidental al hacer scroll = vuelta al inicio.

---

## Hallazgo #1 — "No es claro para llenar los espacios": los campos no parecen campos

En el paso de nombres (y el de email):

- Los inputs son **solo una línea inferior** (`border-b`) sobre fondo oscuro — sin caja, sin fondo. Para alguien que aprendió con formularios de papel/Facebook, "un espacio para llenar" es una **caja blanca con borde**. Una línea dorada tenue no se lee como "aquí se escribe".
- Las etiquetas son de **10px, MAYÚSCULAS, blanco al 50%** ("NOMBRE DEL DESTINATARIO *") — casi invisibles y en jerga ("destinatario" en vez de "¿Para quién es la canción?").
- Los placeholders ("Ej: María Elena") parecen texto ya escrito. Usuarios mayores creen que el campo ya está lleno o intentan borrarlo.
- El botón Continuar deshabilitado es gris y **no explica por qué no funciona**. Tocas "Continuar", no pasa nada, nadie te dice qué falta. (El paso de nombres sí valida al tocar; el paso 1 y el email simplemente ignoran el toque.)

## Hallazgo #2 — "Es difícil. Redactar." : la historia es una hoja en blanco de 2000 caracteres

El paso "Cuéntanos la historia" es el corazón del producto y es el más hostil:

- Un **textarea gigante vacío** con la instrucción implícita "redacta tu historia". A la gente le cuesta redactar (lo dice Karmenzita con puntos entre cada palabra). De ahí el 15-20% de historias vacías.
- Encima del textarea hay: un **toggle de dos modos** ("Cuéntanos la historia" vs "Usar mi propia letra") — una decisión técnica que el 95% no debería ver primero; un párrafo explicando el toggle; un recuadro de advertencia ⚠️; y debajo, 6 chips de "ideas" que al tocarse solo muestran otra pregunta (no ayudan a escribir), un **segundo textarea** ("¿Hay algo que no puede faltar?"), un medidor de calidad ("Vacío/Básico/Bueno"), consejos laterales… Son **dos cajas de texto y ~10 elementos** compitiendo en una pantalla de teléfono.
- El modo "Usar mi propia letra" es una trampa conocida: gente pega ahí sus datos/anécdotas y el sistema los canta tal cual.
- Si continúas con la historia vacía sale un modal correcto ("No nos contaste nada") pero el botón "Continuar así" tiene el mismo peso visual que "Escribir la historia" — un toque y pasó el pedido vacío.

## Hallazgo #3 — Sobrecarga y jerga en el paso 1

- 11 tarjetas de género + "VER MÁS GÉNEROS (13 MÁS)" = 24 opciones. Al elegir una, aparecen **subgéneros en jerga** ("Tumbados", "Bélico", "Alterados", "Tecnobanda") sin explicación, luego "¿No ves tu estilo? Escríbelo tú mismo", luego tipo de voz — todo apilado en la misma página con auto-scrolls que mueven la pantalla solos. Página larguísima; el botón Continuar queda muy abajo.
- El paso de ocasión **auto-avanza 1.2 segundos después de tocar** una tarjeta. Si tocaste mal, la página cambia sola — para un usuario inexperto eso es "el sistema hizo algo que yo no pedí" (otro "me saca").

## Hallazgo #4 — Inconsistencia que desorienta

- El progreso se dibuja **distinto en cada paso**: barra fina arriba (paso 1), barrita con texto (paso 2), puntos (pasos 3-5). El componente bonito `ProgressBar.jsx` (pasos numerados clicables "Género → Ocasión → Nombres → Historia → Confirmar") **existe pero ningún paso del funnel lo usa**.
- Botones "Atrás" cambian de lugar: abajo-izquierda fijo (paso 2), debajo del Continuar (paso 3), arriba del footer (paso 4). A veces "Atrás", a veces "Volver", a veces "Volver atrás".
- Textos legales/footer con links muertos (`href="#"`).

---

## Recomendaciones (en orden de impacto)

1. **Arreglar el botón atrás** — un listener global de `popstate` en `App.jsx` que sincronice la página con la URL. Es un fix de ~10 líneas y elimina la causa #1 de expulsión. Hacerlo también dentro del wizard: atrás = pregunta anterior, nunca salir sin aviso.
2. **Persistencia instantánea y restauración síncrona** — cargar `rqc_formData` con un inicializador perezoso de `useState` (síncrono, antes del primer render) para que refrescar/cambiar de app nunca borre nada visualmente.
3. **Una pregunta por pantalla** — convertir el flujo en un asistente tipo conversación: "¿Para quién es la canción?" → "¿Quién se la regala?" → "¿Qué celebramos?" → "¿Qué música le gusta?" → historia guiada → email. Cada pantalla: una pregunta grande, una caja de respuesta obvia, un botón grande siempre visible.
4. **Historia guiada por mini-preguntas** en lugar de hoja en blanco: 3-4 preguntas concretas y opcionales ("¿Cómo le dices de cariño?", "¿Un recuerdo que siempre cuentan?", "¿Qué quieres decirle con esta canción?") que se combinan en la historia. Mata el problema de las historias vacías Y el "es difícil redactar". El modo "mi propia letra" se esconde detrás de un link pequeño.
5. **Campos que parecen campos**: cajas con borde visible y fondo claro, etiquetas de 16px+ en lenguaje normal, texto de ejemplo FUERA del campo, tipografía de 18px+ dentro.
6. **Quitar la tarjeta "Inglés" del primer lugar** (o moverla al final como texto discreto) y proteger logo/✕ con confirmación si hay progreso.
7. **Botones que explican en vez de ignorar**: si falta algo, al tocar "Siguiente" decir exactamente qué falta ("Escribe el nombre de tu mamá arriba ☝️"), nunca un botón gris mudo.
8. **Sin auto-avance**; el usuario siempre confirma con su propio toque.
9. **Género simplificado**: 6-8 tarjetas grandes con descripción en cristiano ("Corrido — como Peso Pluma", "Ranchera — como Vicente Fernández"), estilo/subgénero como afinación opcional.
10. **Progreso único y consistente** en todos los pasos ("Paso 2 de 6" grande + barra), mismo lugar para Atrás/Siguiente siempre.

## Lo construido en esta rama (local, NO desplegado)

- Fix global de `popstate` en `App.jsx`.
- Nuevo flujo simplificado en `src/pages/SimpleCreateFlow.jsx`, ruta `/crear`, una pregunta por pantalla, historia guiada, persistencia síncrona, botón atrás integrado. Reutiliza el mismo `formData` y desemboca en el mismo `GeneratingPage`/backend — cero cambios de backend.
- El funnel original queda intacto en `/create/*` para poder correr un A/B.
