// hooks/useReplay.ts — el «reloj» del reproductor de la ejecución.
//
// Avanza `time` (ms) a la velocidad elegida con requestAnimationFrame mientras
// `playing`. Con movimiento reducido no hay animación continua: el reloj sigue
// funcionando (es información), pero la pantalla solo repinta lo necesario.
//
// Al montar (job ya terminado) queda parado AL FINAL, mostrando el resultado real
// completo; «Reproducir» desde el final arranca desde el principio, como un video.
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Replay {
  /** Instante mostrado, en ms desde el principio. */
  time: number
  playing: boolean
  /** Multiplicador de velocidad (0.25×–4×). */
  speed: number
  duration: number
  atEnd: boolean
  setSpeed: (s: number) => void
  play: () => void
  pause: () => void
  toggle: () => void
  /** Salta a un instante (se acota a [0, duración]). */
  seek: (ms: number) => void
  /** Mueve el instante `deltaMs` (negativo = retroceder). */
  step: (deltaMs: number) => void
  restart: () => void
}

export function useReplay(duration: number): Replay {
  const [time, setTime] = useState(duration)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const speedRef = useRef(speed)
  speedRef.current = speed
  const timeRef = useRef(time)
  timeRef.current = time
  const durationRef = useRef(duration)
  durationRef.current = duration

  // Mientras el job corre la duración crece y el reproductor sigue el final; al
  // terminar, `duration` deja de cambiar y el control es de la persona.
  const followEnd = useRef(true)
  useEffect(() => {
    if (followEnd.current) setTime(duration)
    else setTime((t) => Math.min(t, duration))
  }, [duration])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) * speedRef.current
      last = now
      const next = Math.min(durationRef.current, timeRef.current + dt)
      timeRef.current = next
      setTime(next)
      if (next >= durationRef.current) {
        setPlaying(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const clampT = (ms: number) => Math.min(durationRef.current, Math.max(0, ms))

  const seek = useCallback((ms: number) => {
    followEnd.current = false
    setTime(clampT(ms))
  }, [])

  const play = useCallback(() => {
    followEnd.current = false
    if (timeRef.current >= durationRef.current) setTime(0) // como un video: desde el final, vuelve a empezar
    timeRef.current = timeRef.current >= durationRef.current ? 0 : timeRef.current
    setPlaying(true)
  }, [])

  const pause = useCallback(() => setPlaying(false), [])

  const toggle = useCallback(() => {
    if (playing) setPlaying(false)
    else play()
  }, [playing, play])

  const step = useCallback((deltaMs: number) => seek(timeRef.current + deltaMs), [seek])
  const restart = useCallback(() => {
    seek(0)
  }, [seek])

  return {
    time,
    playing,
    speed,
    duration,
    atEnd: time >= duration,
    setSpeed,
    play,
    pause,
    toggle,
    seek,
    step,
    restart,
  }
}
