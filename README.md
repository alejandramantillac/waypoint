<img src=".github/logo.svg" width="40" height="40" alt="Waypoint logo">

# Waypoint

Waypoint reads your local Claude Code session history and distills the architecture decisions buried in it: what was decided, why, and what was discarded. It runs retroactively over sessions you already have, so there's nothing to configure beforehand.

## Why

Conversations with a coding agent are full of real engineering decisions, like choosing one library over another for a specific reason, that get buried in chat history the moment the session ends. Waypoint mines that history afterward and turns it into something you can read, search, and query later.

## What it does

- **`waypoint status`**: a free preview of how many sessions exist, how many are new, and what's already stored, so you know what to expect before running `generate` (which has a small cost, since it calls `claude -p`).
- **`waypoint generate`**: scans this project's Claude Code sessions and distills the new ones into structured decisions (title, what was decided, why, what was discarded, files affected), stored in a local SQLite database isolated to this project.
- **`waypoint ui`**: a local web page listing those decisions, grouped by session or by day, with each decision's supporting evidence and a warning if the related code has changed since the decision was made.
- **`waypoint mcp`**: a read-only [MCP](https://modelcontextprotocol.io) server that lets any agent, Claude Code included, answer "why was this built this way?" on the spot instead of guessing from the code.
- **`waypoint export` / `waypoint import`**: share distilled decisions with a collaborator on the same repo. Claude Code sessions live only on the machine that created them, so this is how two people working on the same project end up seeing each other's reasoning.

## Install

```bash
npm install -g waypoint-cli
waypoint setup
```

`waypoint setup` registers the MCP server once for every project on this machine, so you don't need to repeat it per repo.

Other ways to get it:

```bash
# Try it without installing anything
npx waypoint-cli setup

# With another package manager
pnpm add -g waypoint-cli
yarn global add waypoint-cli
bun add -g waypoint-cli

# From source
git clone https://github.com/alejandramantillac/waypoint.git
cd waypoint
npm install && npm run build
npm link
```

## Usage

Run these from inside the project you want decisions for:

```bash
waypoint status                # free preview: sessions found, how many are new, no cost

waypoint generate              # distill new sessions into decisions
waypoint generate --since 2026-07-01   # only consider sessions from this date on
waypoint generate --model haiku        # use a cheaper/faster model (also accepts sonnet, opus, fable, or a full model name)

waypoint ui                    # browse decisions at http://localhost:4173

waypoint export --author "Jane Doe"    # writes waypoint-export-<date>.json
waypoint import waypoint-export-2026-07-13.json   # merge a collaborator's decisions in
```

Each project gets its own isolated `.waypoint/waypoint.db`, so decisions never mix across projects.

## How it works

`waypoint generate` reads `~/.claude/projects/<encoded-project-path>/*.jsonl`, the same session history Claude Code already keeps locally, and pipes each new session's transcript to `claude -p` with a JSON schema that forces structured output. It only keeps decisions the model can back with a verbatim quote from the conversation; anything it can't cite gets dropped instead of reported.

Everything runs locally: no session data leaves your machine unless you explicitly run `waypoint export`.

## Requirements

- Node.js ≥ 22.5 (uses the built-in `node:sqlite` module, so there are no native dependencies to compile)
- [Claude Code](https://claude.com/claude-code) installed and authenticated
- `git` (optional; enables the "modified since this decision" warning, and is skipped silently if the project isn't a git repo)

## Platform support

Verified on Windows and Linux. Not yet tested on macOS, though nothing in the implementation is specific to Windows or Linux, so the same session-directory lookup and local-only architecture should hold there too.

## License

MIT

## Author

Built by [Alejandra Mantilla](https://alejamantillac.com). [GitHub](https://github.com/alejandramantillac) · [LinkedIn](https://www.linkedin.com/in/maria-alejandra-mantilla/)
