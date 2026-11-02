# OwlHound Check

[![Test](https://github.com/owlhound/owlhound-check/actions/workflows/test.yml/badge.svg)](https://github.com/owlhound/owlhound-check/actions/workflows/test.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

Check websites for HTTP status, response time and certificate days left, in a GitHub Actions workflow or from the command line. A check that breaks a limit fails the job, and the results go in the job summary as a table. No account needed.

It's made by [OwlHound](https://owlhound.com/?utm_source=owlhound-check&utm_medium=referral&utm_campaign=seo-h), which checks sites from its own servers every 5 minutes (every minute with its Fast checks add-on) and sends an email when an outage is confirmed. This tool is the free, open part: the same checks, run when you choose.

## GitHub Action

```yaml
name: Site check
on:
  schedule:
    - cron: "*/30 * * * *"      # every 30 minutes
  push:
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: owlhound/owlhound-check@v1
        with:
          urls: |
            example.com
            https://example.com/pricing
          max-latency-ms: 2000
          min-ssl-days: 14
```

The job summary then shows one row per address:

| | URL | Status | Response (ms) | Certificate days left | Result |
| --- | --- | --- | --- | --- | --- |
| ✅ | https://example.com | 200 | 182 | 61 | OK |
| ❌ | https://example.com/pricing | 500 | 95 | 61 | HTTP 500 |

### Inputs

| Input | Default | What it does |
| --- | --- | --- |
| `urls` | required | Addresses to check, one per line or separated by commas. A bare domain gets `https://`. |
| `expect-status` | `200-399` | Status codes that pass, such as `200-299` or `200,301`. Redirects are followed (up to five), and the final status counts. |
| `max-latency-ms` | `0` (off) | Fail when the first response takes longer than this. |
| `min-ssl-days` | `14` | Fail when an https certificate expires in fewer days. `0` turns it off. |
| `timeout-seconds` | `10` | Give up on an address after this long. |
| `fail-job` | `true` | `false` reports failures in the summary without failing the job. |
| `owlhound-token` | empty | An [OwlHound API key](https://owlhound.com/docs/api?utm_source=owlhound-check&utm_medium=referral&utm_campaign=seo-h). The results then also appear on your monitors in OwlHound. A read-only key is enough. |

### Outputs

| Output | What it holds |
| --- | --- |
| `failed` | How many addresses failed. |
| `results` | JSON: `url`, `final_url`, `ok`, `status`, `ms`, `ssl_days` and `reason` for each address. |

### What counts as a failure

- No answer within `timeout-seconds`, a name that doesn't resolve, a refused connection or a certificate error (expired, self-signed, wrong name, incomplete chain).
- A final status outside `expect-status`.
- A first response slower than `max-latency-ms`. The time is from sending the request to receiving the response headers, measured on the first address before any redirect.
- A certificate with fewer than `min-ssl-days` days left, read from the last https address in the redirect chain.

The checks run one address at a time from the GitHub runner. The runner is one machine in one place, so a single failure may be a network problem between the two. For checks around the clock, where a failure is confirmed by a second check before anyone is alerted, use [OwlHound](https://owlhound.com/?utm_source=owlhound-check&utm_medium=referral&utm_campaign=seo-h).

## Command line

Node.js 18 or newer:

```bash
npx owlhound check example.com https://example.com/pricing --max-latency 2000
```

```
    URL                          STATUS  MS   CERT DAYS  RESULT
ok  https://example.com          200     182  61         OK
ok  https://example.com/pricing  200     95   61         OK
```

| Option | What it does |
| --- | --- |
| `--expect <codes>` | Status codes that pass (default `200-399`) |
| `--max-latency <ms>` | Fail when the first response is slower |
| `--min-ssl-days <days>` | Fail when the certificate expires sooner (default 14; 0 turns it off) |
| `--timeout <seconds>` | Give up after this long (default 10) |
| `--json` | Print JSON instead of a table |
| `--report` | Send the results to your OwlHound account, using `OWLHOUND_TOKEN` or `--token` |

Exit codes: `0` every check passed, `1` a check failed, `2` the command was wrong. That makes it usable in any CI system, cron job or deploy script:

```bash
npx owlhound check example.com || echo "site check failed"
```

## Show your status in a README

If the site is on OwlHound, its status page offers badges for a README. They link to the public status page:

```markdown
[![Status](https://owlhound.com/embed/badge/YOUR-BADGE-ID/status)](https://owlhound.com/status/YOUR-PAGE)
[![Uptime](https://owlhound.com/embed/badge/YOUR-BADGE-ID/uptime)](https://owlhound.com/status/YOUR-PAGE)
```

The badge ID and the ready-made snippet are under Status page → Badges for one site in your OwlHound account.

## Privacy

The tool sends requests only to the addresses you give it. With `owlhound-token` or `--report`, it also sends each address and its result to the OwlHound API (`https://owlhound.com/api/v1/ci-checks`), and nothing else. Requests carry the user agent `owlhound-check/<version>`.

## Licence

MIT. See [LICENSE](LICENSE). Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
