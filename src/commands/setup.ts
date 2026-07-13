import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export async function runSetup(): Promise<void> {
  const cliPath = fileURLToPath(new URL("../cli.js", import.meta.url));

  try {
    execFileSync("claude", ["mcp", "remove", "waypoint", "--scope", "user"], { stdio: "ignore" });
  } catch {
  }

  console.log("Registering waypoint as a global MCP server (available in every project)...\n");

  try {
    execFileSync("claude", ["mcp", "add", "--scope", "user", "waypoint", "--", "node", cliPath, "mcp"], {
      stdio: "inherit",
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("\nCouldn't find the `claude` command. Is Claude Code installed and on your PATH?");
    } else {
      console.error(
        "\nSetup failed. If waypoint is already registered, run `claude mcp remove --scope user waypoint` first, then retry.",
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    "\nDone. Run `claude mcp list` to confirm, then start (or restart) a Claude Code session in any project — " +
      "waypoint's MCP tools will be available there once you've run `waypoint generate` in that project.",
  );
}
