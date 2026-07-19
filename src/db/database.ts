import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ParsedSession } from "../parser/types.js";
import { parseSessionFile } from "../parser/sessions.js";
import { toLocalDay, isParseableDate } from "../util/dates.js";

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
  /** Optional (not required) so object literals written before this task — e.g. in
   * src/db/database.test.ts from Task 3 — keep type-checking without being revisited. */
  supersedesCandidateId?: number | null;
}

export interface ReadOptions {
  includeSuperseded?: boolean;
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

CREATE TABLE IF NOT EXISTS decision_relations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('supersedes', 'conflict')),
  a_source      TEXT NOT NULL CHECK (a_source IN ('local', 'imported')),
  a_id          INTEGER NOT NULL,
  b_source      TEXT NOT NULL CHECK (b_source IN ('local', 'imported')),
  b_id          INTEGER NOT NULL,
  resolved_at   TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_decision_relations_b ON decision_relations(b_source, b_id);

CREATE TABLE IF NOT EXISTS filter_audit (
  session_id             TEXT PRIMARY KEY,
  computed_at             TEXT NOT NULL,
  would_skip              INTEGER NOT NULL,
  reason                  TEXT NOT NULL,
  transcript_length       INTEGER NOT NULL,
  files_touched_count     INTEGER NOT NULL,
  bash_tool_call_count    INTEGER NOT NULL,
  turn_count              INTEGER NOT NULL,
  actual_decisions_found  INTEGER,
  false_negative          INTEGER,
  decisions_evidence      TEXT
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
): number[] {
  const insert = db.prepare(
    `INSERT INTO decisions (session_id, title, decision, why, discarded, files_affected, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = new Date().toISOString();
  const ids: number[] = [];
  for (const d of decisions) {
    const result = insert.run(
      sessionId,
      d.title,
      d.decision,
      d.why,
      d.discarded,
      JSON.stringify(d.filesAffected),
      d.evidence,
      now,
    );
    ids.push(Number(result.lastInsertRowid));
  }
  return ids;
}

const DECISION_COLUMNS = "id, session_id, title, decision, why, discarded, files_affected, evidence, created_at";

function excludeSuperseded<T extends { id: number }>(
  db: DatabaseSync,
  source: DecisionSource,
  rows: T[],
  opts: ReadOptions,
): T[] {
  if (opts.includeSuperseded) return rows;
  const superseded = getSupersededKeys(db);
  return rows.filter((r) => !superseded.has(`${source}:${r.id}`));
}

export function listDecisions(db: DatabaseSync, opts: ReadOptions = {}): Decision[] {
  const rows = db
    .prepare(`SELECT ${DECISION_COLUMNS} FROM decisions ORDER BY created_at ASC`)
    .all() as Parameters<typeof rowToDecision>[0][];
  return excludeSuperseded(db, "local", rows.map(rowToDecision), opts);
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

export function searchDecisions(db: DatabaseSync, keyword: string, opts: ReadOptions = {}): Decision[] {
  const like = `%${keyword}%`;
  const rows = db
    .prepare(
      `SELECT ${DECISION_COLUMNS}
       FROM decisions
       WHERE title LIKE ? OR decision LIKE ? OR why LIKE ? OR discarded LIKE ?
       ORDER BY created_at ASC`,
    )
    .all(like, like, like, like) as Parameters<typeof rowToDecision>[0][];
  return excludeSuperseded(db, "local", rows.map(rowToDecision), opts);
}

export function listTimeline(
  db: DatabaseSync,
  opts: { since?: string; until?: string; includeSuperseded?: boolean } = {},
): Decision[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.since && isParseableDate(opts.since)) {
    clauses.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts.until && isParseableDate(opts.until)) {
    clauses.push("created_at <= ?");
    params.push(opts.until);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT ${DECISION_COLUMNS} FROM decisions ${where} ORDER BY created_at ASC`)
    .all(...params) as Parameters<typeof rowToDecision>[0][];
  return excludeSuperseded(db, "local", rows.map(rowToDecision), opts);
}

export function getDecisionsByFile(db: DatabaseSync, path: string, opts: ReadOptions = {}): Decision[] {
  return listDecisions(db, opts).filter((d) =>
    d.filesAffected.some((f) => f.includes(path)),
  );
}

