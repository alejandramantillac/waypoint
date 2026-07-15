import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExportableDecision } from "../db/database.js";
import { buildExportFile, parseExportFile, type ExportFile } from "./format.js";

function sharedDir(cwd: string): string {
  return join(cwd, ".waypoint", "shared");
}

function sharedFilePath(cwd: string, slug: string): string {
  return join(sharedDir(cwd), `${slug}.json`);
}

export function readSharedFile(path: string): ExportFile {
  return parseExportFile(readFileSync(path, "utf-8"));
}

/**
 * Append-only by design (spec section 3.1): rewrites the file with the previous
 * decisions plus the new ones, rather than replacing it wholesale with a fresh
 * export, so the file only ever grows and git diffs stay proportional to what's new.
 */
export function appendToSharedFile(cwd: string, authorSlug: string, newDecisions: ExportableDecision[]): void {
  const dir = sharedDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const path = sharedFilePath(cwd, authorSlug);
  const existing = existsSync(path) ? readSharedFile(path).decisions : [];
  const file = buildExportFile(authorSlug, [...existing, ...newDecisions]);
  writeFileSync(path, JSON.stringify(file, null, 2));
}

export function listOtherAuthorSharedFiles(cwd: string, ownSlug: string | null): { slug: string; path: string }[] {
  const dir = sharedDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length))
    .filter((slug) => slug !== ownSlug)
    .map((slug) => ({ slug, path: sharedFilePath(cwd, slug) }));
}
