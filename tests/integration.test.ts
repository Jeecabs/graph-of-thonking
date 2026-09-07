import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildArgs, outcome } from "../src/operations.js";
import { run } from "../src/runner.js";

async function temporary() { return mkdtemp(join(tmpdir(), "graph-of-thonking-test-")); }

test("cancelling one invocation does not stop its sibling in the same checkout", async () => {
  const root = await temporary();
  try {
    const script = join(root, "worker.cjs");
    await writeFile(script, "console.log('started'); setTimeout(() => console.log('complete'), 350);");
    const abort = new AbortController();
    const cancelled = run(process.execPath, [script], root, abort.signal);
    const survivor = run(process.execPath, [script], root);
    const timer = setTimeout(() => abort.abort(), 100);
    try {
      await assert.rejects(cancelled, /cancelled/);
      const result = await survivor;
      assert.equal(result.code, 0);
      assert.match(result.text, /complete/);
    } finally { clearTimeout(timer); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("minified output is bounded without losing the full artifact", async () => {
  const root = await temporary();
  try {
    const script = join(root, "large.cjs");
    await writeFile(script, "process.stdout.write('界'.repeat(100000)); process.stderr.write('warning\\n');");
    const result = await run(process.execPath, [script], root);
    assert.equal(result.truncated, true);
    assert.ok(Buffer.byteLength(result.text) < 50 * 1024);
    assert.ok(!result.text.includes("\ufffd"));
    assert.equal((await readFile(result.stdoutFile)).length, 300000);
    assert.match(result.text, /warning/);
    assert.match(result.text, /Output truncated/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deadline terminates a stuck process and preserves its diagnostics", async () => {
  const root = await temporary();
  try {
    const script = join(root, "stuck.cjs");
    await writeFile(script, "console.error('before timeout'); setInterval(() => {}, 1000);");
    await assert.rejects(run(process.execPath, [script], root, undefined, 100), /timed out.*Partial stdout/s);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const binary = process.env.RIPWIRE_TEST_BIN;
test("real Ripwire: parallel sessions, symbol evidence, obligations and untouched baseline", { skip: !binary }, async () => {
  assert.ok(binary);
  const root = await temporary();
  const cacheA = await temporary();
  const cacheB = await temporary();
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "test"));
    await writeFile(join(root, "src", "price.py"), "def total_price(price, count):\n    return price * count\n\ndef checkout():\n    return total_price(12, 2)\n");
    await writeFile(join(root, "test", "test_price.py"), "from src.price import total_price\n\ndef test_total_price():\n    assert total_price(2, 3) == 6\n");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=Ripwire Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
    const baseline = "stale baseline owned by another session\n";
    await writeFile(join(root, ".ripwire_quality_baseline"), baseline);
    const query = { action: "search" as const, target: "total_price", budget: 2000 };
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => run(binary, buildArgs(query, root), root, undefined, 30000, index % 2 ? cacheA : cacheB)));
    assert.equal(new Set(results.map(result => result.stdoutFile)).size, 6);
    for (const result of results) {
      assert.equal(result.code, 0, result.text);
      assert.match(result.text, /total_price/);
    }
    const expanded = await run(binary, buildArgs({ action: "expand", target: "src/price.py:total_price" }, root), root, undefined, 30000, cacheA);
    assert.equal(expanded.code, 0, expanded.text);
    assert.match(expanded.text, /return price \* count/);
    const callers = await run(binary, buildArgs({ action: "callers", target: "total_price" }, root), root, undefined, 30000, cacheB);
    assert.equal(callers.code, 0, callers.text);
    assert.match(callers.text, /checkout/);
    assert.match(callers.text, /counts_floor/);
    const tests = await run(binary, buildArgs({ action: "tests", target: "src/price.py" }, root), root, undefined, 30000, cacheA);
    assert.equal(outcome("tests", tests.code), "obligations", tests.text);
    assert.match(tests.text, /test_price/);
    const delta = await run(binary, buildArgs({ action: "delta", target: "HEAD..HEAD" }, root), root, undefined, 30000, cacheB);
    assert.equal(delta.code, 0, delta.text);
    assert.equal(await readFile(join(root, ".ripwire_quality_baseline"), "utf8"), baseline);
    assert.throws(() => buildArgs({ action: "delta" }, root), /requires target/);
  } finally {
    await Promise.all([root, cacheA, cacheB].map(path => rm(path, { recursive: true, force: true })));
  }
});
