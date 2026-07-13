# Waypoint

Waypoint reads your local Claude Code session history and distills the architecture decisions buried in it — what was decided, why, what was discarded — into a navigable log. No setup required beforehand: it runs retroactively over sessions you already have.

## Why

Conversations with a coding agent are full of real engineering decisions — "let's use X instead of Y because Z" — that get buried in chat history the moment the session ends. Waypoint mines that history after the fact and turns it into something you can actually read, search, and query later.

## What it does

- **`waypoint status`** — a free preview: how many sessions exist, how many are new, and what's already stored — before you decide whether to run `generate` (which costs a little, since it calls `claude -p`).
- **`waypoint generate`** — scans this project's Claude Code sessions and distills new ones into structured decisions (title, what was decided, why, what was discarded, files affected), stored in a local SQLite database isolated to this project.
- **`waypoint ui`** — a local web page listing those decisions, grouped by session or by day, with each decision's supporting evidence and a warning if the related code changed since the decision was made.
- **`waypoint mcp`** — a read-only [MCP](https://modelcontextprotocol.io) server so any agent (Claude Code included) can answer "why was this built this way?" on the spot, instead of guessing from the code.
- **`waypoint export` / `waypoint import`** — share distilled decisions with a collaborator on the same repo. Claude Code sessions are local to each machine, so this is how two people working on the same project can see each other's reasoning.

## Install

```bash
npm install -g waypoint-cli
waypoint setup
```

`waypoint setup` registers the MCP server once, for every project on this machine — you don't need to repeat it per repo.

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

Each project gets its own isolated `.waypoint/waypoint.db` — decisions never mix across projects.

## How it works

`waypoint generate` reads `~/.claude/projects/<encoded-project-path>/*.jsonl` (the same session history Claude Code already keeps locally), pipes each new session's transcript to `claude -p` with a JSON schema forcing structured output, and only keeps decisions the model can back with a verbatim quote from the conversation — anything it can't cite gets dropped instead of reported.

Everything runs locally: no session data leaves your machine unless you explicitly run `waypoint export`.

## Requirements

- Node.js ≥ 22.5 (uses the built-in `node:sqlite` module — no native dependencies to compile)
- [Claude Code](https://claude.com/claude-code) installed and authenticated
- `git` (optional — enables the "modified since this decision" warning; skipped silently if the project isn't a git repo)

## Platform support

Verified on Windows and Linux. Not yet tested on macOS, though nothing in the implementation is Windows/Linux-specific — the same session-directory lookup and local-only architecture should hold there too.

## License

MIT
