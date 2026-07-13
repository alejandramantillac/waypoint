export interface ParsedSession {
  sessionId: string;
  filePath: string;
  startedAt: string | null;
  endedAt: string | null;
  title: string | null;
  transcript: string;
  filesTouched: string[];
  skippedLines: number;
}
