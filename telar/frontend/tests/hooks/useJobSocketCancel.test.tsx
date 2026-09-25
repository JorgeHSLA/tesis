// S7b · CU-08.2: sin WebSocket abierto, cancelar usa POST /cancel o avisa.
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { ApiError } from '@/api/client'

vi.mock('@/api/jobs', () => ({ cancelJob: vi.fn() }))

import { cancelJob } from '@/api/jobs'
import { useJobSocket } from '@/hooks/useJobSocket'
import { useJobStore } from '@/stores/jobStore'
import { CANCEL_FAILED_MESSAGE } from '@/ws/jobSocket'
import { FakeWebSocket } from '../setup'

const cancelJobMock = cancelJob as Mock

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>
}

beforeEach(() => {
  FakeWebSocket.reset()
  useJobStore.getState().reset()
  cancelJobMock.mockReset()
})

describe('cancelar', () => {
  it('con el socket abierto envía el frame y queda «cancelando»', async () => {
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    act(() => FakeWebSocket.last!.open())
    await act(async () => {
      await result.current.cancel()
    })
    expect(FakeWebSocket.last!.sent).toEqual(['{"type":"cancel"}'])
    expect(cancelJobMock).not.toHaveBeenCalled()
    expect(result.current.cancelling).toBe(true)
  })

  it('sin socket abierto cae al REST cancelJob', async () => {
    cancelJobMock.mockResolvedValue({ job_id: 'j1', status: 'cancelling' })
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    await act(async () => {
      await result.current.cancel()
    })
    expect(cancelJobMock).toHaveBeenCalledWith('j1')
    expect(result.current.cancelling).toBe(true)
    expect(result.current.cancelError).toBeNull()
  })

  it('si el REST falla avisa que la ejecución puede seguir activa', async () => {
    cancelJobMock.mockRejectedValue(new ApiError('DOCKER_UNAVAILABLE', 'x', 503))
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    await act(async () => {
      await result.current.cancel()
    })
    expect(result.current.cancelling).toBe(false)
    expect(result.current.cancelError).toBe(CANCEL_FAILED_MESSAGE)
    expect(CANCEL_FAILED_MESSAGE).toBe(
      'No fue posible solicitar la cancelación. La ejecución puede continuar activa.',
    )
  })

  it('409 JOB_NOT_CANCELLABLE (ya terminó) no muestra el aviso', async () => {
    cancelJobMock.mockRejectedValue(new ApiError('JOB_NOT_CANCELLABLE', 'terminal', 409))
    const { result } = renderHook(() => useJobSocket('j1'), { wrapper })
    await act(async () => {
      await result.current.cancel()
    })
    expect(result.current.cancelling).toBe(false)
    expect(result.current.cancelError).toBeNull()
  })
})
