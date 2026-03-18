# QAI Agent

**Test intelligence for every pull request.**

QAI Agent is a GitHub Action that automatically analyzes your CI test failures and posts an intelligent summary directly on your pull request — no cloud account, no setup, no configuration beyond one workflow step.

---

## What it does

Every time a pull request is updated, QAI Agent:

1. **Parses** your JUnit XML test results
2. **Clusters** failures by normalized error signature — grouping tests that failed for the same root cause
3. **Scores risk** — low / medium / high — based on fail rate and failure patterns
4. **Posts a PR comment** with a clear summary, actionable insight, and merge recommendation
5. **Analyzes Playwright traces** *(optional)* — detects root cause from `.zip` trace files: UI change, backend error, timeout flakiness, environment failure, or test bug
6. **Sends data to QAI cloud** *(optional)* — for historical trends, flakiness tracking, and LLM-powered RCA

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

Your workflow needs `pull-requests: write` permission to post comments:

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

---

## Example PR comment

![QAI Agent PR comment example](https://github.com/user-attachments/assets/e777cd87-63b0-438f-a123-79a937cffb40)

---

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `junit-path` | ✅ | — | Glob path to JUnit XML file(s). E.g. `test-results/*.xml` or `**/junit-*.xml` |
| `github-token` | ❌ | `${{ github.token }}` | Token for posting PR comments. The built-in token works for most repos. |
| `post-comment` | ❌ | `true` | Set to `false` to skip posting the PR comment |
| `trace-path` | ❌ | — | Glob to Playwright trace zip files. E.g. `test-results/**/*.zip` |
| `qai-url` | ❌ | — | QAI cloud platform ingest URL for historical intelligence |
| `qai-api-key` | ❌ | — | QAI API key (required when `qai-url` is set) |

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
```

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

## Cloud platform (optional)

Connect to the [QAI cloud platform](https://useqai.dev) to unlock:

- **Flakiness tracking** — see which tests fail intermittently across runs
- **Historical clusters** — track how long a failure pattern has existed
- **LLM-powered RCA** — Claude-generated root cause explanations with fix suggestions
- **Team dashboard** — repo-level and org-level failure intelligence
- **Slack & Jira integration** — get notified and create tickets automatically

```yaml
- name: QAI Agent
  uses: useqai/qai-agent@v1
  if: always()
  with:
    junit-path: 'test-results/results.xml'
    trace-path: 'test-results/**/*.zip'
    qai-url: https://ingest.useqai.dev
    qai-api-key: ${{ secrets.QAI_API_KEY }}
```

Get your API key at [useqai.dev](https://useqai.dev).

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
