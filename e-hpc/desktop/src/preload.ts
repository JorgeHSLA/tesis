// preload.ts — puente contextBridge → window.ehpc (electron-spec.md §5.2).
// Expone EXACTAMENTE el contrato de types/ehpc-api.d.ts:
// { appVersion, platform, dockerStatus, dockerUp, dockerStop, openExternal }.
// NUNCA se expone ipcRenderer; solo funciones concretas que invocan canales fijos.
import { contextBridge, ipcRenderer } from 'electron'
import type { EhpcApi } from '../types/ehpc-api'

const api: EhpcApi = {
  appVersion: __APP_VERSION__, // inyectada por esbuild define (scripts/build.mjs)
  platform: process.platform,
  dockerStatus: () => ipcRenderer.invoke('docker:run', 'compose:ps'),
  dockerUp: () => ipcRenderer.invoke('docker:run', 'compose:up'),
  dockerStop: () => ipcRenderer.invoke('docker:run', 'compose:stop'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
}

contextBridge.exposeInMainWorld('ehpc', api)
