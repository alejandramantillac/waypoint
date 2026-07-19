import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FilterMode = "disabled" | "shadow" | "active";

export interface FilterConfig {
  mode: FilterMode;
  transcriptThreshold: number;
}

const VALID_MODES: FilterMode[] = ["disabled", "shadow", "active"];
const DEFAULT_CONFIG: FilterConfig = { mode: "shadow", transcriptThreshold: 500 };

function configPath(cwd: string): string {
  return join(cwd, ".waypoint", "config.json");
}

export function readFilterConfig(cwd: string): FilterConfig {
  const path = configPath(cwd);
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const filter = (raw?.filter ?? {}) as Record<string, unknown>;
    const mode: FilterMode = VALID_MODES.includes(filter.mode as FilterMode)
      ? (filter.mode as FilterMode)
      : DEFAULT_CONFIG.mode;
    const transcriptThreshold =
      typeof filter.transcriptThreshold === "number" ? filter.transcriptThreshold : DEFAULT_CONFIG.transcriptThreshold;
    return { mode, transcriptThreshold };
  } catch {
    console.error(`  ⚠ .waypoint/config.json is malformed — using defaults (filter mode: ${DEFAULT_CONFIG.mode})`);
    return { ...DEFAULT_CONFIG };
  }
}

export function writeFilterMode(cwd: string, mode: FilterMode): void {
  const dir = join(cwd, ".waypoint");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const current = readFilterConfig(cwd);
  const updated: FilterConfig = { ...current, mode };
  writeFileSync(configPath(cwd), JSON.stringify({ filter: updated }, null, 2));
}
