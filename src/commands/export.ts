import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, listDecisionsForExport } from "../db/database.js";
import { buildExportFile } from "../share/format.js";

function parseAuthorFlag(args: string[]): string {
  const idx = args.indexOf("--author");
  const value = idx === -1 ? undefined : args[idx + 1];
  if (!value) {
    throw new Error('--author is required, e.g. waypoint export --author "Jane Doe"');
  }
  return value;
}

function outputPath(args: string[]): string {
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--author");
  if (positional.length > 0) return positional[0];
  const date = new Date().toISOString().slice(0, 10);
  return join(process.cwd(), `waypoint-export-${date}.json`);
}

export async function runExport(args: string[]): Promise<void> {
  const author = parseAuthorFlag(args);
  const cwd = process.cwd();
  const db = openDatabase(cwd);
  const decisions = listDecisionsForExport(db);
  const file = buildExportFile(author, decisions);
  const path = outputPath(args);

  writeFileSync(path, JSON.stringify(file, null, 2));

  console.log(`Exported ${decisions.length} decision(s) as "${author}" to ${path}`);
  console.log(
    "Reminder: this file may contain sensitive text from your original conversations — review it before sharing.",
  );
}
