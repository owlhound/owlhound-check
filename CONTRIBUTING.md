# Contributing

Thanks for helping. Bug reports, fixes and small features are all welcome.

## Before you start

- **Bugs:** open an issue with the command or workflow you ran, what you expected and what happened. Leave out API keys and private addresses.
- **Features:** open an issue first, so we can agree on the shape before you write code. The tool stays small: one dependency-free package that checks addresses and reports the results.

## Working on the code

You need Node.js 22 or newer for the tests (the package itself runs on Node.js 18 and newer).

```bash
npm test
```

The tests start a local server, so they need no network access. The code has no dependencies, and we'd like to keep it that way: the Action runs straight from the repository without an install step.

- `src/check.js`: the checks, the limits and the output tables, shared by both entry points
- `src/action.js`: the GitHub Action
- `bin/owlhound.js`: the command line
- `test/`: tests and the local fixture server

## Pull requests

- One change per pull request, with a test for it.
- Add a line to the top of `CHANGELOG.md` under "Unreleased".
- Keep messages and documentation in plain words.

By contributing, you agree your work is released under the [MIT licence](LICENSE).
