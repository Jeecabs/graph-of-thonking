import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import ripwire from "../src/index.js";

function host(root: string) {
  const tools = new Map<string, ToolDefinition>();
  let shutdown: (() => Promise<void>) | undefined;
  const ctx = { cwd: root, hasUI: false } as ExtensionContext;
  const api = {
    registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
    registerCommand: () => {},
    registerMessageRenderer: () => {},
    on: (name: string, callback: (event: unknown, ctx: ExtensionContext) => Promise<void>) => {
      if (name === "session_shutdown") shutdown = () => callback({ reason: "reload" }, ctx);
    },
  } as unknown as ExtensionAPI;
  ripwire(api);
  const diagnose = tools.get("ripwire_diagnose");
  assert.ok(diagnose);
  assert.ok(shutdown);
  return {
    run: () => diagnose.execute("same-call-id", { action: "status" }, undefined, undefined, ctx),
    shutdown,
  };
}

test("two extension sessions share a cwd but not cache, cancellation, or reload cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "graph-of-thonking-sessions-"));
  const previous = process.env.RIPWIRE_BIN;
  const binary = join(root, "ripwire");
  await writeFile(binary, `#!${process.execPath}\nsetTimeout(() => console.log(process.env.TMPDIR), 300);\n`, { mode: 0o700 });
  process.env.RIPWIRE_BIN = binary;
  const first = host(root);
  const second = host(root);
  const third = host(root);
  try {
    const cancelled = first.run();
    const rejected = assert.rejects(cancelled, /abort|cancel/i);
    const surviving = second.run();
    await first.shutdown();
    await rejected;
    const result = await surviving;
    const replacement = await third.run();
    const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    const replacementText = replacement.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    const lines = text.split("\n").filter(line => line.includes("graph-of-thonking-session-"));
    const replacementLines = replacementText.split("\n").filter(line => line.includes("graph-of-thonking-session-"));
    assert.equal(lines.length, 1);
    assert.equal(replacementLines.length, 1);
    const [cache] = lines;
    const [replacementCache] = replacementLines;
    assert.ok(cache);
    assert.ok(replacementCache);
    assert.notEqual(cache, replacementCache);
    await access(cache);
    await second.shutdown();
    await assert.rejects(access(cache));
    await access(replacementCache);
    await assert.rejects(first.run(), /shut down/);
  } finally {
    await Promise.all([first.shutdown(), second.shutdown(), third.shutdown()]);
    if (previous === undefined) delete process.env.RIPWIRE_BIN;
    else process.env.RIPWIRE_BIN = previous;
    await rm(root, { recursive: true, force: true });
  }
});
