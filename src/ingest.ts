import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
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
): Promise<{ runId: string; repoId: string } | null> {
  const fileBuffer = readFileSync(junitPath)
  const filename = basename(junitPath)

  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: 'text/xml' }), filename)
  form.append('repo', `${ctx.owner}/${ctx.repo}`)
  form.append('sha', ctx.sha)
  form.append('run_id', ctx.runId)
  form.append('run_attempt', process.env.GITHUB_RUN_ATTEMPT ?? '1')
  form.append('branch', ctx.branch)
  if (process.env.GITHUB_WORKFLOW) form.append('workflow', process.env.GITHUB_WORKFLOW)
  if (process.env.GITHUB_JOB) form.append('job', process.env.GITHUB_JOB)
  if (ctx.prNumber) form.append('pr_number', String(ctx.prNumber))

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

  const data = await res.json() as { runDbId: string; repoId: string }
  return { runId: data.runDbId, repoId: data.repoId }
}

export async function sendReportToCloud(
  qaiUrl: string,
  qaiApiKey: string,
  reportPath: string,
  ctx: GithubContext,
): Promise<void> {
  const fileBuffer = readFileSync(reportPath)
  const filename = basename(reportPath)

  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: 'application/json' }), filename)
  form.append('repo', `${ctx.owner}/${ctx.repo}`)
  form.append('sha', ctx.sha)
  form.append('run_id', ctx.runId)
  form.append('run_attempt', process.env.GITHUB_RUN_ATTEMPT ?? '1')
  form.append('branch', ctx.branch)
  if (process.env.GITHUB_WORKFLOW) form.append('workflow', process.env.GITHUB_WORKFLOW)
  if (process.env.GITHUB_JOB) form.append('job', process.env.GITHUB_JOB)
  if (ctx.prNumber) form.append('pr_number', String(ctx.prNumber))

  const url = qaiUrl.replace(/\/$/, '') + '/ingest/playwright-report'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${qaiApiKey}` },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`QAI playwright-report ingest failed: ${res.status} ${text}`)
  }
}

export async function sendTraceToCloud(
  qaiUrl: string,
  qaiApiKey: string,
  tracePath: string,
  ctx: GithubContext,
): Promise<void> {
  const fileBuffer = readFileSync(tracePath)
  // Use parent directory name as filename to make each trace unique and encode the test name.
  // e.g. cart-Cart-added-item-appears-in-cart-chromium/trace.zip → cart-Cart-added-item-appears-in-cart-chromium.zip
  const dirName = basename(dirname(tracePath))
  const filename = dirName !== '.' ? `${dirName}.zip` : basename(tracePath)

  const form = new FormData()
  form.append('file', new Blob([fileBuffer], { type: 'application/zip' }), filename)
  form.append('repo', `${ctx.owner}/${ctx.repo}`)
  form.append('sha', ctx.sha)
  form.append('run_id', ctx.runId)
  form.append('run_attempt', process.env.GITHUB_RUN_ATTEMPT ?? '1')
  form.append('branch', ctx.branch)
  if (process.env.GITHUB_WORKFLOW) form.append('workflow', process.env.GITHUB_WORKFLOW)
  if (process.env.GITHUB_JOB) form.append('job', process.env.GITHUB_JOB)

  const url = qaiUrl.replace(/\/$/, '') + '/ingest/trace'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${qaiApiKey}` },
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`QAI trace ingest failed: ${res.status} ${text}`)
  }
}
