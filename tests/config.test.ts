import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  CONFIG_ENV_VAR,
  compileExclusions,
  defaultRoots,
  describeConfig,
  expandPath,
  resolveConfig,
  stripJsonComments,
} from "../lib/config.ts";

function makeTempDir(t: { after: (fn: () => void) => void }): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-deferred-skill-catalog-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writeConfig(agentDir: string, contents: string, name = "deferred-skill-catalog.json"): string {
  const path = join(agentDir, name);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path, contents);
  return path;
}

/** Assert-presence accessor, so index access stays readable under noUncheckedIndexedAccess. */
function first<T>(items: readonly T[]): T {
  const [item] = items;
  assert.ok(item !== undefined, "expected at least one item");
  return item;
}

test("falls back to portable built-in defaults when there is no config file", (t) => {
  const agentDir = makeTempDir(t);
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.deepEqual(config.roots, [join(agentDir, "skills"), join(homedir(), ".agents", "skills")]);
  assert.deepEqual(config.roots, defaultRoots(agentDir));
  assert.deepEqual(config.exclude, []);
  assert.deepEqual(config.skipDirectories, [".git", "node_modules"]);
  assert.equal(config.maxDepth, 12);
  assert.equal(config.stripStaticCatalog, true);
  assert.equal(source.path, undefined);
  assert.deepEqual(source.errors, []);
});

test("loads <agentDir>/deferred-skill-catalog.json and records its path", (t) => {
  const agentDir = makeTempDir(t);
  const path = writeConfig(agentDir, JSON.stringify({ stripStaticCatalog: false }));
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.equal(source.path, path);
  assert.equal(config.stripStaticCatalog, false);
  assert.deepEqual(source.errors, []);
});

test("accepts // comments and trailing commas so the config can document itself", (t) => {
  const agentDir = makeTempDir(t);
  writeConfig(
    agentDir,
    [
      "{",
      "  // every root is explained in place",
      '  "roots": [',
      '    "~/skills-one", // first',
      '    "~/skills-two",',
      "  ],",
      '  "maxDepth": 4,',
      "}",
    ].join("\n"),
  );
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.deepEqual(source.errors, []);
  assert.deepEqual(config.roots, [join(homedir(), "skills-one"), join(homedir(), "skills-two")]);
  assert.equal(config.maxDepth, 4);
});

test("stripJsonComments leaves comment-like text inside strings alone", () => {
  assert.equal(stripJsonComments('{"a": "http://x//y"}'), '{"a": "http://x//y"}');
  assert.equal(stripJsonComments('{"a": 1,}'), '{"a": 1}');
});

test("roots replace the defaults and support ~, $VAR, and config-relative paths", (t) => {
  const agentDir = makeTempDir(t);
  writeConfig(
    agentDir,
    JSON.stringify({
      roots: ["~/from-home", "$SKILL_ENV/extra", "${SKILL_ENV}/braced", "./relative-to-config", "/absolute/root"],
    }),
  );
  const { config } = resolveConfig({ agentDir, env: { SKILL_ENV: "/env-base" } });

  assert.deepEqual(config.roots, [
    join(homedir(), "from-home"),
    "/env-base/extra",
    "/env-base/braced",
    join(agentDir, "relative-to-config"),
    "/absolute/root",
  ]);
});

test("an unset variable is left verbatim instead of becoming an empty path", (t) => {
  const agentDir = makeTempDir(t);
  const { config } = resolveConfig({ agentDir, env: { [CONFIG_ENV_VAR]: "" } });
  assert.equal(config.roots.length, 2);
  assert.equal(expandPath("$NOT_SET/skills", "/base", {}), "/base/$NOT_SET/skills");
});

test("the env var bypasses discovery and a missing target degrades to defaults", (t) => {
  const agentDir = makeTempDir(t);
  writeConfig(agentDir, JSON.stringify({ maxDepth: 3 }));
  const { config, source } = resolveConfig({
    agentDir,
    env: { [CONFIG_ENV_VAR]: join(agentDir, "does-not-exist.json") },
  });

  assert.equal(config.maxDepth, 12, "defaults win, the sibling config is not consulted");
  assert.equal(source.path, undefined);
  assert.equal(source.errors.length, 1);
  assert.match(first(source.errors), /does not exist/);
});

test("the env var overrides the default location when it exists", (t) => {
  const agentDir = makeTempDir(t);
  const custom = writeConfig(agentDir, JSON.stringify({ maxDepth: 7 }), "custom.json");
  const { config, source } = resolveConfig({ agentDir, env: { [CONFIG_ENV_VAR]: custom } });

  assert.equal(source.path, custom);
  assert.equal(config.maxDepth, 7);
});

test("malformed JSON degrades to defaults with a recorded error", (t) => {
  const agentDir = makeTempDir(t);
  const path = writeConfig(agentDir, "{ not json");
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.equal(source.path, path);
  assert.equal(source.errors.length, 1);
  assert.match(first(source.errors), /Could not parse/);
  assert.deepEqual(config.roots, defaultRoots(agentDir));
});

test("a syntactically valid non-object config degrades to defaults", (t) => {
  const agentDir = makeTempDir(t);
  writeConfig(agentDir, "[1, 2, 3]");
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.equal(source.errors.length, 1);
  assert.match(first(source.errors), /must be a JSON object/);
  assert.equal(config.maxDepth, 12);
});

