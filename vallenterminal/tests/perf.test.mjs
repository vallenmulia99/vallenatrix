import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/main/perf.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2020 } });
const { formatPerf, measurePerf } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("measures CPU and RSS for app process", async () => {
  const sample = await measurePerf(10);
  assert.ok(sample.cpuPercent >= 0);
  assert.ok(sample.rssBytes > 0);
});

test("formats app-process CPU and RSS and excludes GPU/compositor claims", () => {
  assert.equal(formatPerf({ cpuPercent: 12.34, rssBytes: 1048576 }), "App process only — CPU: 12.3%; RSS: 1.0 MiB (GPU/compositor excluded)");
});
