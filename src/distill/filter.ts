import type { ParsedSession } from "../parser/types.js";

export interface FilterVerdict {
  wouldSkip: boolean;
  reason: string;
}

export const DEFAULT_TRANSCRIPT_THRESHOLD = 500;

/**
 * Deliberately structural, not keyword-based (a prior keyword-based prefilter elsewhere in this
 * codebase, for conflict detection, was rejected as unreliable across languages/stacks). A session
 * this short with zero file edits AND zero Bash calls is extremely unlikely to contain an
 * already-implemented decision, since the distillation prompt only reports decisions that were
 * made/implemented, not just discussed.
 */
export function computeFilterVerdict(
  session: ParsedSession,
  transcriptThreshold: number = DEFAULT_TRANSCRIPT_THRESHOLD,
): FilterVerdict {
  const short = session.transcript.trim().length < transcriptThreshold;
  const noFiles = session.filesTouched.length === 0;
  const noBash = session.bashToolCallCount === 0;

  if (short && noFiles && noBash) {
    return {
      wouldSkip: true,
      reason: `transcript<${transcriptThreshold} chars, 0 files touched, 0 bash calls`,
    };
  }
  return { wouldSkip: false, reason: "did not match trivial-session heuristic" };
}
