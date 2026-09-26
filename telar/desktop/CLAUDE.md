# desktop/ — shell Electron

Ventana Electron que carga el MISMO build del frontend (`../frontend/dist`) y apunta al backend en localhost. Spec completa en `../docs/architecture/electron-spec.md`.

**Decisión de stack**: Electron 43 + electron-builder 26 + **esbuild** para compilar `main.ts`/`preload.ts`. NO se usa electron-vite (asume ser dueño del build del renderer; aquí se reutiliza el build web existente).

## Scripts

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"   # Node 22
npm run typecheck && npm run build   # esbuild → dist-electron/{main.cjs, preload.cjs}
npm run check:contract               # verifica types/telar-api.d.ts == ../frontend/src/types/telar.d.ts
npm run dev                          # vite dev + esbuild watch + electron (necesita display)
npm run dist:linux                   # AppImage + deb
npm run dist:win                     # NSIS + portable (necesita Wine o host Windows)
```

## Archivos

- `src/main.ts` — BrowserWindow (show-on-ready, single-instance, `loadFile` de `resources/app-frontend` en prod vs `VITE_DEV_SERVER_URL` en dev), menú null en prod. `webPreferences`: contextIsolation true, nodeIntegration false, sandbox true, webSecurity true.
- `src/preload.ts` — `contextBridge.exposeInMainWorld('telar', ...)` con `{ appVersion, platform, dockerStatus, dockerUp, dockerStop, openExternal }`. Nunca expone `ipcRenderer` crudo. `__APP_VERSION__` la inyecta esbuild (`define`).
- `src/ipc-docker.ts` — whitelist CERRADA de acciones `compose:ps/up/stop` → arrays de args fijos, `execFile('docker', ...)` **sin shell**, timeout, `assertTrustedSender` (valida senderFrame).
- `src/load-failure.ts` — `did-fail-load`/`render-process-gone` → página de error local (`userData/error-carga.html`) con «Reintentar» (CU-27.5, electron-spec §8).
- `src/unsaved-changes.ts` — `will-prevent-unload` → diálogo «Salir sin guardar / Seguir editando» cuando la Autoría tiene cambios sin guardar (su `beforeunload` cancela la descarga y Electron no muestra nada por sí solo).
- `src/security.ts` — CSP vía `onHeadersReceived` (connect-src al backend local), `will-navigate` whitelist, `setWindowOpenHandler` deny + `shell.openExternal` solo https.
- `resources/compose/compose.yaml` — compose empaquetado (solo `image:`, sin `build:`). `electron-builder.yml` — targets.
- `resources/installer.nsh` / `resources/before-remove.sh` — al desinstalar (no al actualizar), paran y borran el contenedor + imágenes Docker; los volúmenes con datos de usuario no se tocan (electron-spec §6.2).

## CONGELADO / límites

- `types/telar-api.d.ts` debe seguir **byte-idéntico** a `../frontend/src/types/telar.d.ts` (`npm run check:contract` lo comprueba).
- Instaladores Windows y Linux verificados en máquinas limpias (v1.0.1-1.0.3). AppImage y el
  `.exe` portable no tienen desinstalador del sistema, así que no limpian Docker (§6.2, punto 8
  de limitaciones documentadas).
