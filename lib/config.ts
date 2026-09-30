/**
 * Configuration for deferred-skill-catalog, shared by the Pi and Claude Code targets.
 *
 * Deliberately dependency-free: Node built-ins only, so the test suite can load
 * this module directly under `node --test` (no Pi runtime, no typebox, no build
 * step). Harness wiring lives in `extensions/deferred-skill-catalog.ts` (Pi) and
 * `claude/server.ts` (Claude Code).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** An object-form blacklist rule. */
export type ExcludeRuleObject = {
  /** POSIX-normalized substring of the skill's absolute path. */
  pathIncludes?: string;
  /** Skill names to exclude where `pathIncludes` matches; omit to exclude every skill under it. */
  names?: string[];
};

/** A blacklist rule. A bare string excludes that skill name in every root. */
export type ExcludeRule = string | ExcludeRuleObject;

export type CatalogConfig = {
  /** Ordered skill roots. The first root wins when two roots define the same skill name. */
  roots: string[];
  /** Blacklist rules. */
  exclude: ExcludeRule[];
  /** Directory names never descended into. */
  skipDirectories: string[];
  /** Maximum directory levels descended below each root. `0` reads the root itself. */
  maxDepth: number;
  /** Replace Pi's static `<available_skills>` block with the deferral notice. */
  stripStaticCatalog: boolean;
};

export type ConfigSource = {
  /** Config file that was loaded. Undefined when built-in defaults were used. */
  path?: string;
  /** Human-readable problems. Never thrown; surfaced through `/skills --config`. */
  errors: string[];
};

export type ResolvedConfig = {
  config: CatalogConfig;
  source: ConfigSource;
};

export const CONFIG_FILE_NAME = "deferred-skill-catalog.json";
/** Point this at a specific config file to bypass discovery entirely. */
export const CONFIG_ENV_VAR = "PI_DEFERRED_SKILL_CATALOG_CONFIG";
export const DEFAULT_SKIP_DIRECTORIES = [".git", "node_modules"];
export const DEFAULT_MAX_DEPTH = 12;

export type ExclusionMatcher = (filePath: string, name: string) => boolean;

/**
 * Pi's own global skill locations, which is what makes these defaults portable:
 * both exist on any machine that has run Pi, and neither is specific to the
 * machine this package was written on.
 */
export function defaultRoots(agentDir: string): string[] {
  return [join(agentDir, "skills"), join(homedir(), ".agents", "skills")];
}

export function defaultConfig(agentDir: string, roots: string[] = defaultRoots(agentDir)): CatalogConfig {
  return {
    roots: [...roots],
    exclude: [],
    skipDirectories: [...DEFAULT_SKIP_DIRECTORIES],
    maxDepth: DEFAULT_MAX_DEPTH,
    stripStaticCatalog: true,
  };
}

/**
 * Strip `//` comments and trailing commas so the config file can document
 * itself. Same approach as this repo's `models.json` reader.
 */
export function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (m) => (m[0] === '"' ? m : ""))
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (m, tail) => tail ?? (m[0] === '"' ? m : ""));
}

/** Expand a leading `~` and `$VAR` / `${VAR}` references. */
export function expandEnvironment(value: string, env: NodeJS.ProcessEnv): string {
  const withHome = value.replace(/^~(?=$|[\\/])/, homedir());
  return withHome.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (full, braced, bare) => {
    const resolved = env[braced ?? bare];
    return resolved === undefined ? full : resolved;
  });
}

/** Resolve a config path against the config file's own directory, never the cwd. */
export function expandPath(value: string, baseDir: string, env: NodeJS.ProcessEnv): string {
  const expanded = expandEnvironment(value, env);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded);
}

function toPosix(value: string): string {
  return value.split("\\").join("/");
}

/**
 * Compile blacklist rules once per discovery pass.
 *
 * Matching mirrors the hard-coded rules this package shipped before
 * configuration existed: a rule applies when the POSIX-normalized absolute path
 * contains `pathIncludes` and the skill's frontmatter `name` is listed. Names
 * are held in a `Set`, so values such as `__proto__` or `constructor` cannot
 * resolve to Object.prototype members.
 */