test("invalid values are reported per key without discarding the valid ones", (t) => {
  const agentDir = makeTempDir(t);
  writeConfig(
    agentDir,
    JSON.stringify({
      roots: ["/keep", 42, "", "/also-keep"],
      exclude: ["name-rule", { names: ["scoped"] }, { pathIncludes: 7 }, {}],
      skipDirectories: [".git", 5],
      maxDepth: -3,
      stripStaticCatalog: "yes",
      unknownKey: true,
    }),
  );
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.deepEqual(config.roots, ["/keep", "/also-keep"]);
  assert.deepEqual(config.exclude, ["name-rule", { names: ["scoped"] }]);
  assert.deepEqual(config.skipDirectories, [".git"]);
  assert.equal(config.maxDepth, 12);
  assert.equal(config.stripStaticCatalog, true);
  assert.equal(source.errors.length, 7);
  assert.equal(source.errors.filter((error) => error.startsWith("roots[")).length, 2);
});

test("non-array roots, exclude, and skipDirectories fall back to their defaults", (t) => {
  const agentDir = makeTempDir(t);
  writeConfig(agentDir, JSON.stringify({ roots: "/nope", exclude: "nope", skipDirectories: "nope" }));
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.deepEqual(config.roots, defaultRoots(agentDir));
  assert.deepEqual(config.exclude, []);
  assert.deepEqual(config.skipDirectories, [".git", "node_modules"]);
  assert.equal(source.errors.length, 3);
});

test("an explicitly empty roots array is honoured", (t) => {
  const agentDir = makeTempDir(t);
  writeConfig(agentDir, JSON.stringify({ roots: [] }));
  const { config, source } = resolveConfig({ agentDir, env: {} });

  assert.deepEqual(config.roots, []);
  assert.deepEqual(source.errors, []);
});

test("a bare string excludes that skill name in every root", () => {
  const isExcluded = compileExclusions(["decide"]);
  assert.equal(isExcluded("/anywhere/skills/decide/SKILL.md", "decide"), true);
  assert.equal(isExcluded("/elsewhere/decide/SKILL.md", "decide"), true);
  assert.equal(isExcluded("/anywhere/skills/other/SKILL.md", "other"), false);
});

test("an object rule scopes name matching to a path substring", () => {
  const isExcluded = compileExclusions([
    { pathIncludes: "/coreyhaines31/makerskills/skills/", names: ["decide", "ingest"] },
  ]);
  assert.equal(isExcluded("/home/u/.pi/agent/git/github.com/coreyhaines31/makerskills/skills/decide/SKILL.md", "decide"), true);
  assert.equal(isExcluded("/home/u/.pi/agent/git/github.com/other/makerskills-ish/ingest/SKILL.md", "ingest"), false);
  assert.equal(isExcluded("/home/u/.pi/agent/git/github.com/coreyhaines31/makerskills/skills/keep/SKILL.md", "keep"), false);
});

test("an object rule without names excludes everything under that path", () => {
  const isExcluded = compileExclusions([{ pathIncludes: "/vendored/skills/" }]);
  assert.equal(isExcluded("/vendored/skills/anything/SKILL.md", "anything"), true);
  assert.equal(isExcluded("/clean/skills/anything/SKILL.md", "anything"), false);
});

test("path matching is normalized across separators on both sides", () => {
  assert.equal(
    compileExclusions([{ pathIncludes: "/vendored/skills/", names: ["x"] }])("C:\\repo\\vendored\\skills\\x\\SKILL.md", "x"),
    true,
  );
  assert.equal(
    compileExclusions([{ pathIncludes: "\\vendored\\skills\\", names: ["x"] }])("C:\\repo\\vendored\\skills\\x\\SKILL.md", "x"),
    true,
  );
});

test("rule names cannot resolve to Object.prototype members", () => {
  const isExcluded = compileExclusions([]);
  for (const name of ["__proto__", "constructor", "toString", "valueOf", "hasOwnProperty"]) {
    assert.equal(isExcluded("/some/root/SKILL.md", name), false, `${name} must not match an empty rule set`);
  }

  const namespaced = compileExclusions([{ pathIncludes: "/vendored/", names: ["__proto__"] }]);
  assert.equal(namespaced("/vendored/__proto__/SKILL.md", "__proto__"), true);
  assert.equal(namespaced("/vendored/constructor/SKILL.md", "constructor"), false);
});

test("describeConfig reports the source, roots, rules, and problems", (t) => {
  const agentDir = makeTempDir(t);
  const path = writeConfig(agentDir, JSON.stringify({ roots: ["/one", "/two"], exclude: ["a", { names: ["b"] }], maxDepth: 1 }));
  const { config, source } = resolveConfig({ agentDir, env: {} });
  const text = describeConfig(config, source, 42);

  assert.match(text, new RegExp(path.replace(/[.\\/]/g, "\\$&")));
  assert.match(text, /Skills discovered: 42/);
  assert.match(text, /1\. \/one/);
  assert.match(text, /2\. \/two/);
  assert.match(text, /name "a"/);
  assert.match(text, /any path: names "b"/);
  assert.match(text, /Max depth: 1/);

  const withProblems = describeConfig(config, { errors: ["boom"] }, 0);
  assert.match(withProblems, /Problems \(1\)/);
  assert.match(withProblems, /! boom/);
});
