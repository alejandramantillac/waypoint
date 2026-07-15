import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

function gitConfigValue(cwd: string, key: string): string | null {
  try {
    // First, verify we're in a git repository
    execFileSync("git", ["-C", cwd, "rev-parse", "--git-dir"], { stdio: "ignore" });
    // Now read the config value, which will use git's normal precedence (local > global > system)
    const out = execFileSync("git", ["-C", cwd, "config", key], { stdio: ["ignore", "pipe", "ignore"] });
    const value = out.toString("utf-8").trim();
    return value || null;
  } catch {
    return null;
  }
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Returns null (not a fallback string) when there's no git repo or no user.name
 * configured, so callers know to skip writing a shared file entirely rather than
 * writing one under a meaningless name.
 */
export function getAuthorSlug(cwd: string): string | null {
  const name = gitConfigValue(cwd, "user.name");
  if (!name) return null;
  const email = gitConfigValue(cwd, "user.email") ?? "";
  const hash = createHash("sha1").update(email || name).digest("hex").slice(0, 6);
  return `${slugify(name)}-${hash}`;
}
