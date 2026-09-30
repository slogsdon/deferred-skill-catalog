/**
 * Claude Code skill discovery: the skills Claude Code itself would list, with
 * the name its Skill tool expects.
 *
 * Node built-ins only, like `../lib/`, so `node --test` loads it directly and
 * the plugin runs without an install step.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { type Skill, discoverSkills } from "../lib/catalog.ts";
import type { CatalogConfig } from "../lib/config.ts";

export const CLAUDE_CONFIG_ENV_VAR = "CLAUDE_DEFERRED_SKILL_CATALOG_CONFIG";

/** `skills/<name>/SKILL.md` is one level below a skills directory, which is all Claude Code scans. */
const CLAUDE_SKILL_DEPTH = 1;

export type ClaudeSource = { label: string; skills: Skill[] };

export function claudeConfigDir(env: NodeJS.ProcessEnv): string {
  return env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a JSON file, reporting instead of throwing. A missing file is not a problem. */
export function readJson(path: string, errors: string[]): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (isPlainObject(parsed)) return parsed;
    errors.push(`${path}: expected a JSON object; ignored.`);
  } catch (error) {
    errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}; ignored.`);
  }
  return undefined;
}

/**
 * `name@marketplace` keys that are enabled. Later settings files override
 * earlier ones, so a project can switch off a user-enabled plugin.
 */
export function enabledPluginKeys(settingsFiles: string[], errors: string[]): Set<string> {
  const state = new Map<string, boolean>();
  for (const file of settingsFiles) {
    const enabled = readJson(file, errors)?.enabledPlugins;
    if (!isPlainObject(enabled)) continue;
    for (const [key, value] of Object.entries(enabled)) {
      if (typeof value === "boolean") state.set(key, value);
    }
  }
  return new Set([...state].filter(([, on]) => on).map(([key]) => key));
}

type InstallRecord = { scope?: unknown; projectPath?: unknown; installPath?: unknown };

/** Install path for a plugin key: a user-scoped install, or a project-scoped one for `cwd`. */
function installPathFor(records: unknown, cwd: string): string | undefined {
  if (!Array.isArray(records)) return undefined;
  const usable = (records as InstallRecord[]).find(
    (record) =>
      typeof record.installPath === "string" &&
      (record.scope !== "project" || (typeof record.projectPath === "string" && resolve(record.projectPath) === resolve(cwd))),
  );
  return usable?.installPath as string | undefined;
}

/** `skills/` plus any `skills` path(s) the plugin manifest declares. */
function pluginSkillDirs(installPath: string, errors: string[]): string[] {
  const declared = readJson(join(installPath, ".claude-plugin", "plugin.json"), errors)?.skills;
  const extra = typeof declared === "string" ? [declared] : Array.isArray(declared) ? declared.filter((d) => typeof d === "string") : [];
  const dirs = [join(installPath, "skills"), ...extra.map((dir) => (isAbsolute(dir) ? dir : resolve(installPath, dir)))];
  return [...new Set(dirs)];
}

function scan(config: CatalogConfig, dir: string): Skill[] {
  return discoverSkills({ ...config, roots: [dir], maxDepth: Math.min(config.maxDepth, CLAUDE_SKILL_DEPTH) });
}

/**
 * Skills Claude Code discovers natively, in Claude Code's precedence order:
 * project skills, user skills, then enabled plugins. Plugin skills are
 * qualified as `<plugin>:<skill>`, which is the Skill tool's name for them.
 *
 * Bundled skills and claude.ai-synced plugins are not indexed.
 */
export function discoverClaudeSkills(
  config: CatalogConfig,
  options: { configDir: string; cwd: string },
  errors: string[] = [],
): ClaudeSource[] {
  const native = (skills: Skill[]): Skill[] => skills.map((skill) => ({ ...skill, invokeAs: skill.name }));
  const sources: ClaudeSource[] = [
    { label: "project skills", skills: native(scan(config, join(options.cwd, ".claude", "skills"))) },
    { label: "user skills", skills: native(scan(config, join(options.configDir, "skills"))) },
  ];

  const enabled = enabledPluginKeys(
    [
      join(options.configDir, "settings.json"),
      join(options.cwd, ".claude", "settings.json"),
      join(options.cwd, ".claude", "settings.local.json"),
    ],
    errors,
  );
  const installed = readJson(join(options.configDir, "plugins", "installed_plugins.json"), errors)?.plugins;
  if (!isPlainObject(installed)) return sources;

  for (const key of [...enabled].sort()) {
    const installPath = installPathFor(installed[key], options.cwd);
    if (installPath === undefined) continue;
    const plugin = key.split("@")[0] ?? key;
    const skills = pluginSkillDirs(installPath, errors)
      .flatMap((dir) => scan(config, dir))
      .map((skill) => {
        const qualified = `${plugin}:${skill.name}`;
        return { ...skill, name: qualified, invokeAs: qualified };
      });
    sources.push({ label: `plugin ${plugin}`, skills });
  }
  return sources;
}

function bareName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1);
}

/**
 * Native sources first, then configured extra roots; the first skill seen for
 * a name wins. A root skill that is a copy of a native one (same bare name and
 * description, e.g. Pi's git clone of an installed plugin) is dropped, so one
 * config file can serve both harnesses without doubling search results.
 */
export function mergeSources(sources: ClaudeSource[]): Skill[] {
  const byName = new Map<string, Skill>();
  const native = new Set<string>();
  for (const skill of sources.flatMap((source) => source.skills)) {
    const identity = `${bareName(skill.name)}\u0000${skill.description}`;
    if (skill.invokeAs !== undefined) native.add(identity);
    else if (native.has(identity)) continue;
    if (!byName.has(skill.name)) byName.set(skill.name, skill);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}
