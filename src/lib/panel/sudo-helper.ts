// Runs one of the privileged schela helpers (schela-workers, schela-db) through
// `sudo -n`: the request goes in as JSON on stdin, the helper answers with one
// JSON object whose `ok` is true or which carries an `error`.

export async function runSudoHelper(
  helper: string,
  req: Record<string, unknown>,
  { timeoutMs = 20_000, label = "Command" }: { timeoutMs?: number; label?: string } = {},
): Promise<Record<string, unknown>> {
  const { spawn } = await import("node:child_process");
  const name = helper.split("/").pop() ?? helper;
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", ["-n", helper], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(out) as Record<string, unknown>;
      } catch {
        reject(new Error(err.trim() || `${name} exited ${code}`));
        return;
      }
      if (parsed.ok !== true) {
        reject(new Error(String(parsed.error || `${label} failed`)));
        return;
      }
      resolve(parsed);
    });
    child.stdin.end(JSON.stringify(req));
  });
}
