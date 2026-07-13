import { execFileSync } from "node:child_process";

const gitRepoCache = new Map<string, boolean>();

export function isGitRepo(cwd: string): boolean {
  const cached = gitRepoCache.get(cwd);
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
  gitRepoCache.set(cwd, result);
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
): T[] {
  if (!isGitRepo(cwd)) {
    return decisions.map((d) => ({ ...d, modifiedSinceDecision: null }));
  }

  const cache = new Map<string, boolean>();
  function fileModifiedSince(filePath: string, isoDate: string): boolean {
    const key = `${filePath}@@${isoDate}`;
    let result = cache.get(key);
    if (result === undefined) {
      result = wasModifiedSince(cwd, filePath, isoDate);
      cache.set(key, result);
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
