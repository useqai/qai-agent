import type { AnalysisResult, TraceRcaResult } from './parse.js'

const COMMENT_MARKER = '<!-- qai-test-intelligence -->'

const RISK_EMOJI: Record<string, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str
}

export function buildComment(result: AnalysisResult, traceResults: TraceRcaResult[] = [], cloudUrl?: string): string {
  const { totalTests, failedTests, passedTests, skippedTests, clusters, risk, tests } = result
  const failRate = totalTests > 0 ? Math.round((failedTests / totalTests) * 100) : 0
  const emoji = RISK_EMOJI[risk.level]

  const lines: string[] = [
    COMMENT_MARKER,
    '<img src="https://useqai.dev/favicon.ico" alt="QAI" width="20" height="20" align="left" style="margin-right:8px"/> **[QAI Agent](https://useqai.dev)** · Test Intelligence',
    '',
    `**${totalTests} tests** · **${failedTests} failed** (${failRate}% fail rate) · Risk: ${emoji} **${risk.level.charAt(0).toUpperCase() + risk.level.slice(1)}**`,
    '',
    `> ${risk.mergeRecommendation}`,
    '',
  ]

  if (failedTests > 0) {
    const failedList = tests.filter(t => t.status === 'failed').slice(0, 10)
    lines.push('### Failed Tests')
    lines.push('| Test | Error |')
    lines.push('|---|---|')
    for (const t of failedList) {
      const name = truncate(`${t.suiteName} > ${t.testName}`, 60)
      const err = truncate(t.errorMessage ?? 'Unknown error', 80)
      lines.push(`| \`${name}\` | ${err} |`)
    }
    if (failedTests > 10) {
      lines.push(`| *… and ${failedTests - 10} more* | |`)
    }
    lines.push('')
  }

  if (clusters.length > 0) {
    lines.push(`### Failure Clusters (${clusters.length} unique pattern${clusters.length !== 1 ? 's' : ''})`)
    lines.push('| Pattern | Occurrences |')
    lines.push('|---|---|')
    for (const c of clusters.slice(0, 8)) {
      lines.push(`| \`${truncate(c.normalizedPattern, 70)}\` | ${c.tests.length} |`)
    }
    lines.push('')
  }

  if (traceResults.length > 0) {
    lines.push('### RCA Analysis (from Playwright traces)')
    lines.push('| Trace | Cause | Confidence | Suggestion |')
    lines.push('|---|---|---|---|')
    for (const t of traceResults.slice(0, 5)) {
      const pct = Math.round(t.confidence * 100)
      const suggestion = truncate(t.suggestions[0] ?? '—', 80)
      lines.push(`| \`${t.traceFile}\` | ${t.cause} | ${pct}% | ${suggestion} |`)
    }
    lines.push('')
  }

  if (risk.reasons.length > 0) {
    lines.push('### Risk Factors')
    for (const r of risk.reasons) {
      lines.push(`- ${r}`)
    }
    lines.push('')
  }

  const stats = [`✅ ${passedTests} passed`, `❌ ${failedTests} failed`]
  if (skippedTests > 0) stats.push(`⏭️ ${skippedTests} skipped`)
  lines.push(`<sub>${stats.join(' · ')}${cloudUrl ? ` · [View in dashboard](${cloudUrl})` : ''} · Powered by QAI Platform</sub>`)

  return lines.join('\n')
}

export function hasMarker(body: string): boolean {
  return body.includes(COMMENT_MARKER)
}
