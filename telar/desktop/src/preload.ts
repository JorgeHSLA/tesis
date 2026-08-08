// preload.ts — puente contextBridge → window.telar (electron-spec.md §5.2).
// Expone EXACTAMENTE el contrato de types/telar-api.d.ts:
// { appVersion, platform, dockerStatus, dockerUp, dockerStop, openExternal }.
// NUNCA se expone ipcRenderer; solo funciones concretas que invocan canales fijos.
import { contextBridge, ipcRenderer } from 'electron'
import type { TelarApi } from '../types/telar-api'

const api: TelarApi = {
  appVersion: __APP_VERSION__, // inyectada por esbuild define (scripts/build.mjs)
  platform: process.platform,
  dockerStatus: () => ipcRenderer.invoke('docker:run', 'compose:ps'),
  dockerUp: () => ipcRenderer.invoke('docker:run', 'compose:up'),
  dockerStop: () => ipcRenderer.invoke('docker:run', 'compose:stop'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
}

contextBridge.exposeInMainWorld('telar', api)