export function compileExclusions(rules: ExcludeRule[]): ExclusionMatcher {
  const globalNames = new Set<string>();
  const scoped: { pathIncludes: string; names?: Set<string> }[] = [];

  for (const rule of rules) {
    if (typeof rule === "string") {
      globalNames.add(rule);
      continue;
    }
    const pathIncludes = typeof rule.pathIncludes === "string" ? toPosix(rule.pathIncludes) : undefined;
    const names = Array.isArray(rule.names) ? new Set(rule.names) : undefined;
    if (pathIncludes === undefined) {
      for (const name of names ?? []) globalNames.add(name);
      continue;
    }
    scoped.push(names === undefined ? { pathIncludes } : { pathIncludes, names });
  }

  return (filePath, name) => {
    if (globalNames.has(name)) return true;
    const normalized = toPosix(filePath);
    for (const rule of scoped) {
      if (!normalized.includes(rule.pathIncludes)) continue;
      if (rule.names === undefined || rule.names.has(name)) return true;
    }
    return false;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseExcludeRule(entry: unknown, index: number, errors: string[]): ExcludeRule | undefined {
  if (typeof entry === "string") {
    if (entry.trim() === "") {
      errors.push(`exclude[${index}]: empty skill name ignored.`);
      return undefined;
    }
    return entry.trim();
  }
  if (!isPlainObject(entry)) {
    errors.push(`exclude[${index}]: expected a skill name or an object; ignored.`);
    return undefined;
  }

  const rule: ExcludeRuleObject = {};
  if (entry.pathIncludes !== undefined) {
    if (typeof entry.pathIncludes !== "string" || entry.pathIncludes === "") {
      errors.push(`exclude[${index}].pathIncludes: expected a non-empty string; ignored.`);
    } else {
      rule.pathIncludes = entry.pathIncludes;
    }
  }
  if (entry.names !== undefined) {
    if (!Array.isArray(entry.names)) {
      errors.push(`exclude[${index}].names: expected an array of skill names; ignored.`);
    } else {
      const names = entry.names.filter((name): name is string => typeof name === "string" && name !== "");
      if (names.length !== entry.names.length) {
        errors.push(`exclude[${index}].names: non-string entries ignored.`);
      }
      rule.names = names;
    }
  }
  if (entry.pathIncludes === undefined && entry.names === undefined) {
    errors.push(`exclude[${index}]: needs \`pathIncludes\` and/or \`names\`; ignored.`);
    return undefined;
  }
  if (rule.pathIncludes === undefined && rule.names === undefined) {
    return undefined; // every provided field was invalid; already reported above
  }
  return rule;
}

function validate(raw: unknown, defaults: CatalogConfig, baseDir: string, env: NodeJS.ProcessEnv): ResolvedConfig {
  const errors: string[] = [];
  const config: CatalogConfig = { ...defaults, roots: [...defaults.roots], skipDirectories: [...defaults.skipDirectories] };

  if (!isPlainObject(raw)) {
    errors.push("Config must be a JSON object; using built-in defaults.");
    return { config, source: { errors } };
  }

  if (raw.roots !== undefined) {
    if (!Array.isArray(raw.roots)) {
      errors.push("`roots`: expected an array of paths; using default roots.");
    } else {
      const roots: string[] = [];
      raw.roots.forEach((entry, index) => {
        if (typeof entry !== "string" || entry.trim() === "") {
          errors.push(`roots[${index}]: expected a non-empty string; ignored.`);
          return;
        }
        roots.push(expandPath(entry, baseDir, env));
      });
      config.roots = roots;
    }
  }

  if (raw.exclude !== undefined) {
    if (!Array.isArray(raw.exclude)) {
      errors.push("`exclude`: expected an array; ignored.");
    } else {
      const exclude: ExcludeRule[] = [];
      raw.exclude.forEach((entry, index) => {
        const rule = parseExcludeRule(entry, index, errors);
        if (rule !== undefined) exclude.push(rule);
      });
      config.exclude = exclude;
    }
  }

  if (raw.skipDirectories !== undefined) {
    if (!Array.isArray(raw.skipDirectories)) {
      errors.push("`skipDirectories`: expected an array of names; using defaults.");
    } else {
      const names = raw.skipDirectories.filter((name): name is string => typeof name === "string" && name !== "");
      if (names.length !== raw.skipDirectories.length) {
        errors.push("`skipDirectories`: non-string entries ignored.");
      }
      config.skipDirectories = names;
    }
  }

  if (raw.maxDepth !== undefined) {
    if (typeof raw.maxDepth !== "number" || !Number.isInteger(raw.maxDepth) || raw.maxDepth < 0) {
      errors.push(`\`maxDepth\`: expected a non-negative integer; using ${DEFAULT_MAX_DEPTH}.`);
    } else {
      config.maxDepth = raw.maxDepth;
    }
  }

  if (raw.stripStaticCatalog !== undefined) {
    if (typeof raw.stripStaticCatalog !== "boolean") {
      errors.push("`stripStaticCatalog`: expected a boolean; using true.");
    } else {
      config.stripStaticCatalog = raw.stripStaticCatalog;
    }
  }

  return { config, source: { errors } };
}

/**
 * Load configuration, in this order: the file named by `envVar` (default
 * `PI_DEFERRED_SKILL_CATALOG_CONFIG`, which bypasses discovery), then
 * `<agentDir>/deferred-skill-catalog.json`, then built-in defaults.
 *
 * `agentDir` is the harness's config directory (`~/.pi/agent` for Pi,
 * `~/.claude` for Claude Code). `defaultRoots` replaces Pi's default roots.
 *
 * Nothing here throws: a missing, unreadable, or malformed file degrades to
 * defaults and records a message for `--config`.
 */
export function resolveConfig(options: {
  agentDir: string;
  env?: NodeJS.ProcessEnv;
  envVar?: string;
  defaultRoots?: string[];
}): ResolvedConfig {
  const env = options.env ?? process.env;
  const envVar = options.envVar ?? CONFIG_ENV_VAR;
  const defaults = defaultConfig(options.agentDir, options.defaultRoots);
  const override = env[envVar];
  const explicit = typeof override === "string" && override.trim() !== "";
  const path = explicit ? expandPath(override.trim(), options.agentDir, env) : join(options.agentDir, CONFIG_FILE_NAME);

  if (!existsSync(path)) {
    const errors = explicit ? [`${envVar} points at ${path}, which does not exist; using built-in defaults.`] : [];
    return { config: defaults, source: { errors } };
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      config: defaults,
      source: { errors: [`Could not read ${path}: ${describeError(error)}; using built-in defaults.`] },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (error) {
    return {
      config: defaults,
      source: { path, errors: [`Could not parse ${path}: ${describeError(error)}; using built-in defaults.`] },
    };
  }

  const resolved = validate(parsed, defaults, dirname(path), env);
  return { config: resolved.config, source: { path, errors: resolved.source.errors } };
}

function formatExcludeRule(rule: ExcludeRule): string {
  if (typeof rule === "string") return `name "${rule}"`;
  const scope = rule.pathIncludes === undefined ? "any path" : `paths containing "${rule.pathIncludes}"`;
  const names = rule.names === undefined ? "every skill" : `names ${rule.names.map((name) => `"${name}"`).join(", ")}`;
  return `${scope}: ${names}`;
}

/** Human-readable dump for `/skills --config`. */
export function describeConfig(config: CatalogConfig, source: ConfigSource, skillCount?: number): string {
  const lines = [
    `Config: ${source.path ?? "built-in defaults"}`,
    ...(skillCount === undefined ? [] : [`Skills discovered: ${skillCount}`]),
    `Roots (${config.roots.length}, in precedence order):`,
    ...config.roots.map((root, index) => `  ${index + 1}. ${root}`),
    config.exclude.length === 0 ? "Exclude rules: none" : `Exclude rules (${config.exclude.length}):`,
    ...config.exclude.map((rule) => `  - ${formatExcludeRule(rule)}`),
    `Skip directories: ${config.skipDirectories.join(", ")}`,
    `Max depth: ${config.maxDepth}`,
    `Strip static catalog: ${config.stripStaticCatalog}`,
  ];
  if (source.errors.length > 0) {
    lines.push("", `Problems (${source.errors.length}):`, ...source.errors.map((error) => `  ! ${error}`));
  }
  return lines.join("\n");
}
