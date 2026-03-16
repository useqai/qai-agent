import { XMLParser } from 'fast-xml-parser'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import AdmZip from 'adm-zip'

// ─── Test Status ──────────────────────────────────────────────────────────────

export type TestStatus = 'passed' | 'failed' | 'skipped'

export interface ParsedTestCase {
  suiteName: string
  testName: string
  filePath: string | undefined
  status: TestStatus
  durationMs: number
  errorMessage: string | undefined
  errorStack: string | undefined
}

// ─── JUnit XML parser (inlined from analysis-worker/src/parsers/junit.ts) ────

interface RawFailure {
  '@_message'?: string
  '@_type'?: string
  '#text'?: string
}

interface RawTestCase {
  '@_name': string
  '@_classname'?: string
  '@_file'?: string
  '@_time'?: string | number
  failure?: RawFailure | RawFailure[]
  error?: RawFailure | RawFailure[]
  skipped?: unknown
}

interface RawTestSuite {
  '@_name': string
  testcase?: RawTestCase | RawTestCase[]
}

interface ParsedXml {
  testsuites?: { testsuite?: RawTestSuite | RawTestSuite[] }
  testsuite?: RawTestSuite | RawTestSuite[]
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['testsuite', 'testcase', 'failure', 'error'].includes(name),
  allowBooleanAttributes: true,
})

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

function extractFailure(tc: RawTestCase): { message: string; stack: string } | null {
  const raw = toArray(tc.failure)[0] ?? toArray(tc.error)[0]
  if (!raw) return null
  const message = raw['@_message'] ?? raw['#text']?.split('\n')[0] ?? 'Unknown error'
  const stack = raw['#text'] ?? message
  return { message: message.slice(0, 2000), stack: stack.slice(0, 10_000) }
}

function parseSuite(suite: RawTestSuite): ParsedTestCase[] {
  const suiteName = suite['@_name'] ?? 'unknown'
  return toArray(suite.testcase).map((tc): ParsedTestCase => {
    const failure = extractFailure(tc)
    const hasSkipped = tc.skipped !== undefined
    const hasError = toArray(tc.error).length > 0
    let status: TestStatus
    if (failure || hasError) status = 'failed'
    else if (hasSkipped) status = 'skipped'
    else status = 'passed'
    return {
      suiteName,
      testName: tc['@_name'],
      filePath: tc['@_file'] ?? tc['@_classname'] ?? undefined,
      status,
      durationMs: tc['@_time'] ? Math.round(parseFloat(String(tc['@_time'])) * 1000) : 0,
      errorMessage: failure?.message,
      errorStack: failure?.stack,
    }
  })
}

export function parseJunitXml(xml: string): ParsedTestCase[] {
  const doc = parser.parse(xml) as ParsedXml
  const suites: RawTestSuite[] = []
  if (doc.testsuites) suites.push(...toArray(doc.testsuites.testsuite))
  else if (doc.testsuite) suites.push(...toArray(doc.testsuite))
  return suites.flatMap(parseSuite)
}

// ─── Clustering (inlined from packages/clustering-engine) ────────────────────

const STRIP_PATTERNS: Array<[RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<UUID>'],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?\b/g, '<TIMESTAMP>'],
  [/\b\d{4}-\d{2}-\d{2}\b/g, '<DATE>'],
  [/\b\d+(\.\d+)?(ms|s|m|h)\b/g, '<DURATION>'],
  [/\b0x[0-9a-f]+\b/gi, '<ADDR>'],
  [/(?:\/[\w.\-]+){2,}\.[\w]+/g, '<PATH>'],
  [/[A-Za-z]:\\(?:[\w.\- ]+\\)+[\w.\- ]+/g, '<PATH>'],
  [/\/(?:home|root|Users|tmp|var|opt)\/[^\s:,)]+/g, '<PATH>'],
  [/at\s+\S+\s+\([^)]+\)/g, '<FRAME>'],
  [/at\s+\/[^\s]+/g, '<FRAME>'],
  [/\bline\s+\d+(?::\d+)?\b/gi, '<LINE>'],
  [/:\d+:\d+\b/g, '<LOC>'],
  [/(?:localhost|127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d+/g, '<HOST>'],
  [/\b[0-9a-f]{16,}\b/gi, '<ID>'],
  [/\b\d+\b/g, '<N>'],
  [/https?:\/\/[^\s)]+/g, '<URL>'],
  [/"[^"]{8,}"/g, '"<VAL>"'],
  [/'[^']{8,}'/g, "'<VAL>'"],
]

