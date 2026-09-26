// check-youtube-embed.mjs — prueba de humo REAL del video de YouTube en Electron.
//
// NO forma parte de los tests automáticos: necesita RED (carga youtube-nocookie
// de verdad) y PANTALLA (Electron abre una ventana; en WSLg basta DISPLAY=:0).
//
// Qué hace: compila src/security.ts con esbuild (la MISMA configuración de
// seguridad que la app: hardenSession + attachNavigationGuards), abre una
// ventana Electron con un iframe idéntico al de LessonMedia (mismo src,
// referrerPolicy y allow) y mira DENTRO del frame del reproductor si está sano
// (hay <video> o botón de reproducir) o muestra el overlay de error `.ytp-error`
// («An error occurred…», error 153…). Dos escenarios, cada uno en su propio
// proceso Electron (las constantes se leen del entorno al importar):
//   A · file://  → la página con loadFile, como la app instalada.
//   B · http     → la página servida por http.createServer en localhost, como
//                  `npm run dev` (se exporta VITE_DEV_SERVER_URL a ese origen).
//
// Uso (Node 22, desde telar/desktop):
//   node scripts/check-youtube-embed.mjs [videoId] [--show] [--hosts]
//   · videoId por defecto: st2ONJO-5WM (el de la lección primerEjemplo).
//   · --show muestra la ventana (por defecto oculta).
//   · --hosts lista los hosts que contactó la página (qué necesita el reproductor).
// Sale con código 0 si ambos escenarios dan OK, 1 si alguno da ERROR.
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_VIDEO_ID = 'st2ONJO-5WM'
const TIMEOUT_MS = 30_000
const POLL_MS = 1_000

const args = process.argv.slice(2)
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

// Mismo marcado que genera LessonMedia.tsx (src, title, loading, referrerPolicy, allow).
function pageHtml(videoId) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>check</title></head>
<body style="margin:0">
<iframe id="v" width="800" height="450"
  src="https://www.youtube-nocookie.com/embed/${videoId}"
  title="Video de la lección (check)" loading="lazy"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
  allowfullscreen></iframe>
