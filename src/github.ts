import { Octokit } from '@octokit/rest'
import { hasMarker } from './comment.js'

export interface GithubContext {
  owner: string
  repo: string
  prNumber: number | null
  sha: string
  runId: string
  branch: string
  ref: string
}

export function getGithubContext(): GithubContext {
  const repository = process.env.GITHUB_REPOSITORY ?? ''
  const [owner, repo] = repository.split('/')
  const sha = process.env.GITHUB_SHA ?? ''
  const runId = process.env.GITHUB_RUN_ID ?? ''
  const branch = process.env.GITHUB_REF_NAME ?? ''
  const ref = process.env.GITHUB_REF ?? ''

  let prNumber: number | null = null
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (eventPath) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const event = require('fs').readFileSync(eventPath, 'utf8')
      const parsed = JSON.parse(event)
      prNumber = parsed?.pull_request?.number ?? parsed?.number ?? null
    } catch {
      // not a PR event or unreadable
    }
  }

  return { owner: owner ?? '', repo: repo ?? '', prNumber, sha, runId, branch, ref }
}

export async function upsertPrComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const octokit = new Octokit({ auth: token })

  // Search existing comments for our marker — update if found, create otherwise
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  })

  const existing = comments.find(c => c.body && hasMarker(c.body))

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    })
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    })
  }
}
