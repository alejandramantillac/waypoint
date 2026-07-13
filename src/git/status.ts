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

const modifiedSinceCache = new Map<string, boolean>();

export function annotateWithGitStatus<T extends HasFilesAffected>(
  cwd: string,
  decisions: T[],
  getDate: (d: T) => string = (d) =>
    (d as unknown as { createdAt: string }).createdAt,
): T[] {
  if (!isGitRepo(cwd)) {
    return decisions.map((d) => ({ ...d, modifiedSinceDecision: null }));
  }

  function fileModifiedSince(filePath: string, isoDate: string): boolean {
    const key = `${cwd}@@${filePath}@@${isoDate}`;
    let result = modifiedSinceCache.get(key);
    if (result === undefined) {
      result = wasModifiedSince(cwd, filePath, isoDate);
      modifiedSinceCache.set(key, result);
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
