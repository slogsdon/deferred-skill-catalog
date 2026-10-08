import { strict as assert } from "node:assert";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FRONTMATTER_HEAD_BYTES,
  SKILL_CATALOG_END,
  SKILL_CATALOG_START,
  type Skill,
  discoverSkills,
  expandSkillCommand,
  formatSkill,
  frontmatterBlock,
  frontmatterValue,
  hasStaticSkillCatalog,
  isGenericInventoryQuery,
  readFrontmatterHead,
  score,
  selectCatalogPage,
  stripFrontmatter,
  tokenize,
  truncateDescription,
  withoutStaticSkillCatalog,
} from "../lib/catalog.ts";
import { type CatalogConfig, type ExcludeRule, defaultConfig } from "../lib/config.ts";

function makeTempDir(t: { after: (fn: () => void) => void }): string {
  const directory = mkdtempSync(join(tmpdir(), "pi-deferred-skill-catalog-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function configWith(roots: string[], overrides: Partial<CatalogConfig> = {}): CatalogConfig {
  return { ...defaultConfig("/nonexistent-agent-dir"), roots, ...overrides };
}

/** Write `<directory>/<folder>/SKILL.md` and return the file path. */
function writeSkill(directory: string, folder: string, contents: string): string {
  const skillDir = join(directory, folder);
  mkdirSync(skillDir, { recursive: true });
  const file = join(skillDir, "SKILL.md");
  writeFileSync(file, contents);
  return file;
}

function skillFile(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nBody text.\n`;
}

function syntheticSkill(name: string): Skill {
  return { name, description: `${name} description`, filePath: `/synthetic/${name}/SKILL.md`, baseDir: `/synthetic/${name}` };
}

/** Assert-presence accessors, so index access stays readable under noUncheckedIndexedAccess. */
function first<T>(items: readonly T[]): T {
  const [item] = items;
  assert.ok(item !== undefined, "expected at least one item");
  return item;
}

function onlySkill(skills: Skill[]): Skill {
  assert.equal(skills.length, 1, "expected exactly one discovered skill");
  return first(skills);
}

test("discovers skills from a root and sorts them by name", (t) => {
  const directory = makeTempDir(t);
  writeSkill(directory, "beta", skillFile("beta", "Beta skill."));
  writeSkill(directory, "alpha", skillFile("alpha", "Alpha skill."));
  writeSkill(join(directory, "grouped"), "gamma", skillFile("gamma", "Gamma skill."));

  const skills = discoverSkills(configWith([directory]));
  assert.deepEqual(skills.map((skill) => skill.name), ["alpha", "beta", "gamma"]);
  assert.equal(first(skills).description, "Alpha skill.");
  assert.equal(first(skills).baseDir, join(directory, "alpha"));
});

test("only files named exactly SKILL.md are treated as skills", (t) => {
  const directory = makeTempDir(t);
  writeSkill(directory, "real", skillFile("real", "Real."));
  const folder = join(directory, "not-real");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "skill.md"), skillFile("lowercase", "Lowercase."));
  writeFileSync(join(folder, "README.md"), "# not a skill\n");

  assert.deepEqual(discoverSkills(configWith([directory])).map((skill) => skill.name), ["real"]);
});

test("the first root wins when two roots define the same skill name", (t) => {
  const directory = makeTempDir(t);
  const firstRoot = join(directory, "first");
  const secondRoot = join(directory, "second");
  const winner = writeSkill(firstRoot, "duplicate", skillFile("duplicate", "From the first root."));
  writeSkill(secondRoot, "duplicate", skillFile("duplicate", "From the second root."));

  const skills = discoverSkills(configWith([firstRoot, secondRoot]));
  assert.equal(skills.length, 1);
  assert.equal(first(skills).filePath, winner);
  assert.equal(first(skills).description, "From the first root.");

  const reversed = discoverSkills(configWith([secondRoot, firstRoot]));
  assert.equal(first(reversed).description, "From the second root.");
});

test("skips .git and node_modules directories by default", (t) => {
  const directory = makeTempDir(t);
  writeSkill(join(directory, ".git"), "from-git", skillFile("from-git", "Git."));
  writeSkill(join(directory, "node_modules"), "from-modules", skillFile("from-modules", "Modules."));
  writeSkill(directory, "kept", skillFile("kept", "Kept."));

  assert.deepEqual(discoverSkills(configWith([directory])).map((skill) => skill.name), ["kept"]);
});

test("skipDirectories is configurable and replaces the default", (t) => {
  const directory = makeTempDir(t);
  writeSkill(join(directory, "node_modules"), "from-modules", skillFile("from-modules", "Modules."));
  writeSkill(join(directory, "scratch"), "from-scratch", skillFile("from-scratch", "Scratch."));

  const skills = discoverSkills(configWith([directory], { skipDirectories: ["scratch"] }));
  assert.deepEqual(skills.map((skill) => skill.name), ["from-modules"]);
});

test("maxDepth bounds how far the walk descends", (t) => {
  const directory = makeTempDir(t);
  writeSkill(directory, ".", skillFile("at-root", "Root."));
  writeSkill(directory, "one", skillFile("at-one", "One."));
  writeSkill(join(directory, "one"), "two", skillFile("at-two", "Two."));

  assert.deepEqual(discoverSkills(configWith([directory], { maxDepth: 0 })).map((skill) => skill.name), ["at-root"]);
  assert.deepEqual(discoverSkills(configWith([directory], { maxDepth: 1 })).map((skill) => skill.name), ["at-one", "at-root"]);
  assert.deepEqual(
    discoverSkills(configWith([directory], { maxDepth: 2 })).map((skill) => skill.name),
    ["at-one", "at-root", "at-two"],
  );
});

test("symlinked directories are not followed", (t) => {
  const directory = makeTempDir(t);
  const real = join(directory, "real");
  writeSkill(real, "linked", skillFile("linked", "Linked."));

  const linkRoot = join(directory, "link-root");
  mkdirSync(linkRoot, { recursive: true });
  symlinkSync(real, join(linkRoot, "linked"), "dir");

  assert.deepEqual(discoverSkills(configWith([linkRoot])), []);
});

test("missing and unreadable roots degrade instead of throwing", (t) => {
  const directory = makeTempDir(t);
  const blocked = join(directory, "blocked");
  writeSkill(blocked, "hidden", skillFile("hidden", "Hidden."));
  chmodSync(blocked, 0o000);

  try {
    assert.doesNotThrow(() => discoverSkills(configWith([join(directory, "does-not-exist")])));
    assert.deepEqual(discoverSkills(configWith([join(directory, "does-not-exist")])), []);
    assert.deepEqual(
      discoverSkills(configWith([directory], { maxDepth: 1 })).map((skill) => skill.name),
      [],
      "an unreadable directory yields nothing",
    );
  } finally {
    chmodSync(blocked, 0o755);
  }
});

test("reads plain, quoted, | and > frontmatter scalars", (t) => {
  const directory = makeTempDir(t);
  writeSkill(
    directory,
    "quoted",
    '---\nname: "quoted-skill"\ndescription: \'Single quoted description.\'\n---\n\nBody\n',
  );
  writeSkill(
    directory,
    "block",
    "---\nname: block-skill\ndescription: |\n  First line.\n  Second line.\n---\n\nBody\n",
  );
  writeSkill(
    directory,
    "folded",
    "---\nname: folded-skill\ndescription: >\n  Folded first.\n  Folded second.\n---\n\nBody\n",
  );

  const skills = discoverSkills(configWith([directory]));
  const byName = new Map(skills.map((skill) => [skill.name, skill.description]));
  assert.equal(byName.get("quoted-skill"), "Single quoted description.");
  assert.equal(byName.get("block-skill"), "First line. Second line.");
  assert.equal(byName.get("folded-skill"), "Folded first. Folded second.");
});

test("falls back to the directory name and a default description", (t) => {
  const directory = makeTempDir(t);
  writeSkill(directory, "no-frontmatter", "# Just a heading\n\nBody only.\n");
  writeSkill(directory, "no-description", "---\nname: named-without-description\n---\n\nBody\n");
  writeSkill(directory, "empty-description", "---\nname: empty\ndescription: |\n---\n\nBody\n");

  const skills = discoverSkills(configWith([directory]));
  const byName = new Map(skills.map((skill) => [skill.name, skill.description]));
  assert.equal(byName.get("no-frontmatter"), "Specialized workflow instructions.");
  assert.equal(byName.get("named-without-description"), "Specialized workflow instructions.");
  assert.equal(byName.get("empty"), "Specialized workflow instructions.");
});

test("frontmatterValue splits only on the requested key", () => {
  const frontmatter = "name: alpha\ndescription: Alpha does things.\nmetadata:\n  version: 1\n";
  assert.equal(frontmatterValue(frontmatter, "name"), "alpha");
  assert.equal(frontmatterValue(frontmatter, "description"), "Alpha does things.");
  assert.equal(frontmatterValue(frontmatter, "missing"), undefined);
  assert.equal(frontmatterValue("description: |\n  only a block\n", "description"), "only a block");
});

test("frontmatterBlock and stripFrontmatter agree on where frontmatter ends", () => {
  const content = "---\nname: alpha\n---\n\nBody here.\n";
  assert.equal(frontmatterBlock(content), "name: alpha");
  assert.equal(stripFrontmatter(content), "Body here.");
  assert.equal(frontmatterBlock("# No frontmatter\n"), undefined);
  assert.equal(stripFrontmatter("# No frontmatter\n"), "# No frontmatter");
});

test("a normal skill file is read from the head window only", (t) => {
  const directory = makeTempDir(t);
  const body = "Body paragraph.\n".repeat(600);
  const file = writeSkill(directory, "big-body", `---\nname: big-body\ndescription: Short description.\n---\n\n${body}`);

  const head = readFrontmatterHead(file);
  assert.ok(head.length <= FRONTMATTER_HEAD_BYTES, "the head read must not pull the whole file");
  const skill = onlySkill(discoverSkills(configWith([directory])));
  assert.equal(skill.description, "Short description.");
});

test("frontmatter longer than the head window falls back to a full read", (t) => {
  const directory = makeTempDir(t);
  const blockLines = Array.from(
    { length: 400 },
    (_, index) => `  line ${index} of a deliberately long block scalar description`,
  );
  const file = writeSkill(
    directory,
    "long-frontmatter",
    ["---", "name: long-frontmatter", "description: |", ...blockLines, "---", "", "Body", ""].join("\n"),
  );

  assert.ok(readFrontmatterHead(file).length > FRONTMATTER_HEAD_BYTES);
  const skill = onlySkill(discoverSkills(configWith([directory])));
  assert.equal(skill.name, "long-frontmatter");
  assert.ok(
    skill.description.length > FRONTMATTER_HEAD_BYTES,
    "the description must come from the full-file fallback",
  );
  assert.match(skill.description, /^line 0 of a deliberately long block scalar description/);
});

test("a body with no frontmatter still resolves through the fallback", (t) => {
  const directory = makeTempDir(t);
  writeSkill(directory, "body-only", "x".repeat(FRONTMATTER_HEAD_BYTES + 100));

  const skill = onlySkill(discoverSkills(configWith([directory])));
  assert.equal(skill.name, "body-only");
  assert.equal(skill.description, "Specialized workflow instructions.");
});

test("blacklist rules are applied while discovering", (t) => {
  const directory = makeTempDir(t);
  writeSkill(directory, "keep", skillFile("keep", "Keep."));
  writeSkill(directory, "drop", skillFile("drop", "Drop."));

  const exclude: ExcludeRule[] = ["drop"];
  assert.deepEqual(discoverSkills(configWith([directory], { exclude })).map((skill) => skill.name), ["keep"]);
});

test("reproduces the root order and blacklist behaviour of the original hard-coded roster", (t) => {
  const directory = makeTempDir(t);
  const vaultRoot = join(directory, "git/github.com/slogsdon/skills-vault-knowledge");
  const accountabilityRoot = join(directory, "git/github.com/slogsdon/loop-and-gate-accountability-kit");
  const makerskillsRoot = join(directory, "git/github.com/coreyhaines31/makerskills");

  writeSkill(join(vaultRoot, "skills"), "weekly-signals", skillFile("weekly-signals", "Vault copy."));
  writeSkill(join(accountabilityRoot, "skills"), "weekly-signals", skillFile("weekly-signals", "Accountability copy."));
  writeSkill(join(accountabilityRoot, "skills"), "decide", skillFile("decide", "Accountability copy."));
  writeSkill(join(makerskillsRoot, "skills"), "decide", skillFile("decide", "Makerskills copy."));
  writeSkill(join(makerskillsRoot, "skills"), "ingest", skillFile("ingest", "Makerskills copy."));
  writeSkill(join(makerskillsRoot, "skills"), "keep-me", skillFile("keep-me", "Makerskills copy."));

  const config = configWith([vaultRoot, accountabilityRoot, makerskillsRoot], {
    exclude: [
      { pathIncludes: "/coreyhaines31/makerskills/skills/", names: ["decide", "ingest"] },
      { pathIncludes: "/loop-and-gate-accountability-kit/skills/", names: ["weekly-signals"] },
    ],
  });
  const skills = discoverSkills(config);
  const byName = new Map(skills.map((skill) => [skill.name, skill.filePath]));

  assert.deepEqual([...byName.keys()].sort(), ["decide", "keep-me", "weekly-signals"]);
  assert.equal(byName.get("weekly-signals"), join(vaultRoot, "skills/weekly-signals/SKILL.md"));
  assert.equal(byName.get("decide"), join(accountabilityRoot, "skills/decide/SKILL.md"));
  assert.equal(byName.get("keep-me"), join(makerskillsRoot, "skills/keep-me/SKILL.md"));
  assert.equal(byName.has("ingest"), false);
});

test("the deferral notice replaces the static catalog block only", () => {
  const prompt = `before\n${SKILL_CATALOG_START}\n  <skill>\n    <name>x</name>\n  </skill>\n${SKILL_CATALOG_END}\nafter`;
  const stripped = withoutStaticSkillCatalog(prompt);

  assert.equal(hasStaticSkillCatalog(prompt), true);
  assert.ok(stripped.startsWith("before"));
  assert.ok(stripped.endsWith("\nafter"));
  assert.equal(stripped.includes(SKILL_CATALOG_END), false);
  assert.equal(stripped.includes("<name>x</name>"), false);
  assert.match(stripped, /Use search_skills for a task-specific capability/);
});

test("matches Pi's real system-prompt text, which is .trim()'d before the <skills> wrapper", () => {
  // Pi's formatSkillsForPrompt() builds the block as "\n\nThe following
  // skills..." but system-prompt.js calls .trim() on it before wrapping it
  // in <skills>...</skills>, so the live prompt has no blank line before
  // the text. A marker that only matched the untrimmed form never fired.
  const prompt = `<skills>\n${SKILL_CATALOG_START}\nUse the read tool...\n\n<available_skills>\n  <skill>\n    <name>x</name>\n  </skill>\n${SKILL_CATALOG_END}\n</skills>`;

  assert.equal(hasStaticSkillCatalog(prompt), true);
  const stripped = withoutStaticSkillCatalog(prompt);
  assert.ok(stripped.startsWith("<skills>\n"));
  assert.ok(stripped.endsWith("\n</skills>"));
  assert.equal(stripped.includes("<name>x</name>"), false);
});

test("a prompt without the markers is returned unchanged", () => {
  const prompt = "no catalog here";
  assert.equal(hasStaticSkillCatalog(prompt), false);
  assert.equal(withoutStaticSkillCatalog(prompt), prompt);
  assert.equal(withoutStaticSkillCatalog(prompt, false), prompt);
});

test("stripStaticCatalog: false leaves the prompt untouched", () => {
  const prompt = `before${SKILL_CATALOG_START}\n<skill/>\n${SKILL_CATALOG_END}after`;
  assert.equal(withoutStaticSkillCatalog(prompt, false), prompt);
});

test("tokenize and the inventory-vs-capability check", () => {
  assert.deepEqual(tokenize("PDF-Form  Filling!"), ["pdf", "form", "filling"]);
  assert.equal(isGenericInventoryQuery(tokenize("")), true);
  assert.equal(isGenericInventoryQuery(tokenize("all")), true);
  assert.equal(isGenericInventoryQuery(tokenize("all available skills")), true);
  assert.equal(isGenericInventoryQuery(tokenize("workflows")), true);
  assert.equal(isGenericInventoryQuery(tokenize("pdf form filling")), false);
});

test("a name match outranks a description match", () => {
  const named: Skill = { name: "pdf-forms", description: "nothing relevant", filePath: "/x", baseDir: "/x" };
  const described: Skill = {
    name: "unrelated",
    description: "pdf forms pdf forms pdf forms pdf forms",
    filePath: "/y",
    baseDir: "/y",
  };
  const terms = tokenize("pdf forms");
  assert.ok(score(named, terms) > score(described, terms));
  assert.equal(score(named, tokenize("absent")), 0);
});

test("selectCatalogPage clamps the page and reports stable offsets", () => {
  const skills = Array.from({ length: 25 }, (_, index) => syntheticSkill(`skill-${String(index).padStart(2, "0")}`));

  const firstPage = selectCatalogPage(skills, undefined, 1, 10);
  assert.deepEqual([firstPage.page, firstPage.totalPages, firstPage.start, firstPage.pageSkills.length], [1, 3, 0, 10]);

  const clampedLow = selectCatalogPage(skills, undefined, 0, 10);
  assert.deepEqual([clampedLow.page, clampedLow.start], [1, 0]);

  const clampedHigh = selectCatalogPage(skills, undefined, 99, 10);
  assert.deepEqual([clampedHigh.page, clampedHigh.start, clampedHigh.pageSkills.length], [3, 20, 5]);

  // Filtering keeps every skill with a positive score, so a token shared by all
  // names keeps them all, ranked. This is the pre-existing behaviour.
  const shared = selectCatalogPage(skills, "skill-07", 1, 10);
  assert.equal(shared.matches.length, 25);
  assert.equal(first(shared.matches).name, "skill-07");

  const distinct = [syntheticSkill("pdf-forms"), syntheticSkill("image-resize"), syntheticSkill("sql-tuning")];
  assert.deepEqual(selectCatalogPage(distinct, "pdf", 1, 10).matches.map((skill) => skill.name), ["pdf-forms"]);
  assert.equal(selectCatalogPage(distinct, "absent-term", 1, 10).matches.length, 0);

  const single = selectCatalogPage([], undefined, 5, 10);
  assert.deepEqual([single.totalPages, single.page, single.pageSkills.length], [1, 1, 0]);
});

test("truncateDescription and formatSkill respect the character budget", () => {
  assert.equal(truncateDescription("short", 10), "short");
  assert.equal(truncateDescription("abcdefghijklmnop", 10), "abcdefghi…");
  assert.equal(truncateDescription("abcdefghijklmnop", 10).length, 10);

  const skill = syntheticSkill("alpha");
  const formatted = formatSkill(skill, 120);
  const [firstLine, secondLine] = formatted.split("\n");
  assert.equal(firstLine, "- alpha: alpha description");
  assert.equal(secondLine, `  Read ${skill.filePath} before applying it.`);
});

test("expands /skill:<name> with and without arguments", (t) => {
  const directory = makeTempDir(t);
  const file = writeSkill(directory, "alpha", skillFile("alpha", "Alpha skill."));
  const skills = discoverSkills(configWith([directory]));

  const bare = expandSkillCommand("/skill:alpha", skills);
  assert.ok(bare !== undefined);
  assert.match(bare, /<skill name="alpha"/);
  assert.ok(bare.includes(`location="${file}"`));
  assert.match(bare, /References are relative to/);
  assert.match(bare, /Body text\./);
  assert.equal(bare.includes("---\nname:"), false, "frontmatter is stripped from the injected body");

  assert.ok(expandSkillCommand("/skill:alpha do the thing", skills)?.endsWith("do the thing"));
  assert.equal(expandSkillCommand("/skill:missing", skills), undefined);
  assert.equal(expandSkillCommand("just text", skills), undefined);
  assert.equal(expandSkillCommand("/skill:alpha", []), undefined);
});
