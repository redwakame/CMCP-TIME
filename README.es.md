# CMCP-TIME

[English](README.md) · [繁體中文](README.zh-TW.md) · **Español** · [日本語](README.ja.md)

![CMCP-TIME: continuar un proyecto con las palabras originales, sus fechas y una lectura controlada.](docs/assets/cmcp-time-hero.png)

## Conserva las palabras originales. Da a la próxima conversación un punto de partida verificable.

**Una habilidad de continuidad temporal para asistentes de IA.** CMCP-TIME conserva el texto original autorizado, las imágenes, los roles y las marcas de tiempo, y proporciona las fuentes pertinentes cuando el asistente necesita retomar un trabajo.

También permite distinguir lo que se planeó, lo que cambió y lo que alguien informó como terminado. **Tu modelo sigue razonando. CMCP-TIME aporta fuentes verificables, información temporal y un flujo de continuidad controlado.**

**v0.1.1 · Apache-2.0 · Creado y mantenido por [redwakame](https://github.com/redwakame)**

[Primeros pasos](#primeros-pasos) · [Cómo funciona](#cómo-funciona) · [Diferencias entre versiones](docs/version-comparison.es.md) · [Comentarios y colaboración](#comentarios-y-colaboración)

*Las ilustraciones representan conceptos de uso; no son capturas ni transcripciones de pruebas. Los personajes, diálogos y fechas de ejemplo son ilustrativos. Las capacidades disponibles se definen en la documentación de la versión.*

## Cambia una parte sin volver a explicar todo el proyecto

Ayer acordaste un plan. Hoy dices:

> «Cambia la entrega al viernes. Mantén el presupuesto y las condiciones de aprobación originales».

La nueva conversación necesita algo más que «había un plan»: necesita las condiciones originales, la modificación y lo que sigue vigente. CMCP-TIME está diseñado para que un asistente conectado recupere esas fuentes cuando sean necesarias, en lugar de depender únicamente de un resumen sin trazabilidad.

Es un ejemplo de uso, no una respuesta garantizada. El modelo puede interpretar mal una fuente que sí recibió; CMCP no reescribe su respuesta final.

| Lo que necesitas | Lo que aporta CMCP-TIME |
|---|---|
| Recuperar lo que se dijo | Registros originales autorizados con roles, fechas originales y relaciones entre fuentes. |
| Entender qué cambió | Organización basada en fuentes de planes, modificaciones delimitadas, hechos comunicados y razones expresadas. |
| Retomar una conversación extensa o pasar trabajo entre asistentes conectados | Localización y lectura acotada de fuentes, con páginas faltantes, permisos y material no leído explícitos. |
| Decidir qué seguir y cuándo evitar interrupciones | Controles separados para guardar datos, Buffer, Pin, horarios de silencio y envío proactivo. |

CMCP-TIME puede coexistir con la memoria nativa del asistente. No es una plataforma de chat completa ni esta versión demuestra superioridad frente a la memoria de otros productos.

## Primeros pasos

Prepara **Node.js 22.16.0 o posterior** y npm, y elige una ubicación persistente. Instala la versión fija `0.1.1` desde npm:

```sh
npm install --prefix ./cmcp-0.1.1 @redwakame-skill/cmcp-time@0.1.1
node ./cmcp-0.1.1/node_modules/@redwakame-skill/cmcp-time/bin/cmcp-time.mjs --version
node ./cmcp-0.1.1/node_modules/@redwakame-skill/cmcp-time/bin/cmcp-time.mjs setup --help
```

Después sigue la [guía de configuración y actualización](docs/npm-installation.md) y selecciona un espacio de trabajo autorizado. Utiliza el asistente interactivo en una terminal, o `--answers` para automatizar la configuración. **No se admite enviar todas las respuestas interactivas de una vez mediante una tubería.**

**Instalar archivos no conecta un asistente.** No importa conversaciones privadas, autoriza consumo de modelos, activa envíos proactivos ni sustituye automáticamente tu instalación habitual. Codex es opcional. No uses una caché temporal de `npx` ni un almacenamiento de persistencia no confirmada para una conexión permanente.

Los artefactos de GitHub y npm pueden diferir en configuración de publicación y documentación. Consulta sus respectivos registros para comprobar el contenido ejecutable y la correspondencia de fuentes. Un mismo número de versión no implica archivos idénticos; `latest` no identifica una fuente inmutable.

## Cómo funciona

![Cinco etapas: recibir fuentes autorizadas, conservar su procedencia, leer un conjunto seleccionado, aplicar controles y devolver el contexto al asistente.](docs/assets/cmcp-time-how-it-works.png)

| Etapa | Significado |
|---|---|
| **1. Recibir fuentes autorizadas** | Un asistente conectado proporciona contenido real de User/Assistant, roles, fechas e imágenes originales compatibles. |
| **2. Conservar originales y procedencia** | Guardar las palabras originales, sin presentar una paráfrasis del modelo como el original; mantener las identidades y relaciones necesarias para verificarlas. |
| **3. Leer lo necesario para esta solicitud** | Localizar y leer mediante la interfaz formal. `READ-ALL` significa la paginación completa del conjunto seleccionado y autorizado, no toda la base, un resultado top-k ni una garantía de que todo llegó al contexto del modelo. |
| **4. Aplicar controles independientes** | Guardado, seguimiento reciente, objetivos explícitos y silencio tienen responsabilidades distintas. Acceder a datos no autoriza acciones externas. |
| **5. Dejar que el asistente original continúe** | Devolver las fuentes y su información temporal al modelo. Cuando se solicite, organizar el estado actual con respaldo documental, incertidumbres y límites de cobertura. |

**La Skill explica el flujo, el Runtime ejecuta el guardado y la lectura, y un Adapter conecta el asistente.** Un archivo de habilidad por sí solo no incorpora todas las conversaciones de ChatGPT u otras plataformas. La falta de eventos, fuentes o permisos debe mostrarse.

## History, Buffer, Pin y silencio

| Componente | Función y límite |
|---|---|
| **History** | Conserva registros originales autorizados para su consulta formal. Estar guardado no equivale a ser legible en este momento. |
| **Buffer** | Gestiona el seguimiento reciente. Por defecto, 12 horas; ajustable entre 6 y 48. Su caducidad o limpieza no borra History ni los Pin independientes. |
| **Pin** | Objetivo de seguimiento seleccionado explícitamente. Sin una hora programada no se convierte automáticamente en recordatorio. |
| **DND / no molestar** | Controla las interrupciones de los envíos proactivos. **No es el interruptor que detiene el guardado de fuentes.** |
| **Envío proactivo** | Empieza desactivado y depende de autorización, destino, cancelación, deduplicación y tiempo. Conservar un valor de 60 segundos no promete un mensaje cada minuto. |

En Harness Desktop con la integración activa, están disponibles `/cmcp help`, `/cmcp on`, `/cmcp off` y `/cmcp ui minimized`, `row` o `hidden`. **Ocultar la interfaz no desactiva CMCP.** Son entradas de ese asistente, no comandos universales para todos los agentes.

Sin interfaz gráfica, utiliza el CLI, el proyecto o MCP. Consulta los [comandos](docs/commands.md), la [configuración](docs/configuration.md) y la [guía de uso](docs/release-readiness.es.md).

## ¿Qué entradas tienen verificación registrada?

La tabla describe el alcance registrado por el proyecto, no una garantía general para todas las plataformas o versiones.

| Entrada | Capacidad registrada | Límite |
|---|---|---|
| **DeepSeek Harness Desktop 0.2.0-rc.2 / SDK** | Texto, imágenes originales, consultas en nuevas conversaciones, controles y Pin explícitos; la evidencia del SDK se registra por separado. | Desktop y SDK aislado son verificaciones distintas. No garantiza servicio continuo ni entrega móvil. |
| **Codex** | Skill/Hook, traspaso de texto mediante app-server oficial y compactación nativa delimitada. | Rutas de proyecto y cuenta explícitas; no captura automáticamente cualquier chat de la aplicación. |
| **Hermes v2026.9.24 / 0.21.5** | Ciclo oficial sin interfaz gráfica, herramientas nativas y continuidad de texto delimitada con Harness SDK. | Ruta DeepSeek registrada; no certifica toda la interfaz TUI/GUI. |
| **MCP stdio / Streamable HTTP** | Lectura formal, identificadores de medios, permisos acotados, revocación y servicio local persistente. | Las pruebas locales no demuestran TLS remoto, despliegue público ni aprobación de una plataforma. |

**Codex es opcional; eso no implica compatibilidad universal.** `0.1.1` no añade una integración completa del ciclo de vida de Dots, Muse o Grok Bot. Consulta la [matriz de capacidades y evidencia](docs/interop-capabilities.zh-TW.md).

## ¿Qué cambió de 0.1.0 a 0.1.1?

![Comparación: 0.1.0 estableció fuentes y controles; 0.1.1 reúne mejoras de continuidad y cuatro correcciones de mantenimiento.](docs/assets/cmcp-time-version-diff.png)

**0.1.0** estableció la conservación de originales y fechas, la lectura acotada, los controles independientes y las entradas existentes. **0.1.1** incorpora el trabajo acumulado de S1/S1-R1: separar planes de hechos comunicados, conservar el alcance y las razones de cambios parciales, y mejorar la configuración, determinadas rutas de estado, la explicación del envío proactivo y la trazabilidad de publicación.

`--answers` ya existía. La mejora afecta al manejo no interactivo/EOF y a la configuración sin Codex. No es una nueva integración universal ni solamente una portada diferente.

[Comparación completa](docs/version-comparison.es.md) · [Publicación original 0.1.1 y límites](docs/release-0.1.1.md) · [Historial 0.1.0](docs/release-0.1.0.md)

<details>
<summary><strong>Alcance publicado y límites conocidos</strong></summary>

- Validez estructural, integridad de fuentes, corrección semántica y autorización de ejecución son conceptos distintos. `ready` no garantiza ausencia de errores.
- El mantenimiento de H4 verificó los informes especificados y la paginación completa de la proyección en una Session nueva. La cadena normal no recorrió la rama de resolución; esa rama tiene 13 comprobaciones separadas con fuentes fijas. La fuente adicional r8 no llegó al modelo. No es una lectura `READ-ALL` de todo lo seleccionado ni una repetición del turno intermedio original.
- Persisten los límites de capacidad de C27 163/236. No se encontró el texto completo previo del recibo `be087644…`; no se eliminaron estas limitaciones para declarar éxito total.
- La publicación 0.1.1 se ejecutó en Windows/Node 24.18.0, manteniendo el mínimo Node 22.16.0. Las comprobaciones parciales de Linux no certifican todos los asistentes. Documentar en cuatro idiomas no certifica el comportamiento en los cuatro.
- La búsqueda vectorial, audio/vídeo, sincronización general en la nube, múltiples escritores concurrentes y un agente completo 24/7 no están todos entregados en esta versión.

[Evidencia y límites](docs/verification.md) · [Pruebas](docs/testing.md) · [Privacidad](docs/privacy.md) · [Hoja de ruta](docs/roadmap.md)

</details>

## Documentación, actualizaciones e historia

[Inicio rápido](docs/quick-start.md) · [Instalación y actualización](docs/npm-installation.md) · [Guía de uso](docs/release-readiness.es.md) · [MCP / Hermes](docs/interop.es.md) · [Contribuir](CONTRIBUTING.md) · [Seguridad](SECURITY.md)

Realiza una copia de seguridad según la guía antes de actualizar o desconectar. Los archivos del programa, CMCP History, el historial nativo y las credenciales tienen responsabilidades separadas. Desconectar no borra todos los datos.

CMCP-TIME es la línea de desarrollo de este proyecto. [OpenClaw Continuity](https://github.com/redwakame/openclaw-continuity) y [cmcp](https://github.com/redwakame/cmcp) conservan código anterior y sus propias licencias; no se sustituyen ni migran automáticamente.

## Comentarios y colaboración

Soy **redwakame**, creador y mantenedor de CMCP-TIME. Sigo desarrollando el proyecto y agradezco experiencias de uso, problemas reproducibles, ideas de integración, comentarios y propuestas de colaboración.

**[adarobot666@gmail.com](mailto:adarobot666@gmail.com)**  
**[redwakame616@gmail.com](mailto:redwakame616@gmail.com)**

También puedes abrir un [Issue en GitHub](https://github.com/redwakame/CMCP-TIME/issues). Incluye la versión, el asistente y los pasos mínimos para reproducir el problema. No publiques conversaciones privadas, claves ni directorios completos. Si el proyecto te resulta útil, una Star es bienvenida.

## Licencia

[Apache-2.0](LICENSE). Conserva la atribución a **redwakame**, [NOTICE](NOTICE) y el [historial de licencias de origen](docs/license-provenance-v0.1.md). [CITATION.cff](CITATION.cff) facilita los datos de cita; no añade una obligación de promocionar al autor en cada uso.
