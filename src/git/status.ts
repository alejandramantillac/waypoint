import { execFileSync } from "node:child_process";

export interface GitStatusCache {
  repo: Map<string, boolean>;
  modified: Map<string, boolean>;
}

export function createGitStatusCache(): GitStatusCache {
  return { repo: new Map(), modified: new Map() };
}

export function isGitRepo(cwd: string, cache: Map<string, boolean> = new Map()): boolean {
  const cached = cache.get(cwd);
  if (cached !== undefined) return cached;

  let result: boolean;
  try {
    execFileSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    result = true;
  } catch {
    result = false;
  }
  cache.set(cwd, result);
  return result;
}

/** Non-empty `git log` output for a path after isoDate means it changed after that date. */
export function wasModifiedSince(
  cwd: string,
  filePath: string,
  isoDate: string,
): boolean {
  try {
    const output = execFileSync(
      "git",
      ["-C", cwd, "log", `--since=${isoDate}`, "--oneline", "--", filePath],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    return output.toString("utf-8").trim().length > 0;
  } catch {
    return false;
  }
}

interface HasFilesAffected {
  filesAffected: string[];
  modifiedSinceDecision?: boolean | null;
}

export function annotateWithGitStatus<T extends HasFilesAffected>(
  cwd: string,
  decisions: T[],
  getDate: (d: T) => string = (d) =>
    (d as unknown as { createdAt: string }).createdAt,
  cache: GitStatusCache = createGitStatusCache(),
): T[] {
  if (!isGitRepo(cwd, cache.repo)) {
    return decisions.map((d) => ({ ...d, modifiedSinceDecision: null }));
  }

  function fileModifiedSince(filePath: string, isoDate: string): boolean {
    const key = `${cwd}@@${filePath}@@${isoDate}`;
    let result = cache.modified.get(key);
    if (result === undefined) {
      result = wasModifiedSince(cwd, filePath, isoDate);
      cache.modified.set(key, result);
    }
    return result;
  }

  return decisions.map((d) => ({
    ...d,
    modifiedSinceDecision: d.filesAffected.some((f) =>
      fileModifiedSince(f, getDate(d)),
    ),
  }));
}
