/**
 * Skill discovery, catalog search/paging, and prompt rewriting.
 *
 * Dependency-free like `./config.ts`: Node built-ins only, so `node --test` can
 * load it without the Pi runtime.
 */
import { type Dirent, closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { basename, join } from "node:path";
import { type CatalogConfig, type ExclusionMatcher, compileExclusions } from "./config.ts";

export type Skill = {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  /** Name to pass to the harness's native skill loader (Claude Code's Skill tool). Absent: read the file. */
  invokeAs?: string;
};

/** Pi's static skill catalog markers; see Pi's `formatSkillsForPrompt`. */
export const SKILL_CATALOG_START = "\n\nThe following skills provide specialized instructions for specific tasks.";
export const SKILL_CATALOG_END = "</available_skills>";

/**
 * Fixed limits. These are baked into the tool schemas and descriptions that Pi
 * shows the model, so they are intentionally not configurable.
 */
export const MAX_SEARCH_RESULTS = 8;
export const SEARCH_DEFAULT_LIMIT = 5;
export const DEFAULT_CATALOG_PAGE_SIZE = 20;
export const MAX_CATALOG_PAGE_SIZE = 30;
export const COMMAND_PAGE_SIZE = 10;

/** Description budgets in characters, per surface. */
export const SEARCH_DESCRIPTION_CHARS = 220;
export const LIST_DESCRIPTION_CHARS = 120;
export const COMMAND_DESCRIPTION_CHARS = 80;

/**
 * Search scoring weights. A matching name token is worth far more than a
 * matching description token, and description matches are capped so a long
 * description cannot outrank a name match.
 */
const NAME_TERM_WEIGHT = 24;
const DESCRIPTION_TERM_WEIGHT = 3;
const DESCRIPTION_TERM_MATCH_CAP = 3;

const FALLBACK_DESCRIPTION = "Specialized workflow instructions.";

/**
 * Bytes read when parsing frontmatter. Descriptions are capped at 1024
 * characters by the Agent Skills spec, so this covers effectively every real
 * file; a file whose frontmatter does not close inside the window falls back to
 * a full read.
 */
export const FRONTMATTER_HEAD_BYTES = 4096;

/** Queries that mean "show me the inventory" rather than "find a capability". */
const GENERIC_SEARCH_TERMS = new Set(["all", "available", "skill", "skills", "workflow", "workflows"]);

/** The frontmatter block, without the `---` fences, or undefined when absent. */
export function frontmatterBlock(content: string): string | undefined {
  return content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/**
 * Read one frontmatter key. Bare scalars, quoted scalars, and `|` / `>` block
 * scalars are supported.
 */
export function frontmatterValue(frontmatter: string, key: string): string | undefined {
  const lines = frontmatter.split(/\r?\n/);
  const index = lines.findIndex((line) => new RegExp(`^${key}:\\s*(.*)$`).test(line));
  if (index === -1) return undefined;

  const line = lines[index];
  if (line === undefined) return undefined;
  const value = line.replace(new RegExp(`^${key}:\\s*`), "").trim();
  if (value !== "|" && value !== ">") return value.replace(/^['"]|['"]$/g, "");

  const block: string[] = [];
  for (const line of lines.slice(index + 1)) {
    if (!/^\s/.test(line)) break;
    const text = line.trim();
    if (text) block.push(text);
  }
  return block.join(" ") || undefined;
}

/** Read at most `FRONTMATTER_HEAD_BYTES`, falling back to a full read. */
export function readFrontmatterHead(filePath: string): string {
  const descriptor = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(FRONTMATTER_HEAD_BYTES);
    const bytesRead = readSync(descriptor, buffer, 0, FRONTMATTER_HEAD_BYTES, 0);
    const head = buffer.toString("utf8", 0, bytesRead);
    if (bytesRead < FRONTMATTER_HEAD_BYTES) return head;
    if (frontmatterBlock(head) !== undefined) return head;
  } finally {
    closeSync(descriptor);
  }
  return readFileSync(filePath, "utf8");
}

function readSkill(filePath: string, isExcluded: ExclusionMatcher): Skill | undefined {
  try {
    const frontmatter = frontmatterBlock(readFrontmatterHead(filePath)) ?? "";
    const name = frontmatterValue(frontmatter, "name") ?? basename(join(filePath, ".."));
    if (isExcluded(filePath, name)) return undefined;
    // Claude Code lists `description - when_to_use`; search should see the same text.
    const description = frontmatterValue(frontmatter, "description") ?? FALLBACK_DESCRIPTION;
    const whenToUse = frontmatterValue(frontmatter, "when_to_use");
    return {
      name,
      description: whenToUse ? `${description} - ${whenToUse}` : description,
      filePath,
      baseDir: join(filePath, ".."),
    };
  } catch {
    return undefined;
  }
}

/**
 * Walk every configured root in order and collect `SKILL.md` files, keeping the
 * first skill seen for each name. Roots are visited in configuration order, so
 * an earlier root shadows a later one with the same skill name.
 *
 * Symlinked directories are not descended into (`Dirent.isDirectory()` is false
 * for a symlink), which is what keeps the walk loop-safe. Unreadable
 * directories are skipped rather than thrown.
 */
export function discoverSkills(config: CatalogConfig): Skill[] {
  const isExcluded = compileExclusions(config.exclude);
  const skipped = new Set(config.skipDirectories);
  const byName = new Map<string, Skill>();

  const visit = (directory: string, depth: number): void => {
    if (depth > config.maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skipped.has(entry.name)) continue;
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
      } else if (entry.name === "SKILL.md") {
        const skill = readSkill(entryPath, isExcluded);
        if (skill !== undefined && !byName.has(skill.name)) byName.set(skill.name, skill);
      }
    }
  };

  for (const root of config.roots) visit(root, 0);
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function isGenericInventoryQuery(terms: string[]): boolean {
  return terms.length === 0 || terms.every((term) => GENERIC_SEARCH_TERMS.has(term));
}

export function score(skill: Skill, terms: string[]): number {
  const nameTerms = tokenize(skill.name);
  const descriptionTerms = tokenize(skill.description);
  return terms.reduce((total, term) => {
    const nameMatches = nameTerms.filter((nameTerm) => nameTerm === term).length;
    const descriptionMatches = descriptionTerms.filter((descriptionTerm) => descriptionTerm === term).length;
    return total + nameMatches * NAME_TERM_WEIGHT + Math.min(descriptionMatches, DESCRIPTION_TERM_MATCH_CAP) * DESCRIPTION_TERM_WEIGHT;
  }, 0);
}

export function truncateDescription(description: string, maxChars: number): string {
  return description.length <= maxChars ? description : `${description.slice(0, maxChars - 1).trimEnd()}…`;
}

export function formatSkill(skill: Skill, descriptionChars: number): string {
  const load = skill.invokeAs === undefined
    ? `Read ${skill.filePath} before applying it.`
    : `Load with the Skill tool: ${skill.invokeAs}`;
  return `- ${skill.name}: ${truncateDescription(skill.description, descriptionChars)}\n  ${load}`;
}

export function selectCatalogPage(skills: Skill[], query: string | undefined, requestedPage: number, pageSize: number) {
  const terms = query ? tokenize(query) : [];
  const matches = terms.length === 0
    ? skills
    : skills
        .map((skill) => ({ skill, score: score(skill, terms) }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
        .map(({ skill }) => skill);
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, totalPages));
  const start = (page - 1) * pageSize;
  return { matches, page, totalPages, start, pageSkills: matches.slice(start, start + pageSize) };
}

/** Expand `/skill:<name> [args]` into an inline skill block. */
export function expandSkillCommand(text: string, skills: Skill[]): string | undefined {
  const match = text.match(/^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return undefined;
  const skill = skills.find((candidate) => candidate.name === match[1]);
  if (!skill) return undefined;
  try {
    const body = stripFrontmatter(readFileSync(skill.filePath, "utf8"));
    const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    return match[2]?.trim() ? `${skillBlock}\n\n${match[2].trim()}` : skillBlock;
  } catch {
    return undefined;
  }
}

export function hasStaticSkillCatalog(systemPrompt: string): boolean {
  return systemPrompt.includes(SKILL_CATALOG_START) && systemPrompt.includes(SKILL_CATALOG_END);
}

/**
 * Replace Pi's static `<available_skills>` block with the deferral notice so the
 * catalog costs nothing until it is searched. A prompt that does not contain the
 * markers is returned unchanged.
 */
export function withoutStaticSkillCatalog(systemPrompt: string, enabled = true): string {
  if (!enabled) return systemPrompt;
  const start = systemPrompt.indexOf(SKILL_CATALOG_START);
  if (start === -1) return systemPrompt;
  const end = systemPrompt.indexOf(SKILL_CATALOG_END, start);
  if (end === -1) return systemPrompt;
  return `${systemPrompt.slice(0, start)}

Specialized workflows are deferred to minimize default context. Use search_skills for a task-specific capability, or list_skills when the user asks what is installed. Read the selected SKILL.md before applying it.
${systemPrompt.slice(end + SKILL_CATALOG_END.length)}`;
}

/** `search_skills` result text, shared by every harness. */
export function searchSkillsResult(skills: Skill[], query: string, limit = SEARCH_DEFAULT_LIMIT): { text: string; matches: string[] } {
  const terms = tokenize(query);
  if (isGenericInventoryQuery(terms)) {
    return { text: "This is an inventory request. Use list_skills instead of search_skills.", matches: [] };
  }
  const matches = skills
    .map((skill) => ({ skill, score: score(skill, terms) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, Math.max(1, Math.min(limit, MAX_SEARCH_RESULTS)));
  if (matches.length === 0) return { text: `No specialized skill matched: ${query}`, matches: [] };
  return {
    text: matches.map(({ skill }) => formatSkill(skill, SEARCH_DESCRIPTION_CHARS)).join("\n"),
    matches: matches.map(({ skill }) => skill.name),
  };
}

/** `list_skills` result text, shared by every harness. */
export function listSkillsResult(skills: Skill[], query: string | undefined, requestedPage = 1, pageSize = DEFAULT_CATALOG_PAGE_SIZE) {
  const catalogPage = selectCatalogPage(skills, query, requestedPage, Math.max(1, Math.min(pageSize, MAX_CATALOG_PAGE_SIZE)));
  const nextPage = catalogPage.page < catalogPage.totalPages ? ` Call list_skills with page ${catalogPage.page + 1} for more.` : "";
  return {
    text: `${catalogPageHeading(catalogPage)}${nextPage}\n${catalogPage.pageSkills.map((skill) => formatSkill(skill, LIST_DESCRIPTION_CHARS)).join("\n")}`,
    page: catalogPage.page,
    totalPages: catalogPage.totalPages,
    matches: catalogPage.pageSkills.map((skill) => skill.name),
  };
}

export function catalogPageHeading(catalogPage: ReturnType<typeof selectCatalogPage>): string {
  const { matches, start, pageSkills, page, totalPages } = catalogPage;
  return `Skills ${matches.length === 0 ? 0 : start + 1}-${start + pageSkills.length} of ${matches.length}; page ${page}/${totalPages}.`;
}

/** Human listing for `/skills`-style commands: 10 rows, short descriptions. */
export function commandListing(skills: Skill[], query: string | undefined, requestedPage: number, nextCommand: string): string {
  const catalogPage = selectCatalogPage(skills, query, requestedPage, COMMAND_PAGE_SIZE);
  const nextPage = catalogPage.page < catalogPage.totalPages ? ` Next: ${nextCommand}${query ? ` ${query}` : ""} page=${catalogPage.page + 1}` : "";
  const rows = catalogPage.pageSkills.map((skill) => `- ${skill.name}: ${truncateDescription(skill.description, COMMAND_DESCRIPTION_CHARS)}`);
  return `${catalogPageHeading(catalogPage)}${nextPage}\n${rows.join("\n")}`;
}

/** Split `/skills` arguments into a query and a `page=N` suffix. */
export function parseListingArgs(args: string): { query: string | undefined; page: number } {
  const pageMatch = args.match(/(?:^|\s)page=(\d+)\s*$/);
  return {
    page: pageMatch ? Number(pageMatch[1]) : 1,
    query: args.replace(pageMatch?.[0] ?? "", "").trim() || undefined,
  };
}
