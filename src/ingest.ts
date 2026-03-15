import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { GithubContext } from './github.js'

/**
 * Optionally send the raw JUnit XML to the QAI cloud ingest endpoint.
 * Mirrors the manual curl: POST /ingest/junit with multipart form data.
 */
export async function sendToCloud(
  qaiUrl: string,
  qaiApiKey: string,
  junitPath: string,
  ctx: GithubContext,
): Promise<void> {
  const fileBuffer = readFileSync(junitPath)
  const filename = basename(junitPath)

  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: 'text/xml' }), filename)
  form.append('repo', `${ctx.owner}/${ctx.repo}`)
  form.append('sha', ctx.sha)
  form.append('run_id', ctx.runId)
  form.append('run_attempt', '1')
  form.append('branch', ctx.branch)

  const url = qaiUrl.replace(/\/$/, '') + '/ingest/junit'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${qaiApiKey}` },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`QAI ingest failed: ${res.status} ${text}`)
  }
}
