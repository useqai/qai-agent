import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// These tests exist to demo QAI Agent on pull requests.
// A mix of passing and failing tests gives the PR comment something to show.
// ---------------------------------------------------------------------------

describe('XML parser', () => {
  it('parses a minimal JUnit XML file', () => {
    const xml = `<testsuite name="suite" tests="1" failures="0"><testcase name="pass"/></testsuite>`
    expect(xml).toContain('testsuite')
    expect(xml).toContain('testcase')
  })

  it('extracts test count from attributes', () => {
    const tests = parseInt('42', 10)
    expect(tests).toBe(42)
  })

  it('handles empty testsuite', () => {
    const xml = `<testsuite tests="0" failures="0"/>`
    expect(xml).toContain('tests="0"')
  })
})

describe('failure clustering', () => {
  it('normalizes timeout messages to the same signature', () => {
    const normalize = (msg: string) =>
      msg.replace(/\d+ms/g, 'Xms').replace(/\d+s/g, 'Xs').trim()

    const a = normalize('Timeout of 5000ms exceeded waiting for selector')
    const b = normalize('Timeout of 8000ms exceeded waiting for selector')
    expect(a).toBe(b)
  })

  it('strips file paths from error messages', () => {
    const normalize = (msg: string) =>
      msg.replace(/\/[^\s:]+:\d+:\d+/g, '<loc>').trim()

    const result = normalize('AssertionError at /home/runner/work/app/src/login.ts:42:10')
    expect(result).toBe('AssertionError at <loc>')
  })

  it('groups tests with identical normalized signatures', () => {
    const signatures = ['timeout Xms', 'timeout Xms', 'element not found']
    const clusters = new Map<string, number>()
    for (const sig of signatures) {
      clusters.set(sig, (clusters.get(sig) ?? 0) + 1)
    }
    expect(clusters.get('timeout Xms')).toBe(2)
    expect(clusters.get('element not found')).toBe(1)
  })
})

describe('risk scoring', () => {
  it('returns high risk when fail rate exceeds 50%', () => {
    const score = (failed: number, total: number) => failed / total
    const level = (s: number) => s > 0.5 ? 'high' : s > 0.2 ? 'medium' : 'low'

    expect(level(score(6, 10))).toBe('high')
    expect(level(score(2, 10))).toBe('medium')
    expect(level(score(1, 10))).toBe('low')
  })

  it('handles zero total tests without dividing by zero', () => {
    const safeScore = (failed: number, total: number) =>
      total === 0 ? 0 : failed / total
    expect(safeScore(0, 0)).toBe(0)
  })

  it('caps risk score at 1.0', () => {
    const clamp = (n: number) => Math.min(1, Math.max(0, n))
    expect(clamp(1.5)).toBe(1)
    expect(clamp(-0.1)).toBe(0)
  })

  // This test is intentionally broken to demo QAI Agent failure detection
  it('detects flaky test pattern from repeated failures', () => {
    const runs = [true, false, true, false, true]
    const failRate = runs.filter(r => !r).length / runs.length
    // Intentional failure: wrong threshold to demo clustering
    expect(failRate).toBeLessThan(0.3)
  })
})

describe('PR comment formatting', () => {
  it('renders risk badge as markdown', () => {
    const badge = (level: string) => `![${level}](https://img.shields.io/badge/risk-${level}-red)`
    expect(badge('high')).toContain('risk-high')
  })

  it('truncates long error messages to 200 chars', () => {
    const truncate = (msg: string, max = 200) =>
      msg.length > max ? msg.slice(0, max) + '…' : msg
    const long = 'x'.repeat(250)
    expect(truncate(long)).toHaveLength(201)
  })

  // Intentional failure: wrong expected cluster count to demo QAI clustering
  it('groups 3 identical timeouts into 1 cluster', () => {
    const failures = [
      'Timeout exceeded waiting for #login-btn',
      'Timeout exceeded waiting for #login-btn',
      'Timeout exceeded waiting for #login-btn',
    ]
    // Bug: counting raw failures instead of clusters
    expect(failures.length).toBe(1)
  })
})