export function getSupersessionCandidates(
  db: DatabaseSync,
  filesTouched: string[],
): { id: number; title: string; decision: string; filesAffected: string[] }[] {
  if (filesTouched.length === 0) return [];
  const candidates = listDecisions(db)
    .filter((d) => d.filesAffected.some((f) => filesTouched.includes(f)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
  return candidates.map((d) => ({ id: d.id, title: d.title, decision: d.decision, filesAffected: d.filesAffected }));
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

export function listImportedDecisions(db: DatabaseSync, opts: ReadOptions = {}): ImportedDecision[] {
  const rows = db
    .prepare(
      `SELECT id, imported_from, imported_at, source_session_id, source_session_title, source_session_started_at,
              title, decision, why, discarded, evidence, files_affected, source_created_at
       FROM imported_decisions ORDER BY imported_from ASC, source_created_at ASC`,
    )
    .all() as Parameters<typeof rowToImportedDecision>[0][];
  return excludeSuperseded(db, "imported", rows.map(rowToImportedDecision), opts);
}

export function searchImportedDecisions(db: DatabaseSync, keyword: string, opts: ReadOptions = {}): ImportedDecision[] {
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
  return excludeSuperseded(db, "imported", rows.map(rowToImportedDecision), opts);
}

export function listImportedTimeline(
  db: DatabaseSync,
  opts: { since?: string; until?: string; includeSuperseded?: boolean } = {},
): ImportedDecision[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.since && isParseableDate(opts.since)) {
    clauses.push("source_created_at >= ?");
    params.push(opts.since);
  }
  if (opts.until && isParseableDate(opts.until)) {
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
  return excludeSuperseded(db, "imported", rows.map(rowToImportedDecision), opts);
}

export function getImportedDecisionsByFile(db: DatabaseSync, path: string, opts: ReadOptions = {}): ImportedDecision[] {
  return listImportedDecisions(db, opts).filter((d) =>
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

export type DecisionSource = "local" | "imported";

export interface DecisionRef {
  source: DecisionSource;
  id: number;
}

export interface ConflictRelation {
  id: number;
  a: DecisionRef;
  b: DecisionRef;
  createdAt: string;
}

function refKey(ref: DecisionRef): string {
  return `${ref.source}:${ref.id}`;
}

export function addSupersession(db: DatabaseSync, winner: DecisionRef, loser: DecisionRef): void {
  db.prepare(
    `INSERT INTO decision_relations (relation_type, a_source, a_id, b_source, b_id, created_at)
     VALUES ('supersedes', ?, ?, ?, ?, ?)`,
  ).run(winner.source, winner.id, loser.source, loser.id, new Date().toISOString());
}

export function addConflict(db: DatabaseSync, a: DecisionRef, b: DecisionRef): void {
  db.prepare(
    `INSERT INTO decision_relations (relation_type, a_source, a_id, b_source, b_id, created_at)
     VALUES ('conflict', ?, ?, ?, ?, ?)`,
  ).run(a.source, a.id, b.source, b.id, new Date().toISOString());
}

export function resolveConflict(db: DatabaseSync, winner: DecisionRef, loser: DecisionRef): void {
  const rows = db
    .prepare(
      `SELECT id FROM decision_relations
       WHERE relation_type = 'conflict' AND resolved_at IS NULL
         AND ((a_source = ? AND a_id = ? AND b_source = ? AND b_id = ?)
           OR (a_source = ? AND a_id = ? AND b_source = ? AND b_id = ?))`,
    )
    .all(winner.source, winner.id, loser.source, loser.id, loser.source, loser.id, winner.source, winner.id) as {
    id: number;
  }[];
  const now = new Date().toISOString();
  for (const row of rows) {
    db.prepare(`UPDATE decision_relations SET resolved_at = ? WHERE id = ?`).run(now, row.id);
  }
  addSupersession(db, winner, loser);
}

export function undoRelation(db: DatabaseSync, relationId: number): void {
  const row = db
    .prepare(`SELECT relation_type, a_source, a_id, b_source, b_id FROM decision_relations WHERE id = ?`)
    .get(relationId) as
    | { relation_type: string; a_source: DecisionSource; a_id: number; b_source: DecisionSource; b_id: number }
    | undefined;
  if (!row) return;

  db.prepare(`DELETE FROM decision_relations WHERE id = ?`).run(relationId);

  if (row.relation_type === "supersedes") {
    // If this supersession came from resolving a conflict, revert that conflict to unresolved
    // instead of leaving both decisions with no relation at all.
    db.prepare(
      `UPDATE decision_relations SET resolved_at = NULL
       WHERE relation_type = 'conflict' AND resolved_at IS NOT NULL
         AND ((a_source = ? AND a_id = ? AND b_source = ? AND b_id = ?)
           OR (a_source = ? AND a_id = ? AND b_source = ? AND b_id = ?))`,
    ).run(row.a_source, row.a_id, row.b_source, row.b_id, row.b_source, row.b_id, row.a_source, row.a_id);
  }
}

export function getSupersededKeys(db: DatabaseSync): Set<string> {
  const rows = db
    .prepare(`SELECT b_source, b_id FROM decision_relations WHERE relation_type = 'supersedes'`)
    .all() as { b_source: DecisionSource; b_id: number }[];
  return new Set(rows.map((r) => refKey({ source: r.b_source, id: r.b_id })));
}

export function listUnresolvedConflicts(db: DatabaseSync): ConflictRelation[] {
  const rows = db
    .prepare(
      `SELECT id, a_source, a_id, b_source, b_id, created_at
       FROM decision_relations
       WHERE relation_type = 'conflict' AND resolved_at IS NULL
       ORDER BY created_at ASC`,
    )
    .all() as { id: number; a_source: DecisionSource; a_id: number; b_source: DecisionSource; b_id: number; created_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    a: { source: r.a_source, id: r.a_id },
    b: { source: r.b_source, id: r.b_id },
    createdAt: r.created_at,
  }));
}

export interface ResolvedConflict {
  /** id of the 'supersedes' relation created by resolveConflict — pass this to undoRelation. */
  relationId: number;
  winner: DecisionRef;
  loser: DecisionRef;
  resolvedAt: string;
}

export function listResolvedConflicts(db: DatabaseSync): ResolvedConflict[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.a_source, s.a_id, s.b_source, s.b_id, c.resolved_at
       FROM decision_relations s
       JOIN decision_relations c
         ON c.relation_type = 'conflict' AND c.resolved_at IS NOT NULL
        AND ((c.a_source = s.a_source AND c.a_id = s.a_id AND c.b_source = s.b_source AND c.b_id = s.b_id)
          OR (c.a_source = s.b_source AND c.a_id = s.b_id AND c.b_source = s.a_source AND c.b_id = s.a_id))
       WHERE s.relation_type = 'supersedes'
       ORDER BY c.resolved_at DESC`,
    )
    .all() as { id: number; a_source: DecisionSource; a_id: number; b_source: DecisionSource; b_id: number; resolved_at: string }[];
  return rows.map((r) => ({
    relationId: r.id,
    winner: { source: r.a_source, id: r.a_id },
    loser: { source: r.b_source, id: r.b_id },
    resolvedAt: r.resolved_at,
  }));
}

export interface FilterAuditInput {
  sessionId: string;
  wouldSkip: boolean;
  reason: string;
  transcriptLength: number;
  filesTouchedCount: number;
  bashToolCallCount: number;
  turnCount: number;
  /** null when the session was skipped in active mode — no LLM call means no ground truth. */
  actualDecisionsFound: number | null;
  decisionsEvidence?: { title: string; evidence: string }[];
}

export function recordFilterAudit(db: DatabaseSync, input: FilterAuditInput): void {
  const falseNegative =
    input.actualDecisionsFound === null ? null : input.wouldSkip && input.actualDecisionsFound > 0 ? 1 : 0;

  db.prepare(
    `INSERT INTO filter_audit
       (session_id, computed_at, would_skip, reason, transcript_length, files_touched_count,
        bash_tool_call_count, turn_count, actual_decisions_found, false_negative, decisions_evidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET
       computed_at = excluded.computed_at,
       would_skip = excluded.would_skip,
       reason = excluded.reason,
       transcript_length = excluded.transcript_length,
       files_touched_count = excluded.files_touched_count,
       bash_tool_call_count = excluded.bash_tool_call_count,
       turn_count = excluded.turn_count,
       actual_decisions_found = excluded.actual_decisions_found,
       false_negative = excluded.false_negative,
       decisions_evidence = excluded.decisions_evidence`,
  ).run(
    input.sessionId,
    new Date().toISOString(),
    input.wouldSkip ? 1 : 0,
    input.reason,
    input.transcriptLength,
    input.filesTouchedCount,
    input.bashToolCallCount,
    input.turnCount,
    input.actualDecisionsFound,
    falseNegative,
    input.decisionsEvidence ? JSON.stringify(input.decisionsEvidence) : null,
  );
}

export interface FilterAuditSummary {
  evaluated: number;
  wouldSkipCount: number;
  falseNegativeCount: number;
  /** would_skip sessions with no ground truth (skipped for real in active mode) — can't confirm these weren't false negatives. */
  unknownCount: number;
}

export function getFilterAuditSummary(db: DatabaseSync): FilterAuditSummary {
  const rows = db
    .prepare(`SELECT would_skip, false_negative, actual_decisions_found FROM filter_audit`)
    .all() as { would_skip: number; false_negative: number | null; actual_decisions_found: number | null }[];

  let wouldSkipCount = 0;
  let falseNegativeCount = 0;
  let unknownCount = 0;
  for (const r of rows) {
    if (!r.would_skip) continue;
    wouldSkipCount++;
    if (r.actual_decisions_found === null) unknownCount++;
    else if (r.false_negative) falseNegativeCount++;
  }
  return { evaluated: rows.length, wouldSkipCount, falseNegativeCount, unknownCount };
}
