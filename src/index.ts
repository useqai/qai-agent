import * as core from '@actions/core'
import * as glob from '@actions/glob'
import { readFileSync } from 'node:fs'
import { parseJunitXml, analyze, analyzeTraces } from './parse.js'
import { buildComment } from './comment.js'
import { getGithubContext, upsertPrComment } from './github.js'
import { sendToCloud, sendTraceToCloud } from './ingest.js'

async function run(): Promise<void> {
  const junitPath = core.getInput('junit-path', { required: true })
  const githubToken = core.getInput('github-token')
  const postComment = core.getInput('post-comment') !== 'false'
  const qaiUrl = core.getInput('qai-url')
  const qaiApiKey = core.getInput('qai-api-key')
  const tracePath = core.getInput('trace-path')
  const failOnHighRisk = core.getInput('fail-on-high-risk') === 'true'

  // ── Resolve JUnit file(s) ──────────────────────────────────────────────────
  const globber = await glob.create(junitPath)
  const files = await globber.glob()

  if (files.length === 0) {
    core.warning(`No JUnit XML files found matching: ${junitPath}`)
    return
  }

  core.info(`Found ${files.length} JUnit file(s): ${files.join(', ')}`)

  // ── Parse + analyze ────────────────────────────────────────────────────────
  const allTests = files.flatMap(f => parseJunitXml(readFileSync(f, 'utf8')))
  const result = analyze(allTests)

  core.info(`Results: ${result.totalTests} tests, ${result.failedTests} failed, ${result.clusters.length} clusters, risk=${result.risk.level}`)

  // ── Set outputs ────────────────────────────────────────────────────────────
  core.setOutput('risk-level', result.risk.level)
  core.setOutput('risk-score', result.risk.score.toFixed(2))
  core.setOutput('failed-tests', String(result.failedTests))
  core.setOutput('total-tests', String(result.totalTests))
  core.setOutput('cluster-count', String(result.clusters.length))

  const ctx = getGithubContext()

  // ── Analyze Playwright traces (standalone RCA) ─────────────────────────────
  let traceFiles: string[] = []
  if (tracePath) {
    const traceGlobber = await glob.create(tracePath)
    traceFiles = await traceGlobber.glob()
    core.info(`Found ${traceFiles.length} trace file(s)`)
  }
  const traceResults = await analyzeTraces(traceFiles)

  // ── Optional: send to QAI cloud platform ──────────────────────────────────
  if (qaiUrl && qaiApiKey) {
    for (const file of files) {
      try {
        await sendToCloud(qaiUrl, qaiApiKey, file, ctx)
        core.info(`Sent ${file} to QAI cloud platform`)
      } catch (err) {
        core.warning(`Failed to send to QAI cloud: ${String(err)}`)
      }
    }
    for (const trace of traceFiles) {
      try {
        await sendTraceToCloud(qaiUrl, qaiApiKey, trace, ctx)
        core.info(`Sent trace ${trace} to QAI cloud platform`)
      } catch (err) {
        core.warning(`Failed to send trace to QAI cloud: ${String(err)}`)
      }
    }
  }

  // ── Post PR comment ────────────────────────────────────────────────────────
  if (postComment && ctx.prNumber) {
    const cloudDashboardUrl = qaiUrl
      ? qaiUrl.replace(/^https?:\/\/ingest\./, 'https://').replace(/\/$/, '')
      : undefined
    const body = buildComment(result, traceResults, cloudDashboardUrl)
    try {
      await upsertPrComment(githubToken, ctx.owner, ctx.repo, ctx.prNumber, body)
      core.info(`Posted PR comment on PR #${ctx.prNumber}`)
    } catch (err) {
      core.warning(`Failed to post PR comment: ${String(err)}`)
    }
  } else if (postComment && !ctx.prNumber) {
    core.info('Not a PR event — skipping comment')
  }

  // ── Optionally fail the action if risk is high ────────────────────────────
  if (failOnHighRisk && result.risk.level === 'high' && result.failedTests > 0) {
    core.setFailed(`QAI: High risk — ${result.risk.reasons.join(', ')}`)
  }
}

run().catch(err => core.setFailed(String(err)))
