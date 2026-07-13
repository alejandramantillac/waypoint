import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ParsedSession } from "../parser/types.js";
import { parseSessionFile } from "../parser/sessions.js";
import { toLocalDay } from "../util/dates.js";

export interface Decision {
  id: number;
  sessionId: string;
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  filesAffected: string[];
  evidence: string;
  createdAt: string;
  /** Not persisted: set at read time by annotateWithGitStatus, null when the project isn't a git repo. */
  modifiedSinceDecision?: boolean | null;
}

export interface DecisionInput {
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  filesAffected: string[];
  evidence: string;
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

CREATE TABLE IF NOT EXISTS parser_issues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT,
  file_path    TEXT NOT NULL,
  issue_type   TEXT NOT NULL CHECK (issue_type IN ('skipped_lines', 'unparseable_file')),
  detail       TEXT NOT NULL,
  occurred_at  TEXT NOT NULL,
  UNIQUE(file_path, issue_type)
);

CREATE TABLE IF NOT EXISTS imported_decisions (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  imported_from           TEXT NOT NULL,
  imported_at             TEXT NOT NULL,
  source_session_id       TEXT NOT NULL,
  source_session_title    TEXT,
  source_session_started_at TEXT,
  title                   TEXT NOT NULL,
  decision                TEXT NOT NULL,
  why                     TEXT NOT NULL,
  discarded               TEXT,
  evidence                TEXT NOT NULL DEFAULT '',
  files_affected          TEXT NOT NULL DEFAULT '[]',
  source_created_at       TEXT NOT NULL,
  content_hash            TEXT NOT NULL UNIQUE
);
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
  try {
    db.exec(`ALTER TABLE decisions ADD COLUMN evidence TEXT NOT NULL DEFAULT ''`);
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
    `INSERT INTO decisions (session_id, title, decision, why, discarded, files_affected, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
      d.evidence,
      now,
    );
  }
}

const DECISION_COLUMNS = "id, session_id, title, decision, why, discarded, files_affected, evidence, created_at";

export function listDecisions(db: DatabaseSync): Decision[] {
  const rows = db
    .prepare(`SELECT ${DECISION_COLUMNS} FROM decisions ORDER BY created_at ASC`)
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
  evidence: string;
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
    evidence: r.evidence,
    createdAt: r.created_at,
  };
}

export function searchDecisions(db: DatabaseSync, keyword: string): Decision[] {
  const like = `%${keyword}%`;
  const rows = db
    .prepare(
      `SELECT ${DECISION_COLUMNS}
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
    .prepare(`SELECT ${DECISION_COLUMNS} FROM decisions ${where} ORDER BY created_at ASC`)
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

export interface DayGroup {
  day: string;
  decisions: Decision[];
}

export function listDecisionsGroupedByDay(db: DatabaseSync): DayGroup[] {
  const decisions = listDecisions(db);

  const groups = new Map<string, DayGroup>();
  for (const d of decisions) {
    const day = toLocalDay(d.createdAt);
    let group = groups.get(day);
    if (!group) {
      group = { day, decisions: [] };
      groups.set(day, group);
    }
    group.decisions.push(d);
  }
  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export interface ParserIssue {
  id: number;
  sessionId: string | null;
  filePath: string;
  issueType: "skipped_lines" | "unparseable_file";
  detail: string;
  occurredAt: string;
}

export function insertParserIssue(
  db: DatabaseSync,
  issue: { sessionId: string | null; filePath: string; issueType: "skipped_lines" | "unparseable_file"; detail: string },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO parser_issues (session_id, file_path, issue_type, detail, occurred_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(issue.sessionId, issue.filePath, issue.issueType, issue.detail, new Date().toISOString());
}

export function listParserIssues(db: DatabaseSync): ParserIssue[] {
  const rows = db
    .prepare(
      `SELECT id, session_id, file_path, issue_type, detail, occurred_at
       FROM parser_issues ORDER BY occurred_at ASC`,
    )
    .all() as { id: number; session_id: string | null; file_path: string; issue_type: string; detail: string; occurred_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    filePath: r.file_path,
    issueType: r.issue_type as "skipped_lines" | "unparseable_file",
    detail: r.detail,
    occurredAt: r.occurred_at,
  }));
}

export interface ExportableDecision {
  sessionId: string;
  sessionTitle: string | null;
  sessionStartedAt: string | null;
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  evidence: string;
  filesAffected: string[];
  createdAt: string;
}

export function listDecisionsForExport(db: DatabaseSync): ExportableDecision[] {
  const rows = db
    .prepare(
      `SELECT d.session_id, p.title AS session_title, p.started_at AS session_started_at,
              d.title, d.decision, d.why, d.discarded, d.evidence, d.files_affected, d.created_at
       FROM decisions d
       JOIN processed_sessions p ON p.session_id = d.session_id
       ORDER BY d.created_at ASC`,
    )
    .all() as {
    session_id: string;
    session_title: string | null;
    session_started_at: string | null;
    title: string;
    decision: string;
    why: string;
    discarded: string | null;
    evidence: string;
    files_affected: string;
    created_at: string;
  }[];

  return rows.map((r) => ({
    sessionId: r.session_id,
    sessionTitle: r.session_title,
    sessionStartedAt: r.session_started_at,
    title: r.title,
    decision: r.decision,
    why: r.why,
    discarded: r.discarded,
    evidence: r.evidence,
    filesAffected: JSON.parse(r.files_affected),
    createdAt: r.created_at,
  }));
}

export function listDecisionsGroupedBySession(db: DatabaseSync): SessionGroup[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.session_id, d.title, d.decision, d.why, d.discarded, d.files_affected, d.evidence, d.created_at,
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
    evidence: string;
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
    group.decisions.push(rowToDecision(r));
  }
  return [...groups.values()];
}