function normalizeMessage(message: string): string {
  let normalized = message.slice(0, 500)
  for (const [pattern, replacement] of STRIP_PATTERNS) {
    normalized = normalized.replace(pattern, replacement)
  }
  return normalized.trim().toLowerCase().replace(/\s+/g, ' ')
}

function buildSignatureHash(rawMessage: string): string {
  const normalized = normalizeMessage(rawMessage)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16)
}

// ─── Risk scoring (inlined from packages/risk-engine) ────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high'

export interface RiskOutput {
  score: number
  level: RiskLevel
  reasons: string[]
  mergeRecommendation: string
}

export function computeRisk(totalTests: number, failedTests: number, clusterCount: number): RiskOutput {
  const reasons: string[] = []
  let score = 0

  const failRate = totalTests > 0 ? failedTests / totalTests : 0
  if (failRate > 0.1) {
    score += 0.4
    reasons.push(`${Math.round(failRate * 100)}% of tests failed`)
  } else if (failRate > 0) {
    score += 0.2
    reasons.push(`${failedTests} test(s) failed`)
  }

  if (clusterCount > 0) {
    score += Math.min(0.2, clusterCount * 0.1)
    reasons.push(`${clusterCount} unique failure pattern(s)`)
  }

  score = Math.min(1, score)
  const level: RiskLevel = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low'
  const mergeRecommendation =
    level === 'high'
      ? 'Do not merge — investigate failures first'
      : level === 'medium'
        ? 'Review failures before merging'
        : 'Safe to merge'

  return { score, level, reasons, mergeRecommendation }
}

// ─── Cluster test cases by failure signature ──────────────────────────────────

export interface Cluster {
  hash: string
  normalizedPattern: string
  tests: ParsedTestCase[]
}

export interface AnalysisResult {
  tests: ParsedTestCase[]
  clusters: Cluster[]
  risk: RiskOutput
  totalTests: number
  failedTests: number
  passedTests: number
  skippedTests: number
}

export function analyze(tests: ParsedTestCase[]): AnalysisResult {
  const clusterMap = new Map<string, Cluster>()

  for (const test of tests) {
    if (test.status === 'failed' && test.errorMessage) {
      const hash = buildSignatureHash(test.errorMessage)
      const normalized = normalizeMessage(test.errorMessage)
      const existing = clusterMap.get(hash)
      if (existing) {
        existing.tests.push(test)
      } else {
        clusterMap.set(hash, { hash, normalizedPattern: normalized, tests: [test] })
      }
    }
  }

  const clusters = Array.from(clusterMap.values())
  const failedTests = tests.filter(t => t.status === 'failed').length
  const passedTests = tests.filter(t => t.status === 'passed').length
  const skippedTests = tests.filter(t => t.status === 'skipped').length
  const risk = computeRisk(tests.length, failedTests, clusters.length)

  return { tests, clusters, risk, totalTests: tests.length, failedTests, passedTests, skippedTests }
}

// ─── Playwright trace parser (inlined from packages/trace-parser) ─────────────

type RcaCauseStr = 'UI Changed' | 'Backend Error' | 'Timing / Flaky' | 'Environment Failure' | 'Test Bug' | 'Unknown'

export interface TraceRcaResult {
  traceFile: string
  cause: RcaCauseStr
  confidence: number
  evidence: string[]
  suggestions: string[]
}

interface TraceStep { action: string; locator?: string; timestamp: number; durationMs: number; error?: string }
interface TraceNetworkEvent { url: string; method: string; status: number; timestamp: number; durationMs: number }
interface TraceConsoleEvent { type: 'log' | 'warn' | 'error'; text: string; timestamp: number }
interface ParsedTrace { steps: TraceStep[]; networkEvents: TraceNetworkEvent[]; consoleEvents: TraceConsoleEvent[]; failedStep?: TraceStep }

