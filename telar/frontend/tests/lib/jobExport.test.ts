// lib/jobExport — exportación estructurada de un job (CU-31.1, 31.2).
import { describe, expect, it } from 'vitest'
import type { JobDetailDto } from '@/api/types'
import { buildJobExport, JOB_EXPORT_FORMAT, jobExportFilename } from '@/lib/jobExport'
import { JOB_BARE, JOB_SWEEP } from '../fixtures/rest'

const NOW = new Date('2026-09-22T10:00:00.000Z')

describe('buildJobExport', () => {
  it('envuelve el JobDetailDto con formato y fecha', () => {
    const out = buildJobExport(JOB_SWEEP, NOW)
    expect(out.format).toBe(JOB_EXPORT_FORMAT)
    expect(out.format).toBe('telar-job-export/1')
    expect(out.exported_at).toBe('2026-09-22T10:00:00.000Z')
    expect(out.job).toEqual(JOB_SWEEP)
  })

  it('los datos ausentes van como null, nunca 0 ni omitidos', () => {
    const out = buildJobExport(JOB_BARE, NOW)
    expect(out.job.metrics_summary).toBeNull()
    expect(out.job.parsed_timings).toBeNull()
    const json = JSON.parse(JSON.stringify(out)) as { job: Record<string, unknown> }
    expect(json.job.metrics_summary).toBeNull()
  })

  it('un campo ausente (undefined) se serializa como null', () => {
    const partial = { ...JOB_SWEEP, wall_time_ms: undefined, finished_at: undefined } as unknown as JobDetailDto
    const json = JSON.parse(JSON.stringify(buildJobExport(partial, NOW))) as { job: Record<string, unknown> }
    expect(json.job).toHaveProperty('wall_time_ms', null)
    expect(json.job).toHaveProperty('finished_at', null)
  })
})

describe('jobExportFilename', () => {
  it('stem-jobid8.json', () => {
    expect(jobExportFilename(JOB_SWEEP)).toBe(`transporteMonteCarlo-${JOB_SWEEP.job_id.slice(0, 8)}.json`)
  })
})
