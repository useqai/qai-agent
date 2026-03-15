import { XMLParser } from 'fast-xml-parser'
import { createHash } from 'node:crypto'

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
