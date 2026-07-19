# Contributing to waypoint

## Development setup

```bash
git clone https://github.com/alejandramantillac/waypoint.git
cd waypoint
npm install
```

## Running things locally

```bash
npm run build   # compiles TypeScript (tsc) to dist/
npm run lint    # ESLint over src/
npm test        # runs the test suite (node:test)
npm run dev     # runs the CLI directly from source via tsx, e.g. npm run dev -- status
```

## Before opening a pull request

CI runs `npm run build`, `npm run lint`, and `npm test` on Ubuntu, Windows, and macOS for every pull request against `main`, and all three must pass before a PR can be merged. Run the same three commands locally first — it's faster to catch a failure on your machine than to wait for CI.

## Commit style

This project doesn't enforce a strict commit convention, but the existing history uses a `type: summary` style (`feat: ...`, `fix: ...`, `docs: ...`) — follow that pattern for consistency.
