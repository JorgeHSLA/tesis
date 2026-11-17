// lib/dockerErrors — el estudiante no debe ver stderr crudo de Docker.
import { describe, expect, it } from 'vitest'
import { DOCKER_STARTING_MARK, friendlyDockerError } from '@/lib/dockerErrors'

describe('friendlyDockerError', () => {
  it('sin texto → null', () => {
    expect(friendlyDockerError(null)).toBeNull()
    expect(friendlyDockerError(undefined)).toBeNull()
    expect(friendlyDockerError('   ')).toBeNull()
  })

  it('Docker Desktop cerrado (Windows) → mensaje llano y detalle técnico plegable', () => {
    const raw =
      'error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.51/containers/json": open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.'
    const f = friendlyDockerError(raw)
    expect(f?.title).toBe('Docker Desktop no está abierto')
    expect(f?.hint).toMatch(/Engine running/)
    expect(f?.raw).toContain('dockerDesktopLinuxEngine')
    expect(f?.starting).toBe(false)
  })

  it('daemon caído en Linux/Mac', () => {
    expect(
      friendlyDockerError('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?')?.title,
    ).toBe('Docker Desktop no está abierto')
  })

  it('Docker en pausa', () => {
    expect(
      friendlyDockerError('Service Unavailable ("Docker Desktop is manually paused. Unpause it through the Whale menu or Dashboard.")')
        ?.title,
    ).toBe('Docker Desktop está en pausa')
  })

  it('Docker no instalado', () => {
    expect(friendlyDockerError('Docker no está instalado o no está en el PATH')?.title).toBe('No encontramos Docker')
    expect(friendlyDockerError('spawn docker ENOENT')?.title).toBe('No encontramos Docker')
  })

  it('permisos: gana a «daemon», aunque el texto mencione docker.sock', () => {
    const f = friendlyDockerError(
      'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock',
    )
    expect(f?.title).toBe('Sin permiso para usar Docker')
  })

  it('tiempo agotado', () => {
    expect(friendlyDockerError('Command failed: timed out after 600000ms')?.title).toBe(
      'Docker tardó demasiado en responder',
    )
  })

  it('arranque automático de Docker Desktop: es una espera, no un fallo', () => {
    const f = friendlyDockerError(`${DOCKER_STARTING_MARK}…`)
    expect(f).toMatchObject({ starting: true, raw: null, title: 'Abriendo Docker Desktop…' })
  })

  it('error desconocido → mensaje genérico con el texto original recortado', () => {
    const f = friendlyDockerError('x'.repeat(2000))
    expect(f?.title).toBe('Docker no respondió como se esperaba')
    expect(f?.raw).toHaveLength(600)
  })
})
