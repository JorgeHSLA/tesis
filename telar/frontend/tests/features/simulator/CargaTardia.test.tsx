// CU-06.1 — una lectura de archivo anterior que termina TARDE no pisa el archivo
// elegido después (ni su error). Vale para el dropzone del simulador y para el
// del editor de ejemplos, que comparten usePyFilePicker.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CodePanel } from '@/features/simulator/CodePanel'
import { CodeDropzone } from '@/features/admin/example/CodeDropzone'

/** Archivo cuya lectura queda pendiente hasta que el test la suelte. */
function archivoLento(nombre: string, contenido: string) {
  const file = new File([contenido], nombre)
  let soltar!: () => void
  const listo = new Promise<void>((r) => {
    soltar = r
  })
  const leer = file.arrayBuffer.bind(file)
  Object.defineProperty(file, 'arrayBuffer', { value: () => listo.then(leer), configurable: true })
  return { file, soltar }
}

const PANELES = [
  ['CodePanel', (onFile: () => void) => <CodePanel filename="main.py" code="" edited={false} onCodeChange={() => {}} onFile={onFile} />],
  ['CodeDropzone', (onFile: () => void) => <CodeDropzone filename="main.py" code="" onCodeChange={() => {}} onFile={onFile} />],
] as const

describe.each(PANELES)('%s · lecturas que llegan tarde', (_nombre, montar) => {
  const elegir = (file: File) =>
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })

  it('el primer archivo, si termina después, no pisa al segundo', async () => {
    const onFile = vi.fn()
    render(montar(onFile))
    const lento = archivoLento('viejo.py', 'print("viejo")')
    elegir(lento.file)
    elegir(new File(['print("nuevo")'], 'nuevo.py'))
    await waitFor(() => expect(onFile).toHaveBeenCalledWith({ filename: 'nuevo.py', code: 'print("nuevo")' }))

    await act(async () => {
      lento.soltar()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(onFile).toHaveBeenCalledTimes(1)
  })

  it('el error de una lectura vieja tampoco aparece sobre el archivo nuevo', async () => {
    const onFile = vi.fn()
    render(montar(onFile))
    // Falla al LEER (no es UTF-8), y la lectura termina tarde.
    const lento = archivoLento('roto.py', 'x')
    const leer = lento.file.arrayBuffer
    Object.defineProperty(lento.file, 'arrayBuffer', {
      value: () => leer().then(() => new Uint8Array([0xff, 0xfe]).buffer),
    })
    elegir(lento.file)
    elegir(new File(['x = 1'], 'bien.py'))
    await waitFor(() => expect(onFile).toHaveBeenCalledTimes(1))

    await act(async () => {
      lento.soltar()
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(screen.queryByText('El archivo no es texto UTF-8')).toBeNull()
  })
})
