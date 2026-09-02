# `site/` — página pública de descargas

La página desde la que un estudiante descarga Telar. Vive aquí (es parte del
entregable de la tesis) y se **sirve** desde GitHub Pages en
<https://telar-javeriana.github.io/telar/>.

```
site/
├── index.html                 estructura y todo el texto
├── styles.css                 tokens de Telar + estilos de la página
├── app.js                     detección de SO, render y pestañas
├── release.json               datos del release  ← generado, no editar a mano
├── favicon.svg
└── scripts/
    ├── sync-release.mjs       regenera release.json desde GitHub
    └── publish-pages.sh       publica el sitio en GitHub Pages
```

## Por qué no tiene backend

La página no tiene estado, ni usuarios, ni secretos, ni nada que escribir. Los
únicos datos que necesita —lista de artefactos, tamaños, checksums, versión— ya
existen en GitHub Releases. Un servidor solo añadiría un segundo servicio que
mantener vivo y, en los planes gratuitos, uno que **se duerme**: 30-50 segundos
de arranque en frío delante de una página cuyo único trabajo es entregar un
enlace rápido.

Tampoco llama a la API de GitHub desde el navegador. Sin autenticar son
**60 peticiones por hora y por IP**; un salón entero detrás del NAT de la
universidad la agota y la página se queda sin descargas justo cuando más gente
la abre. Por eso los datos se hornean en `release.json` antes de publicar.

## Publicar una versión nueva

Después de publicar el release en GitHub:

```bash
cd telar/site
node scripts/sync-release.mjs      # release.json ← último release
bash scripts/publish-pages.sh      # sube el sitio a la rama gh-pages
```

`sync-release.mjs` acepta una etiqueta concreta si hace falta publicar una
versión que no es la última: `node scripts/sync-release.mjs v1.0.2`.

Los dos scripts usan `gh`, el mismo GitHub CLI con el que se publican los
releases. No hay que guardar ningún token en ninguna parte.

**Solo la primera vez**, hay que habilitar Pages en el repositorio de releases:

```bash
gh api -X POST repos/telar-javeriana/telar/pages \
  -f 'source[branch]=gh-pages' -f 'source[path]=/'
```

## Probar en local

```bash
cd telar/site
npx serve .            # o cualquier servidor estático
```

Tiene que servirse por HTTP, no abrirse con `file://`: `app.js` es un módulo y
hace `fetch('./release.json')`, y ambas cosas fallan bajo `file://`.

## Cómo se clasifican los artefactos

`sync-release.mjs` mira el nombre de cada asset del release y le asigna
plataforma, tipo y etiqueta:

| Patrón del nombre | Plataforma | Tipo | Recomendado |
|---|---|---|---|
| `*Setup*.exe` | Windows | instalador | sí |
| `*.exe` | Windows | portable | no |
| `*.deb` | Linux | instalador | sí |
| `*.AppImage` | Linux | portable | no |

Lo que no encaja en ninguna fila (el `SHA256SUMS`, los «Source code» de GitHub)
se ignora. **Si un release futuro cambia el nombre de un artefacto, hay que
actualizar `KINDS` en el script**, o esa descarga no aparecerá en la página.

## Diseño

`styles.css` copia los tokens de `frontend/src/styles/tokens.css` —los mismos
hex, los mismos ratios de contraste, los mismos nombres— en lugar de importar
el CSS de la app, que arrastraría la hoja de componentes completa de una SPA
para una página de cuatro enlaces. **Si la paleta de la app cambia, hay que
re-sincronizar ese bloque a mano.**

Los iconos de Windows y de Tux van rellenos, y no en trazo como el resto del
set de la app: en una página de descargas el logo de la plataforma es la señal
que la gente busca de un vistazo, y ahí pesa más el reconocimiento que la
coherencia del set.

## Detalles que conviene no romper

- **La página dice que no hay versión para macOS.** Si un visitante llega desde
  un Mac no se le ofrece un binario que no va a ejecutarse; se le explica.
- **El botón «Notas de la versión» lleva icono a propósito.** Por debajo de
  640px la hoja oculta el texto de los botones de la cabecera, y sin icono ese
  botón quedaría vacío.
- **El archivo `SHA256SUMS` lista los ejecutables de Windows con espacios**
  (`Telar Setup 1.0.3.exe`) pero GitHub los entrega con puntos
  (`Telar.Setup.1.0.3.exe`), así que `sha256sum -c` solo casa con los dos
  artefactos de Linux. La página lo advierte y muestra la tabla con los nombres
  reales. Se arregla de raíz nombrando los assets sin espacios en el próximo
  release.
