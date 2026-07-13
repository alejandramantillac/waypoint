import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ParsedSession } from "../parser/types.js";
import { parseSessionFile } from "../parser/sessions.js";

export interface Decision {
  id: number;
  sessionId: string;
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  filesAffected: string[];
  createdAt: string;
}

export interface DecisionInput {
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  filesAffected: string[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS processed_sessions (
  session_id   TEXT PRIMARY KEY,
  file_path    TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('ok', 'error'))
);

CREATE TABLE IF NOT EXISTS decisions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  title          TEXT NOT NULL,
  decision       TEXT NOT NULL,
  why            TEXT NOT NULL,
  discarded      TEXT,
  files_affected TEXT NOT NULL DEFAULT '[]',
  created_at     TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES processed_sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_decisions_session_id ON decisions(session_id);
`;

function migrate(db: DatabaseSync): void {
  try {
    db.exec(`ALTER TABLE processed_sessions ADD COLUMN title TEXT`);
  } catch {
  }
  try {
    db.exec(`ALTER TABLE processed_sessions ADD COLUMN started_at TEXT`);
  } catch {
  }
  backfillSessionMetadata(db);
}

function backfillSessionMetadata(db: DatabaseSync): void {
  const rows = db
    .prepare(`SELECT session_id, file_path FROM processed_sessions WHERE started_at IS NULL`)
    .all() as { session_id: string; file_path: string }[];

  if (rows.length === 0) return;

  const update = db.prepare(`UPDATE processed_sessions SET title = ?, started_at = ? WHERE session_id = ?`);
  for (const row of rows) {
    const parsed = parseSessionFile(row.file_path);
    if (!parsed) continue;
    update.run(parsed.title, parsed.startedAt, row.session_id);
  }
}

/**
 * Each project has its own SQLite database in .waypoint/waypoint.db inside
 * the project: decisions from one project never mix with another's.
 */
export function openDatabase(cwd: string): DatabaseSync {
  const dir = join(cwd, ".waypoint");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "waypoint.db"));
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

export function getProcessedSessionIds(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(`SELECT session_id FROM processed_sessions WHERE status = 'ok'`)
    .all() as { session_id: string }[];
  return new Set(rows.map((r) => r.session_id));
}

export function markSessionProcessed(
  db: DatabaseSync,
  session: ParsedSession,
  status: "ok" | "error",
): void {
  db.prepare(
    `INSERT INTO processed_sessions (session_id, file_path, processed_at, status, title, started_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       file_path = excluded.file_path,
       processed_at = excluded.processed_at,
       status = excluded.status,
       title = excluded.title,
       started_at = excluded.started_at`,
  ).run(
    session.sessionId,
    session.filePath,
    new Date().toISOString(),
    status,
    session.title,
    session.startedAt,
  );
}

export function insertDecisions(
  db: DatabaseSync,
  sessionId: string,
  decisions: DecisionInput[],
): void {
  const insert = db.prepare(
    `INSERT INTO decisions (session_id, title, decision, why, discarded, files_affected, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  for (const d of decisions) {
    insert.run(
      sessionId,
      d.title,
      d.decision,
      d.why,
      d.discarded,
      JSON.stringify(d.filesAffected),
      now,
    );
  }
}

export function listDecisions(db: DatabaseSync): Decision[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, title, decision, why, discarded, files_affected, created_at
       FROM decisions ORDER BY created_at ASC`,
    )
    .all() as Parameters<typeof rowToDecision>[0][];
  return rows.map(rowToDecision);
}

function rowToDecision(r: {
  id: number;
  session_id: string;
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  files_affected: string;
  created_at: string;
}): Decision {
  return {
    id: r.id,
    sessionId: r.session_id,
    title: r.title,
    decision: r.decision,
    why: r.why,
    discarded: r.discarded,
    filesAffected: JSON.parse(r.files_affected),
    createdAt: r.created_at,
  };
}

export function searchDecisions(db: DatabaseSync, keyword: string): Decision[] {
  const like = `%${keyword}%`;
  const rows = db
    .prepare(
      `SELECT id, session_id, title, decision, why, discarded, files_affected, created_at
       FROM decisions
       WHERE title LIKE ? OR decision LIKE ? OR why LIKE ? OR discarded LIKE ?
       ORDER BY created_at ASC`,
    )
    .all(like, like, like, like) as Parameters<typeof rowToDecision>[0][];
  return rows.map(rowToDecision);
}

export function listTimeline(
  db: DatabaseSync,
  opts: { since?: string; until?: string } = {},
): Decision[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.since) {
    clauses.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    clauses.push("created_at <= ?");
    params.push(opts.until);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, session_id, title, decision, why, discarded, files_affected, created_at
       FROM decisions ${where} ORDER BY created_at ASC`,
    )
    .all(...params) as Parameters<typeof rowToDecision>[0][];
  return rows.map(rowToDecision);
}

export function getDecisionsByFile(db: DatabaseSync, path: string): Decision[] {
  return listDecisions(db).filter((d) =>
    d.filesAffected.some((f) => f.includes(path)),
  );
}

export interface SessionGroup {
  sessionId: string;
  sessionTitle: string | null;
  startedAt: string | null;
  decisions: Decision[];
}

export function listDecisionsGroupedBySession(db: DatabaseSync): SessionGroup[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.session_id, d.title, d.decision, d.why, d.discarded, d.files_affected, d.created_at,
              p.title AS session_title, p.started_at
       FROM decisions d
       JOIN processed_sessions p ON p.session_id = d.session_id
       ORDER BY p.started_at ASC, d.created_at ASC`,
    )
    .all() as {
    id: number;
    session_id: string;
    title: string;
    decision: string;
    why: string;
    discarded: string | null;
    files_affected: string;
    created_at: string;
    session_title: string | null;
    started_at: string | null;
  }[];

  const groups = new Map<string, SessionGroup>();
  for (const r of rows) {
    let group = groups.get(r.session_id);
    if (!group) {
      group = {
        sessionId: r.session_id,
        sessionTitle: r.session_title,
        startedAt: r.started_at,
        decisions: [],
      };
      groups.set(r.session_id, group);
    }
    group.decisions.push({
      id: r.id,
      sessionId: r.session_id,
      title: r.title,
      decision: r.decision,
      why: r.why,
      discarded: r.discarded,
      filesAffected: JSON.parse(r.files_affected),
      createdAt: r.created_at,
    });
  }
  return [...groups.values()];
}
