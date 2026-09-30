/**
 * Claude Code wiring for the deferred skill catalog: a dependency-free MCP
 * server over stdio (newline-delimited JSON-RPC 2.0), plus two CLI modes.
 *
 *   node claude/server.ts                         MCP server (what the plugin runs)
 *   node claude/server.ts --config                resolved configuration and sources
 *   node claude/server.ts --list [query] [page=N] human listing, 10 rows a page
 *
 * Claude Code has no system-prompt rewrite hook, so the deferral itself is the
 * `skillListingBudgetFraction` setting (see the README). This server supplies
 * the descriptions that setting drops, and points at the native Skill tool.
 */
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  MAX_CATALOG_PAGE_SIZE,
  MAX_SEARCH_RESULTS,
  SEARCH_DEFAULT_LIMIT,
  type Skill,
  commandListing,
  discoverSkills,
  listSkillsResult,
  parseListingArgs,
  searchSkillsResult,
} from "../lib/catalog.ts";
import { describeConfig, resolveConfig } from "../lib/config.ts";
import { CLAUDE_CONFIG_ENV_VAR, type ClaudeSource, claudeConfigDir, discoverClaudeSkills, mergeSources, readJson } from "./sources.ts";

const SERVER_NAME = "deferred-skill-catalog";
const SERVER_VERSION = "0.2.0";
const FALLBACK_PROTOCOL_VERSION = "2025-06-18";

export const INSTRUCTIONS =
  "Skill descriptions are deferred to minimize default context: the skill listing shows names only. " +
  "Before starting a task that a specialized workflow might cover, call search_skills with the capability you need " +
  "(load it with ToolSearch first if it is deferred). Use list_skills only when the user asks what is installed. " +
  "Load a match with the Skill tool using the name it gives; for a match that says Read, read that SKILL.md before applying it.";

const TOOLS = [
  {
    name: "search_skills",
    description: `Find a task-specific skill whose description is deferred. Query a capability, not an inventory; returns at most ${MAX_SEARCH_RESULTS} results with the Skill-tool name to load.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Task or capability to search for; not 'all skills'" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          default: SEARCH_DEFAULT_LIMIT,
          description: `Maximum results (1-${MAX_SEARCH_RESULTS})`,
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_skills",
    description: "List installed skills with descriptions, in pages. Use only when the user asks for an inventory or available skills.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional capability filter" },
        page: { type: "integer", minimum: 1, default: 1 },
        pageSize: {
          type: "integer",
          minimum: 1,
          maximum: MAX_CATALOG_PAGE_SIZE,
          default: DEFAULT_CATALOG_PAGE_SIZE,
          description: `Results per page (1-${MAX_CATALOG_PAGE_SIZE})`,
        },
      },
    },
  },
];

type Catalog = { skills: Skill[]; sources: ClaudeSource[]; errors: string[] };

export function createCatalog(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) {
  const configDir = claudeConfigDir(env);
  const { config, source } = resolveConfig({ agentDir: configDir, env, envVar: CLAUDE_CONFIG_ENV_VAR, defaultRoots: [] });

  // Discovery reads every SKILL.md, so it waits for the first tool call.
  let catalog: Catalog | undefined;
  const load = (): Catalog => {
    if (catalog) return catalog;
    const errors = [...source.errors];
    const sources = [
      ...discoverClaudeSkills(config, { configDir, cwd }, errors),
      { label: "configured roots", skills: discoverSkills(config) },
    ];
    return (catalog = { skills: mergeSources(sources), sources, errors });
  };

  const describe = (): string => {
    const { skills, sources, errors } = load();
    const settings = readJson(join(configDir, "settings.json"), []);
    const fraction = settings?.skillListingBudgetFraction;
    const envBudget = env.SLASH_COMMAND_TOOL_CHAR_BUDGET;
    const knob =
      envBudget !== undefined
        ? `SLASH_COMMAND_TOOL_CHAR_BUDGET=${envBudget}`
        : typeof fraction === "number"
          ? `skillListingBudgetFraction=${fraction}`
          : `not in ${join(configDir, "settings.json")}. Unless another settings layer sets it, Claude Code still lists full descriptions; add "skillListingBudgetFraction": 0.0001.`;
    return [
      describeConfig(config, { ...source, errors }, skills.length).replace(/\nStrip static catalog: .*/, ""),
      `Listing budget: ${knob}`,
      `Sources (${sources.length}):`,
      ...sources.map((entry) => `  ${entry.label}: ${entry.skills.length}`),
    ].join("\n");
  };

  return { skills: () => load().skills, describe };
}

function toolResult(text: string) {
  return { content: [{ type: "text", text }] };
}

type Request = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function handle(request: Request, catalog: ReturnType<typeof createCatalog>): object | undefined {
  const { id, method, params = {} } = request;
  if (id === undefined || id === null) return undefined; // notification: no reply
  const reply = (result: object) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : FALLBACK_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const integer = (value: unknown, fallback: number) => (Number.isInteger(value) ? (value as number) : fallback);
      if (params.name === "search_skills") {
        if (typeof args.query !== "string") return fail(-32602, "search_skills: `query` must be a string.");
        return reply(toolResult(searchSkillsResult(catalog.skills(), args.query, integer(args.limit, SEARCH_DEFAULT_LIMIT)).text));
      }
      if (params.name === "list_skills") {
        const query = typeof args.query === "string" ? args.query : undefined;
        const { text } = listSkillsResult(catalog.skills(), query, integer(args.page, 1), integer(args.pageSize, DEFAULT_CATALOG_PAGE_SIZE));
        return reply(toolResult(text));
      }
      return fail(-32602, `Unknown tool: ${String(params.name)}`);
    }
    default:
      return fail(-32601, `Method not found: ${String(method)}`);
  }
}

function serve(): void {
  const catalog = createCatalog();
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    if (line.trim() === "") return;
    let response: object | undefined;
    try {
      response = handle(JSON.parse(line) as Request, catalog);
    } catch {
      response = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  // `--list --config` too, so the slash command can pass its arguments through untouched.
  if (mode === "--config" || (mode === "--list" && rest.join(" ").trim() === "--config")) {
    console.log(createCatalog().describe());
  } else if (mode === "--list") {
    const { query, page } = parseListingArgs(rest.join(" "));
    console.log(commandListing(createCatalog().skills(), query, page, "/deferred-skill-catalog:skills"));
  } else {
    serve();
  }
}