export interface ImportedDecision {
  id: number;
  importedFrom: string;
  importedAt: string;
  sourceSessionId: string;
  sourceSessionTitle: string | null;
  sourceSessionStartedAt: string | null;
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  evidence: string;
  filesAffected: string[];
  sourceCreatedAt: string;
  modifiedSinceDecision?: boolean | null;
}

export interface ImportedDecisionInput {
  importedFrom: string;
  sourceSessionId: string;
  sourceSessionTitle: string | null;
  sourceSessionStartedAt: string | null;
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  evidence: string;
  filesAffected: string[];
  sourceCreatedAt: string;
  contentHash: string;
}

export function insertImportedDecisions(
  db: DatabaseSync,
  decisions: ImportedDecisionInput[],
): { inserted: number; skipped: number } {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO imported_decisions
       (imported_from, imported_at, source_session_id, source_session_title, source_session_started_at,
        title, decision, why, discarded, evidence, files_affected, source_created_at, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  let inserted = 0;
  for (const d of decisions) {
    const result = insert.run(
      d.importedFrom,
      now,
      d.sourceSessionId,
      d.sourceSessionTitle,
      d.sourceSessionStartedAt,
      d.title,
      d.decision,
      d.why,
      d.discarded,
      d.evidence,
      JSON.stringify(d.filesAffected),
      d.sourceCreatedAt,
      d.contentHash,
    );
    if (result.changes > 0) inserted++;
  }
  return { inserted, skipped: decisions.length - inserted };
}

function rowToImportedDecision(r: {
  id: number;
  imported_from: string;
  imported_at: string;
  source_session_id: string;
  source_session_title: string | null;
  source_session_started_at: string | null;
  title: string;
  decision: string;
  why: string;
  discarded: string | null;
  evidence: string;
  files_affected: string;
  source_created_at: string;
}): ImportedDecision {
  return {
    id: r.id,
    importedFrom: r.imported_from,
    importedAt: r.imported_at,
    sourceSessionId: r.source_session_id,
    sourceSessionTitle: r.source_session_title,
    sourceSessionStartedAt: r.source_session_started_at,
    title: r.title,
    decision: r.decision,
    why: r.why,
    discarded: r.discarded,
    evidence: r.evidence,
    filesAffected: JSON.parse(r.files_affected),
    sourceCreatedAt: r.source_created_at,
  };
}

export function listImportedDecisions(db: DatabaseSync): ImportedDecision[] {
  const rows = db
    .prepare(
      `SELECT id, imported_from, imported_at, source_session_id, source_session_title, source_session_started_at,
              title, decision, why, discarded, evidence, files_affected, source_created_at
       FROM imported_decisions ORDER BY imported_from ASC, source_created_at ASC`,
    )
    .all() as Parameters<typeof rowToImportedDecision>[0][];
  return rows.map(rowToImportedDecision);
}

export function searchImportedDecisions(db: DatabaseSync, keyword: string): ImportedDecision[] {
  const like = `%${keyword}%`;
  const rows = db
    .prepare(
      `SELECT id, imported_from, imported_at, source_session_id, source_session_title, source_session_started_at,
              title, decision, why, discarded, evidence, files_affected, source_created_at
       FROM imported_decisions
       WHERE title LIKE ? OR decision LIKE ? OR why LIKE ? OR discarded LIKE ?
       ORDER BY source_created_at ASC`,
    )
    .all(like, like, like, like) as Parameters<typeof rowToImportedDecision>[0][];
  return rows.map(rowToImportedDecision);
}

export function listImportedTimeline(
  db: DatabaseSync,
  opts: { since?: string; until?: string } = {},
): ImportedDecision[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.since) {
    clauses.push("source_created_at >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    clauses.push("source_created_at <= ?");
    params.push(opts.until);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, imported_from, imported_at, source_session_id, source_session_title, source_session_started_at,
              title, decision, why, discarded, evidence, files_affected, source_created_at
       FROM imported_decisions ${where} ORDER BY source_created_at ASC`,
    )
    .all(...params) as Parameters<typeof rowToImportedDecision>[0][];
  return rows.map(rowToImportedDecision);
}

export function getImportedDecisionsByFile(db: DatabaseSync, path: string): ImportedDecision[] {
  return listImportedDecisions(db).filter((d) =>
    d.filesAffected.some((f) => f.includes(path)),
  );
}

export interface ImportedGroup {
  importedFrom: string;
  decisions: ImportedDecision[];
}

export function listImportedDecisionsGroupedByAuthor(db: DatabaseSync): ImportedGroup[] {
  const decisions = listImportedDecisions(db);
  const groups = new Map<string, ImportedGroup>();
  for (const d of decisions) {
    let group = groups.get(d.importedFrom);
    if (!group) {
      group = { importedFrom: d.importedFrom, decisions: [] };
      groups.set(d.importedFrom, group);
    }
    group.decisions.push(d);
  }
  return [...groups.values()];
}
