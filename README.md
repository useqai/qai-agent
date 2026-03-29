# QAI Agent

**Test intelligence for every pull request.**

[![Get free API key](https://img.shields.io/badge/useqai.dev-Get%20free%20API%20key-brightgreen)](https://useqai.dev)

QAI Agent is a GitHub Action that automatically analyzes your CI test failures and posts an intelligent summary directly on your pull request.

---

## Quick start

Add this step to your existing workflow, after your tests run:

```yaml
- name: QAI Agent
  uses: useqai/qai-agent@v1
  if: always()   # run even when tests fail
  with:
    junit-path: 'test-results/results.xml'
```

Your workflow needs `pull-requests: write` permission:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - name: Run tests
        run: npx playwright test --reporter=junit
      - name: QAI Agent
        uses: useqai/qai-agent@v1
        if: always()
        with:
          junit-path: 'test-results/results.xml'
```

That's it — every PR now gets a risk score, failure clusters, and a merge recommendation.

---

## Unlock historical intelligence + AI fix suggestions (2 more lines)

The Action gives you per-PR insight. Add your free API key to unlock trends, flakiness tracking, AI root cause, and on-demand **AI-generated fix suggestions** for every failing test:

```yaml
- name: QAI Agent
  uses: useqai/qai-agent@v1
  if: always()
  with:
    junit-path: 'test-results/results.xml'
    trace-path: 'test-results/**/*.zip'        # optional: Playwright traces for RCA
    playwright-report: 'test-results/report.json'  # optional: richer AI fix suggestions
    qai-url: https://ingest.useqai.dev
    qai-api-key: ${{ secrets.QAI_API_KEY }}
```

Enable the JSON reporter in your Playwright config:
```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['html'], ['json', { outputFile: 'test-results/report.json' }]],
})
```

Sign up takes 30 seconds at [useqai.dev](https://useqai.dev).

### What you unlock

| | Action only | + Dashboard |
|---|---|---|
| Per-PR risk score | ✅ | ✅ |
| Failure clusters on PR | ✅ | ✅ |
| AI root cause (from traces) | ✅ one-liner | ✅ full explanation + evidence |
| **AI fix suggestions per failed test** | 💡 link in PR comment | ✅ streamed live in dashboard |
| **Richer fixes from Playwright report** | — | ✅ exact failed step + network errors |
| Fail rate trends over time | — | ✅ chart across all runs |
| Flakiness leaderboard | — | ✅ which tests waste the most time |
| Unresolved cluster tracking | — | ✅ "first seen 3 weeks ago, 47 hits" |
| Cross-repo visibility | — | ✅ org-level stats |
| Slack & Jira integration | — | ✅ |

---

## Example PR comment

→ **[See a live PR comment on this repo](https://github.com/useqai/qai-agent/pull/9)**

![QAI Agent PR comment example](https://github.com/user-attachments/assets/983d61bc-8337-4883-ae98-93ea66e9ec64)

---

## Playwright trace analysis

When `trace-path` is provided, QAI Agent unzips and analyzes each trace file locally — no cloud required. It detects:

| Cause | Trigger |
|---|---|
| **UI Changed** | Locator not found, strict mode violation, element not visible |
| **Backend Error** | HTTP 5xx response during the test |
| **Test Bug** | Assertion/expectation errors in console logs |
| **Timing / Flaky** | Timeout errors on steps |
| **Environment Failure** | Network failures, DNS errors, connection refused |

Enable traces in your Playwright config:

```ts
// playwright.config.ts
export default defineConfig({
  use: {
    trace: 'retain-on-failure',   // only saves traces for failed tests
  },
})
```

Then add the `trace-path` input:

```yaml
- name: QAI Agent
  uses: useqai/qai-agent@v1
  if: always()
  with:
    junit-path: 'test-results/results.xml'
    trace-path: 'test-results/**/*.zip'
```

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `junit-path` | ✅ | — | Glob path to JUnit XML file(s). E.g. `test-results/*.xml` or `**/junit-*.xml` |
| `github-token` | ❌ | `${{ github.token }}` | Token for posting PR comments. The built-in token works for most repos. |
| `post-comment` | ❌ | `true` | Set to `false` to skip posting the PR comment |
| `trace-path` | ❌ | — | Glob to Playwright trace zip files. E.g. `test-results/**/*.zip` |
| `playwright-report` | ❌ | — | Path to Playwright JSON report file (`--reporter=json` output). Enriches AI fix suggestions with step-by-step execution context. Requires `qai-url` and `qai-api-key`. |
| `qai-url` | ❌ | — | QAI cloud platform ingest URL for historical intelligence |
| `qai-api-key` | ❌ | — | QAI API key (required when `qai-url` is set) |
| `fail-on-high-risk` | ❌ | `false` | Set to `true` to fail the action step when risk is high. By default the action always passes and only reports. |

## Outputs

| Output | Description |
|---|---|
| `risk-level` | `low`, `medium`, or `high` |
| `risk-score` | Numeric score from `0.00` to `1.00` |
| `failed-tests` | Number of failed tests |
| `total-tests` | Total number of tests |
| `cluster-count` | Number of unique failure patterns detected |

You can use outputs to conditionally block merges or trigger notifications:

```yaml
- name: QAI Agent
  id: qai
  uses: useqai/qai-agent@v1
  with:
    junit-path: 'test-results/results.xml'

- name: Block merge on high risk
  if: steps.qai.outputs.risk-level == 'high'
  run: echo "High risk detected — review failures before merging" && exit 1

# Or use the built-in input — simpler, no extra step needed:
- name: QAI Agent
  uses: useqai/qai-agent@v1
  with:
    junit-path: 'test-results/results.xml'
    fail-on-high-risk: 'true'
```

---

## Supported test frameworks

Any framework that outputs JUnit XML:

| Framework | Reporter flag |
|---|---|
| Playwright | `--reporter=junit` |
| Jest | `--reporters=jest-junit` |
| Vitest | `--reporter=junit` |
| pytest | `--junitxml=results.xml` |
| Maven/JUnit | built-in |
| Go (gotestsum) | `--junitfile results.xml` |

---

## Requirements

- GitHub Actions runner with Node.js 20+
- Tests must output JUnit XML format
- Workflow must have `pull-requests: write` permission

---

## License

MIT
