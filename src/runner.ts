import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, open, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve } from "node:path";

export function localPath(value: string, cwd: string): string {
  const clean = value.replace(/^@/, "");
  if (/^(?:https?:\/\/|git@)/i.test(clean)) throw new Error("Use a local checkout. Remote cloning is not supported.");
  return resolve(cwd, clean === "~" ? homedir() : clean.startsWith("~/") ? join(homedir(), clean.slice(2)) : clean);
}

export async function resolveBinary(): Promise<string> {
  const configured = process.env.RIPWIRE_BIN?.trim();
  if (configured) {
    if (!isAbsolute(configured)) throw new Error("RIPWIRE_BIN must be an absolute executable path, not a shell command.");
    await access(configured, constants.X_OK);
    return configured;
  }
  const candidates = [...(process.env.PATH ?? "").split(delimiter).filter(isAbsolute).map(dir => join(dir, "ripwire")), join(homedir(), ".local/bin/ripwire")];
  for (const candidate of new Set(candidates)) {
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch { /* Try the next installed binary. */ }
  }
  throw new Error("Ripwire not found. Install the upstream binary or set RIPWIRE_BIN to its absolute path. See graph-of-thonking/README.md.");
}

export interface RunResult {
  text: string;
  code: number;
  durationMs: number;
  stdoutFile: string;
  stderrFile: string;
  truncated: boolean;
  bytes: number;
}

async function preview(path: string, maxBytes: number, maxLines: number) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const decoder = new TextDecoder();
    const text = decoder.decode(buffer.subarray(0, bytesRead), { stream: size > bytesRead });
    const lines = text.split("\n");
    return { text: lines.slice(0, maxLines).join("\n"), bytes: size, truncated: size > bytesRead || lines.length > maxLines };
  } finally { await file.close(); }
}

export async function run(binary: string, args: string[], cwd: string, signal?: AbortSignal, timeoutMs = 60_000, scratchRoot?: string): Promise<RunResult> {
  signal?.throwIfAborted();
  const directory = await mkdtemp(join(tmpdir(), "graph-of-thonking-"));
  const stdoutFile = join(directory, "stdout.txt");
  const stderrFile = join(directory, "stderr.txt");
  const stdout = await open(stdoutFile, "wx", 0o600);
  const stderr = await open(stderrFile, "wx", 0o600).catch(async error => {
    await stdout.close();
    throw error;
  });
  const started = Date.now();
  let stopped: string | undefined;
  let code: number;
  try {
    code = await new Promise<number>((accept, reject) => {
      const grouped = process.platform !== "win32";
      const child = spawn(binary, args, { cwd, shell: false, detached: grouped, env: scratchRoot ? { ...process.env, TMPDIR: scratchRoot, XDG_CACHE_HOME: scratchRoot } : process.env, stdio: ["ignore", stdout.fd, stderr.fd] });
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const kill = (kind: NodeJS.Signals) => {
        try {
          if (grouped && child.pid) process.kill(-child.pid, kind);
          else child.kill(kind);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(kind);
        }
      };
      const stop = (reason: string) => {
        if (stopped) return;
        stopped = reason;
        kill("SIGTERM");
        killTimer = setTimeout(() => kill("SIGKILL"), 1000);
        killTimer.unref();
      };
      const abort = () => stop("cancelled");
      const timer = setTimeout(() => stop(`timed out after ${timeoutMs} ms`), timeoutMs);
      const clean = () => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
      };
      child.once("error", error => { clean(); reject(error); });
      child.once("close", (exitCode, exitSignal) => {
        if (stopped) kill("SIGKILL");
        clean();
        if (exitCode === null && !stopped) stopped = `terminated by ${exitSignal ?? "unknown signal"}`;
        accept(exitCode ?? -1);
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
  } finally {
    await Promise.all([stdout.close(), stderr.close()]);
  }
  const out = await preview(stdoutFile, 40 * 1024, 1600);
  const err = await preview(stderrFile, 8 * 1024, 300);
  const truncated = out.truncated || err.truncated;
  const text = [out.text, err.text ? `[stderr]\n${err.text}` : "", truncated ? `[Output truncated. Full stdout: ${stdoutFile}\nFull stderr: ${stderrFile}]` : ""].filter(Boolean).join("\n\n");
  if (stopped) throw new Error(`Ripwire ${stopped}. Partial stdout: ${stdoutFile}\nPartial stderr: ${stderrFile}`);
  return { text, code, durationMs: Date.now() - started, stdoutFile, stderrFile, truncated, bytes: out.bytes + err.bytes };
}