</body></html>`
}

// ─── Proceso orquestador (node) ────────────────────────────────────────────
async function orchestrate() {
  const { build } = await import('esbuild')
  const work = mkdtempSync(path.join(tmpdir(), 'telar-yt-'))
  const bundle = path.join(work, 'security.cjs')
  await build({
    entryPoints: [path.join(DESKTOP_DIR, 'src/security.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['electron'],
    outfile: bundle,
    logLevel: 'error',
  })
  const videoId = args.find((a) => !a.startsWith('--')) ?? DEFAULT_VIDEO_ID
  const electronBin = createRequire(import.meta.url)('electron')
  let ok = true
  for (const scenario of ['file', 'http']) {
    const code = await new Promise((resolve) => {
      const child = spawn(
        electronBin,
        [fileURLToPath(import.meta.url), `--scenario=${scenario}`, `--bundle=${bundle}`,
          `--work=${work}`, `--video=${videoId}`, ...['--show', '--hosts'].filter((f) => args.includes(f))],
        { stdio: 'inherit', env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ':0' } },
      )
      child.on('exit', (c) => resolve(c ?? 1))
    })
    ok &&= code === 0
  }
  process.exit(ok ? 0 : 1)
}

// ─── Proceso Electron (un escenario) ───────────────────────────────────────
async function runScenario() {
  const scenario = flag('scenario')
  const work = flag('work')
  const videoId = flag('video')
  const label = scenario === 'file' ? 'A · file:// (app instalada)' : 'B · http://localhost (dev)'
  const html = pageHtml(videoId)

  let server
  if (scenario === 'http') {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    // Como `npm run dev`: la app se sirve desde VITE_DEV_SERVER_URL (localhost).
    process.env.VITE_DEV_SERVER_URL = `http://localhost:${server.address().port}`
  }

  const { app, BrowserWindow, session } = await import('electron')
  app.setPath('userData', mkdtempSync(path.join(work, `ud-${scenario}-`)))
  app.disableHardwareAcceleration() // como main.ts
  await app.whenReady()

  // La MISMA seguridad que la app (el bundle se importa tras fijar el entorno).
  const security = createRequire(import.meta.url)(flag('bundle'))
  security.hardenSession()

  const embedReferers = []
  session.defaultSession.webRequest.onSendHeaders(
    { urls: ['https://www.youtube-nocookie.com/embed/*'] },
    (d) => embedReferers.push(d.requestHeaders.Referer ?? '(sin Referer)'),
  )

  const hosts = new Set()
  session.defaultSession.webRequest.onCompleted((d) => {
    try {
      hosts.add(new URL(d.url).hostname)
    } catch {
      /* URL no parseable: se ignora */
    }
  })

  const win = new BrowserWindow({
    width: 900,
    height: 600,
    show: args.includes('--show'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  })
  security.attachNavigationGuards(win)
  const cspMessages = []
  win.webContents.on('console-message', (e) => {
    const msg = e.message ?? ''
    if (/Content Security Policy|Refused to/i.test(msg)) cspMessages.push(msg)
  })

  if (scenario === 'file') {
    const file = path.join(work, 'pagina.html')
    writeFileSync(file, html)
    await win.loadFile(file)
  } else {
    await win.loadURL(process.env.VITE_DEV_SERVER_URL)
  }

  // Sonda dentro del frame del reproductor. Sano = hay reproductor
  // (.html5-video-player con <video>), sin overlay de error, y el <video>
  // AVANZA al darle play (silenciado para que la política de autoplay no lo
  // impida): eso demuestra que también llegan los segmentos de googlevideo.
  const probe = `(() => {
    const err = document.querySelector('.ytp-error')
    const errText = err ? err.innerText.trim().replace(/\\s+/g, ' ') : ''
    const body = document.body ? document.body.innerText : ''
    const video = document.querySelector('video')
    return {
      error: errText || (/An error occurred|Error 15\\d/.test(body) ? body.slice(0, 200) : ''),
      player: !!document.querySelector('.html5-video-player') && !!video,
      time: video ? video.currentTime : 0,
      title: document.title,
      playError: window.__playError || '',
      readyState: video ? video.readyState : -1,
    }
  })()`
  // play() no se espera: en una ventana oculta su promesa puede no resolverse.
  // Se usa la API del propio reproductor (#movie_player), como el botón de play.
  const play = `(() => { const p = document.getElementById('movie_player');
    if (p && p.playVideo) { p.mute(); p.playVideo(); return 'playVideo()' }
    const v = document.querySelector('video'); v.muted = true;
    v.play().catch((e) => { window.__playError = String(e) }); return 'video.play()' })()`
  // executeJavaScript/capturePage pueden colgarse con el frame navegando.
  const withTimeout = (p, ms = 5_000) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

  const findFrame = () =>
    win.webContents.mainFrame.framesInSubtree.find((f) =>
      f.url.startsWith('https://www.youtube-nocookie.com/embed/'),
    )
  let state = { error: '', player: false, time: 0, title: '', frame: false }
  let playResult = ''
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const frame = findFrame()
    if (!frame) continue
    try {
      state = { ...(await withTimeout(frame.executeJavaScript(probe))), frame: true }
      if (state.player && !state.error && !playResult) playResult = await withTimeout(frame.executeJavaScript(play))
    } catch {
      continue // el frame aún navega
    }
    if (state.error || state.time > 1) break
  }

  const healthy = state.frame && !state.error && state.player && state.time > 1
  const reason = !state.frame
    ? 'el iframe del reproductor no llegó a cargar'
    : state.error
      ? `overlay de error: «${state.error}»`
      : !state.player
        ? 'no aparece el reproductor (.html5-video-player + <video>)'
        : `el video no avanza (currentTime=${state.time}, readyState=${state.readyState}, ${playResult || 'play no intentado'} ${state.playError})`
  console.log(`\n[${label}] ${healthy ? 'OK' : `ERROR — ${reason}`}`)
  const shot = path.join(work, `captura-${scenario}.png`)
  try {
    writeFileSync(shot, (await withTimeout(win.webContents.capturePage())).toPNG())
    console.log(`  Captura: ${shot}`)
  } catch {
    console.log('  Captura: no disponible (ventana oculta; usa --show)')
  }
  console.log(`  Título del frame: ${state.title || '(vacío)'} · currentTime=${state.time.toFixed(1)}s`)
  console.log(`  Referer del embed: ${embedReferers.join(' | ') || '(no se vio la petición)'}`)
  if (args.includes('--hosts')) console.log(`  Hosts contactados: ${[...hosts].sort().join(', ')}`)
  console.log(`  Violaciones de CSP en consola: ${cspMessages.length}`)
  for (const m of cspMessages.slice(0, 5)) console.log(`    · ${m.slice(0, 220)}`)
  server?.close()
  app.exit(healthy ? 0 : 1)
}

if (process.versions.electron) {
  runScenario().catch((e) => {
    console.error(e)
    process.exit(1)
  })
} else {
  orchestrate()
}
