# desktop/ — shell Electron

Ventana Electron que carga el MISMO build del frontend (`../frontend/dist`) y apunta al backend en localhost. Spec completa en `../docs/architecture/electron-spec.md`.

**Decisión de stack**: Electron 43 + electron-builder 26 + **esbuild** para compilar `main.ts`/`preload.ts`. NO se usa electron-vite (asume ser dueño del build del renderer; aquí se reutiliza el build web existente).

## Scripts

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"   # Node 22
npm run typecheck && npm run build   # esbuild → dist-electron/{main.cjs, preload.cjs}
npm run check:contract               # verifica types/ehpc-api.d.ts == ../frontend/src/types/ehpc.d.ts
npm run dev                          # vite dev + esbuild watch + electron (necesita display)
npm run dist:linux                   # AppImage + deb
npm run dist:win                     # NSIS + portable (necesita Wine o host Windows)
```

## Archivos

- `src/main.ts` — BrowserWindow (show-on-ready, single-instance, `loadFile` de `resources/app-frontend` en prod vs `VITE_DEV_SERVER_URL` en dev), menú null en prod. `webPreferences`: contextIsolation true, nodeIntegration false, sandbox true, webSecurity true.
- `src/preload.ts` — `contextBridge.exposeInMainWorld('ehpc', ...)` con `{ appVersion, platform, dockerStatus, dockerUp, dockerStop, openExternal }`. Nunca expone `ipcRenderer` crudo. `__APP_VERSION__` la inyecta esbuild (`define`).
- `src/ipc-docker.ts` — whitelist CERRADA de acciones `compose:ps/up/stop` → arrays de args fijos, `execFile('docker', ...)` **sin shell**, timeout, `assertTrustedSender` (valida senderFrame).
- `src/security.ts` — CSP vía `onHeadersReceived` (connect-src al backend local), `will-navigate` whitelist, `setWindowOpenHandler` deny + `shell.openExternal` solo https.
- `resources/compose/compose.yaml` — compose empaquetado (solo `image:`, sin `build:`). `electron-builder.yml` — targets.

## CONGELADO / límites

- `types/ehpc-api.d.ts` debe seguir **byte-idéntico** a `../frontend/src/types/ehpc.d.ts` (`npm run check:contract` lo comprueba).
- **No verificado aún** (limitaciones documentadas): lanzamiento gráfico real (WSL2 es headless — requiere xvfb o host con display) y el instalador Windows (`dist:win` necesita Wine o compilar en Windows). El código y su seguridad sí están verificados por typecheck/build/greps.
