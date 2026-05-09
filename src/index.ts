import * as core from '@actions/core'
import * as glob from '@actions/glob'
import { readFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { parseJunitXml, analyze, analyzeTraces } from './parse.js'
import type { ParsedTestCase } from './parse.js'
import { buildComment } from './comment.js'
import { getGithubContext, upsertPrComment } from './github.js'
import { sendToCloud, sendTraceToCloud, sendReportToCloud } from './ingest.js'
import { postSlackAlert } from './slack.js'

function matchTraceToTest(tracePath: string, tests: ParsedTestCase[]): { testName: string; status: string } | undefined {
  const dirName = basename(dirname(tracePath))
  // Strip browser suffix and retry: "cart-added-item-chromium-retry1" → "cart-added-item"
  const withoutBrowser = dirName.replace(/-(?:chromium|firefox|webkit)(?:-retry\d+)?$/, '')
  const normalized = withoutBrowser.replace(/-/g, ' ').toLowerCase()

  const score = (test: ParsedTestCase): number => {
    // Strip describe prefix: "Cart › added item appears in cart" → "added item appears in cart"
    const bare = test.testName.toLowerCase().replace(/^.+[›>]\s*/, '')
    const words = bare.split(/\s+/).filter(w => w.length > 3)
    if (words.length === 0) return 0
    return words.filter(w => normalized.includes(w)).length / words.length
  }

  const scored = tests.map(t => ({ test: t, score: score(t) })).sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (best && best.score >= 0.5) return { testName: best.test.testName, status: best.test.status }
  return undefined
}

async function run(): Promise<void> {
  const junitPath = core.getInput('junit-path', { required: true })
  const githubToken = core.getInput('github-token')
  const postComment = core.getInput('post-comment') !== 'false'
  const qaiUrl = core.getInput('qai-url')
  const qaiApiKey = core.getInput('qai-api-key')
  const tracePath = core.getInput('trace-path')
  const playwrightReport = core.getInput('playwright-report')
  const failOnHighRisk = core.getInput('fail-on-high-risk') === 'true'
  const slackWebhookUrl = core.getInput('slack-webhook-url')
  const suiteName = core.getInput('suite-name') || undefined

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
  let runUrl: string | undefined
  if (qaiUrl && qaiApiKey) {
    const cloudDashboardUrl = qaiUrl.replace(/^https?:\/\/ingest\./, 'https://').replace(/\/$/, '')
    for (const file of files) {
      try {
        const cloudResult = await sendToCloud(qaiUrl, qaiApiKey, file, ctx, githubToken)
        core.info(`Sent ${file} to QAI cloud platform`)
        if (cloudResult && !runUrl) {
          runUrl = `${cloudDashboardUrl}/repos/${cloudResult.repoId}/runs/${cloudResult.runId}`
        }
      } catch (err) {
        core.warning(`Failed to send to QAI cloud: ${String(err)}`)
      }
    }
    for (const trace of traceFiles) {
      try {
        const matchedTest = matchTraceToTest(trace, result.tests)
        await sendTraceToCloud(qaiUrl, qaiApiKey, trace, ctx, matchedTest)
        core.info(`Sent trace ${trace} to QAI cloud platform${matchedTest ? ` (matched: ${matchedTest.testName} / ${matchedTest.status})` : ''}`)
      } catch (err) {
        core.warning(`Failed to send trace to QAI cloud: ${String(err)}`)
      }
    }
    if (playwrightReport) {
      try {
        await sendReportToCloud(qaiUrl, qaiApiKey, playwrightReport, ctx)
        core.info(`Sent Playwright report ${playwrightReport} to QAI cloud platform`)
      } catch (err) {
        core.warning(`Failed to send Playwright report to QAI cloud: ${String(err)}`)
      }
    }
  }

  // ── Post PR comment ────────────────────────────────────────────────────────
  if (postComment && ctx.prNumber) {
    const cloudDashboardUrl = qaiUrl
      ? qaiUrl.replace(/^https?:\/\/ingest\./, 'https://').replace(/\/$/, '')
      : undefined
    const body = buildComment(result, traceResults, cloudDashboardUrl, runUrl, suiteName)
    try {
      await upsertPrComment(githubToken, ctx.owner, ctx.repo, ctx.prNumber, body, suiteName)
      core.info(`Posted PR comment on PR #${ctx.prNumber}`)
    } catch (err) {
      core.warning(`Failed to post PR comment: ${String(err)}`)
    }
  } else if (postComment && !ctx.prNumber) {
    core.info('Not a PR event — skipping comment')
  }

  // ── Optional: Slack alert for high-risk PRs (free tier) ───────────────────
  if (slackWebhookUrl && result.risk.level === 'high' && ctx.prNumber) {
    try {
      await postSlackAlert(slackWebhookUrl, ctx, result.risk, result.failedTests)
      core.info('Posted high-risk Slack alert')
    } catch (err) {
      core.warning(`Failed to post Slack alert: ${String(err)}`)
    }
  }

  // ── Optionally fail the action if risk is high ────────────────────────────
  if (failOnHighRisk && result.risk.level === 'high' && result.failedTests > 0) {
    core.setFailed(`QAI: High risk — ${result.risk.reasons.join(', ')}`)
  }
}

run().catch(err => core.setFailed(String(err)))
