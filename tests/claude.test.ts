import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { formatSkill } from "../lib/catalog.ts";
import { createCatalog, handle } from "../claude/server.ts";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "claude", "server.ts");

function makeTempDir(t: { after: (fn: () => void) => void }): string {
  const directory = mkdtempSync(join(tmpdir(), "deferred-skill-catalog-claude-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function skill(dir: string, name: string, description: string, extra = ""): void {
  write(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody.\n`);
}

/**
 * A fake Claude config dir: one user skill, an enabled plugin (default `skills/`
 * plus a manifest-declared dir), a disabled plugin, a project-scoped install for
 * another project, and an extra root holding one copy and one unique skill.
 */
function fixture(t: { after: (fn: () => void) => void }) {
  const root = makeTempDir(t);
  const configDir = join(root, "claude");
  const cwd = join(root, "project");
  const plugin = (name: string) => join(configDir, "plugins", "cache", "market", name, "1.0.0");
  const extraRoot = join(root, "extra");

  skill(join(configDir, "skills"), "notes", "Take structured meeting notes.");
  skill(join(plugin("pdf-kit"), "skills"), "fill-form", "Fill a PDF form field by field.", "when_to_use: user has an AcroForm PDF\n");
  skill(join(plugin("pdf-kit"), "more"), "merge", "Merge PDF files.");
  write(join(plugin("pdf-kit"), ".claude-plugin", "plugin.json"), JSON.stringify({ name: "pdf-kit", skills: "./more" }));
  skill(join(plugin("off-kit"), "skills"), "hidden", "Should not appear.");
  skill(join(plugin("elsewhere"), "skills"), "scoped", "Installed for another project.");
  skill(extraRoot, "fill-form", "Fill a PDF form field by field. - user has an AcroForm PDF");
  skill(extraRoot, "agent-only", "Only in the extra root.");

  write(
    join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify({
      version: 2,
      plugins: {
        "pdf-kit@market": [{ scope: "user", installPath: plugin("pdf-kit") }],
        "off-kit@market": [{ scope: "user", installPath: plugin("off-kit") }],
        "elsewhere@market": [{ scope: "project", projectPath: join(root, "other"), installPath: plugin("elsewhere") }],
      },
    }),
  );
  write(
    join(configDir, "settings.json"),
    JSON.stringify({ enabledPlugins: { "pdf-kit@market": true, "off-kit@market": true, "elsewhere@market": true } }),
  );
  write(join(cwd, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "off-kit@market": false } }));
  write(join(configDir, "deferred-skill-catalog.json"), JSON.stringify({ roots: [extraRoot] }));

  return createCatalog({ CLAUDE_CONFIG_DIR: configDir }, cwd);
}

test("indexes user skills, enabled plugins as plugin:skill, and extra roots", (t) => {
  const skills = fixture(t).skills();
  assert.deepEqual(
    skills.map((entry) => entry.name),
    ["agent-only", "notes", "pdf-kit:fill-form", "pdf-kit:merge"],
  );
  const byName = new Map(skills.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("pdf-kit:fill-form")?.invokeAs, "pdf-kit:fill-form");
  assert.equal(byName.get("notes")?.invokeAs, "notes");
  assert.equal(byName.get("agent-only")?.invokeAs, undefined);
});

test("when_to_use is merged into the searchable description", (t) => {
  const fill = fixture(t).skills().find((entry) => entry.name === "pdf-kit:fill-form");
  assert.equal(fill?.description, "Fill a PDF form field by field. - user has an AcroForm PDF");
});

test("native skills load through the Skill tool; extra roots through Read", (t) => {
  const byName = new Map(fixture(t).skills().map((entry) => [entry.name, entry]));
  const native = byName.get("pdf-kit:merge");
  const extra = byName.get("agent-only");
  assert.ok(native && extra);
  assert.match(formatSkill(native, 220), /Load with the Skill tool: pdf-kit:merge$/);
  assert.match(formatSkill(extra, 220), /Read .*agent-only\/SKILL\.md before applying it\.$/);
});

test("describe reports sources and a missing budget knob", (t) => {
  const text = fixture(t).describe();
  assert.match(text, /Listing budget: not in .*settings\.json/);
  assert.match(text, /plugin pdf-kit: 2/);
  assert.doesNotMatch(text, /off-kit|elsewhere/);
});

test("handle answers initialize, tools/list, and tool calls; ignores notifications", (t) => {
  const catalog = fixture(t);
  const init = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, catalog);
  assert.match(JSON.stringify(init), /"instructions":"Skill descriptions are deferred/);
  assert.equal(handle({ jsonrpc: "2.0", method: "notifications/initialized" }, catalog), undefined);

  const list = handle({ jsonrpc: "2.0", id: 2, method: "tools/list" }, catalog) as { result: { tools: { name: string }[] } };
  assert.deepEqual(list.result.tools.map((tool) => tool.name), ["search_skills", "list_skills"]);

  const search = JSON.stringify(
    handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_skills", arguments: { query: "fill a pdf form" } } }, catalog),
  );
  assert.match(search, /pdf-kit:fill-form/);

  const bad = handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_skills", arguments: {} } }, catalog);
  assert.match(JSON.stringify(bad), /-32602/);
  assert.match(JSON.stringify(handle({ jsonrpc: "2.0", id: 5, method: "nope" }, catalog)), /-32601/);
});

test("the server speaks newline-delimited JSON-RPC over stdio", (t) => {
  const root = makeTempDir(t);
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_skills", arguments: {} } },
  ].map((message) => JSON.stringify(message)).join("\n");
  const run = spawnSync(process.execPath, [SERVER], { input: `${input}\nnot json\n`, env: { ...process.env, CLAUDE_CONFIG_DIR: root }, cwd: root, encoding: "utf8" });
  const replies = run.stdout.trim().split("\n").map((line) => JSON.parse(line) as { id: unknown; error?: { code: number } });
  assert.deepEqual(replies.map((reply) => reply.id), [1, 2, null]);
  assert.equal(replies[2]?.error?.code, -32700);
});