async function parseTraceZip(zipBuffer: Buffer): Promise<ParsedTrace> {
  let zip: AdmZip
  try { zip = new AdmZip(zipBuffer) } catch { return { steps: [], networkEvents: [], consoleEvents: [] } }

  const steps: TraceStep[] = []
  const networkEvents: TraceNetworkEvent[] = []
  const consoleEvents: TraceConsoleEvent[] = []

  for (const entry of zip.getEntries().filter(e => e.entryName.endsWith('.trace'))) {
    for (const line of entry.getData().toString('utf-8').split('\n').filter(l => l.trim())) {
      let ev: Record<string, unknown>
      try { ev = JSON.parse(line) as Record<string, unknown> } catch { continue }

      if (ev['type'] === 'action') {
        const params = ev['params'] as Record<string, unknown> | undefined
        const error = ev['error'] as Record<string, unknown> | undefined
        const start = (ev['startTime'] ?? ev['wallTime'] ?? 0) as number
        steps.push({
          action: (ev['apiName'] ?? [ev['class'], ev['method']].filter(Boolean).join('.') ?? 'unknown') as string,
          locator: params?.['selector'] as string | undefined,
          timestamp: start,
          durationMs: (ev['duration'] ?? 0) as number,
          error: error?.['message'] as string | undefined,
        })
      } else if (ev['type'] === 'event') {
        const params = ev['params'] as Record<string, unknown> | undefined
        const msg = params?.['message'] as Record<string, unknown> | undefined
        const text = (msg?.['text'] ?? params?.['text'] ?? '') as string
        if (text) consoleEvents.push({ type: (msg?.['type'] ?? 'log') as 'log' | 'warn' | 'error', text, timestamp: (ev['time'] ?? 0) as number })
      } else if (ev['type'] === 'resource-snapshot') {
        const snap = ev['snapshot'] as Record<string, unknown> | undefined
        const req = snap?.['request'] as Record<string, unknown> | undefined
        const res = snap?.['response'] as Record<string, unknown> | undefined
        const url = (req?.['url'] ?? ev['url'] ?? '') as string
        if (url) networkEvents.push({ url, method: (req?.['method'] ?? 'GET') as string, status: (res?.['status'] ?? ev['status'] ?? 0) as number, timestamp: 0, durationMs: 0 })
      }
    }
  }

  steps.sort((a, b) => a.timestamp - b.timestamp)
  return { steps, networkEvents, consoleEvents, failedStep: steps.find(s => s.error) }
}

function runRcaDetectors(trace: ParsedTrace): { cause: RcaCauseStr; confidence: number; evidence: string[]; suggestions: string[] } {
  const selectorErrors = trace.steps.filter(s => s.error && /not found|locator resolved to|strict mode|no element|element is not visible/i.test(s.error))
  if (selectorErrors.length > 0) return { cause: 'UI Changed', confidence: 0.85, evidence: selectorErrors.map(s => `"${s.action}" failed: ${s.error}`), suggestions: ['Update the locator to use getByRole or getByText', 'Check if the element was removed or renamed in this PR'] }

  const serverErrors = trace.networkEvents.filter(e => e.status >= 500)
  if (serverErrors.length > 0) return { cause: 'Backend Error', confidence: 0.8, evidence: serverErrors.map(e => `${e.method} ${e.url} → ${e.status}`), suggestions: ['Check backend logs for the failing endpoint', 'Verify the API was not broken in this PR'] }

  const assertErrors = trace.consoleEvents.filter(e => e.type === 'error' && /assert|expect|should|must/i.test(e.text))
  if (assertErrors.length > 0) return { cause: 'Test Bug', confidence: 0.65, evidence: assertErrors.map(e => e.text), suggestions: ['Review the assertion logic — test expectation may be incorrect', 'Check if test data matches current application state'] }

  const timeouts = trace.steps.filter(s => s.error && /timeout|timed out/i.test(s.error))
  if (timeouts.length > 0) return { cause: 'Timing / Flaky', confidence: 0.7, evidence: timeouts.map(s => `"${s.action}" timed out`), suggestions: ['Add waitForResponse or waitForLoadState before the action', 'Consider increasing timeout for slow CI environments'] }

  const netFails = trace.networkEvents.filter(e => e.status === 0 || e.status >= 502)
  const envErrors = trace.consoleEvents.filter(e => e.type === 'error' && /net::err|failed to fetch|network error|econnrefused/i.test(e.text))
  if (netFails.length > 0 || envErrors.length > 0) return { cause: 'Environment Failure', confidence: 0.75, evidence: [...netFails.map(e => `Network failure: ${e.url}`), ...envErrors.map(e => e.text)], suggestions: ['Check if test environment services are running', 'Verify network connectivity between runner and application'] }

  return { cause: 'Unknown', confidence: 0, evidence: [], suggestions: ['Review the full trace for clues'] }
}

export async function analyzeTraces(tracePaths: string[]): Promise<TraceRcaResult[]> {
  const results: TraceRcaResult[] = []
  for (const tp of tracePaths) {
    const buf = readFileSync(tp)
    const trace = await parseTraceZip(buf)
    const rca = runRcaDetectors(trace)
    results.push({ traceFile: basename(tp), ...rca })
  }
  return results
}
