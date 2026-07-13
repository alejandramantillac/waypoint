import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ParsedSession } from "../parser/types.js";

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

/**
 * Each project has its own SQLite database in .waypoint/waypoint.db inside
 * the project: decisions from one project never mix with another's.
 */
export function openDatabase(cwd: string): DatabaseSync {
  const dir = join(cwd, ".waypoint");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "waypoint.db"));
  db.exec(SCHEMA);
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
    `INSERT INTO processed_sessions (session_id, file_path, processed_at, status)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       file_path = excluded.file_path,
       processed_at = excluded.processed_at,
       status = excluded.status`,
  ).run(session.sessionId, session.filePath, new Date().toISOString(), status);
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
    .all() as {
    id: number;
    session_id: string;
    title: string;
    decision: string;
    why: string;
    discarded: string | null;
    files_affected: string;
    created_at: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    title: r.title,
    decision: r.decision,
    why: r.why,
    discarded: r.discarded,
    filesAffected: JSON.parse(r.files_affected),
    createdAt: r.created_at,
  }));
}
