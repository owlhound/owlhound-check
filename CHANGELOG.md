# Changelog

All notable changes to this project are listed here. Versions follow [semantic versioning](https://semver.org/).

## 1.0.0 (2026-11-02)

- First release: the GitHub Action and the `owlhound check` command.
- Checks HTTP status (following up to five redirects), the time to the first response, and certificate days left.
- Limits for status codes, response time and certificate days; a failed check fails the job, or exits 1.
- Job summary table, `failed` and `results` outputs, and error annotations.
- Optional sending of results to an OwlHound account with an API key.
