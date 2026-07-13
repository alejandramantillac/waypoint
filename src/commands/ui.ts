import { createServer } from "node:http";
import { openDatabase, listDecisions } from "../db/database.js";
import { renderPage } from "../ui/render.js";

const DEFAULT_PORT = 4173;

export async function runUi(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const db = openDatabase(cwd);

  const server = createServer((req, res) => {
    const decisions = listDecisions(db);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderPage(decisions));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(DEFAULT_PORT, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  console.log(`waypoint ui running at http://localhost:${DEFAULT_PORT}`);
  console.log("Ctrl+C to exit.");
}
