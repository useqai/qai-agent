import type { GithubContext } from './github.js'
import type { RiskOutput } from './parse.js'

/**
 * Post a basic high-risk PR alert to a Slack incoming webhook.
 * Free-tier: plain text only, no cluster trends or AI analysis.
 * For richer alerts (cluster counts, risk reasons, dashboard link), use the QAI platform.
 */
export async function postSlackAlert(
  webhookUrl: string,
  ctx: GithubContext,
  riskOutput: RiskOutput,
  failedTests: number,
): Promise<void> {
  const prUrl = `https://github.com/${ctx.owner}/${ctx.repo}/pull/${ctx.prNumber}`
  const text = [
    `🔴 High Risk PR detected`,
    `*PR #${ctx.prNumber}* in \`${ctx.owner}/${ctx.repo}\``,
    `Risk: ${riskOutput.level} (score: ${riskOutput.score.toFixed(2)})`,
    `${failedTests} test failure${failedTests !== 1 ? 's' : ''} detected`,
    `→ View PR: <${prUrl}>`,
    `→ Get cluster trends, AI RCA & PR history at useqai.dev`,
  ].join('\n')

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })

  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${res.statusText}`)
  }
}
