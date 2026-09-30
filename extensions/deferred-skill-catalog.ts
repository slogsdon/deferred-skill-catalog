/**
 * Pi wiring for the deferred skill catalog.
 *
 * Everything testable — configuration, discovery, scoring, paging, prompt
 * rewriting — lives in `../lib/`. This file only registers Pi tools, a command,
 * and event handlers, so it stays small and this package stays loadable by Pi
 * through jiti without a build step.
 */
import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  MAX_CATALOG_PAGE_SIZE,
  MAX_SEARCH_RESULTS,
  SEARCH_DEFAULT_LIMIT,
  type Skill,
  commandListing,
  discoverSkills,
  expandSkillCommand,
  hasStaticSkillCatalog,
  listSkillsResult,
  parseListingArgs,
  searchSkillsResult,
  withoutStaticSkillCatalog,
} from "../lib/catalog.ts";
import { describeConfig, resolveConfig } from "../lib/config.ts";

export default function deferredSkillCatalog(pi: ExtensionAPI): void {
  const { config, source } = resolveConfig({ agentDir: getAgentDir(), env: process.env });

  // Discovery walks every configured root and reads every SKILL.md, so it is
  // deferred to first use instead of being paid during Pi startup.
  let catalog: Skill[] | undefined;
  const getSkills = (): Skill[] => (catalog ??= discoverSkills(config));

  let warnedAboutMarkerDrift = false;

  pi.registerTool({
    name: "search_skills",
    label: "Search Skills",
    description: `Find a task-specific workflow. Query a capability, not an inventory; returns at most ${MAX_SEARCH_RESULTS} results.`,
    promptSnippet: "Use search_skills for a task-specific workflow; use list_skills only for an installed-skill inventory.",
    parameters: Type.Object({
      query: Type.String({ description: "Task or capability to search for; not 'all skills'" }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_SEARCH_RESULTS,
          default: SEARCH_DEFAULT_LIMIT,
          description: `Maximum results (1-${MAX_SEARCH_RESULTS})`,
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { text, matches } = searchSkillsResult(getSkills(), params.query, params.limit ?? SEARCH_DEFAULT_LIMIT);
      return { content: [{ type: "text", text }], details: { matches } };
    },
  });

  pi.registerTool({
    name: "list_skills",
    label: "List Skills",
    description: "List installed deferred skills in pages. Use only when the user asks for an inventory or available skills.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Optional capability filter" })),
      page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
      pageSize: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_CATALOG_PAGE_SIZE,
          default: DEFAULT_CATALOG_PAGE_SIZE,
          description: `Results per page (1-${MAX_CATALOG_PAGE_SIZE})`,
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const { text, ...details } = listSkillsResult(
        getSkills(),
        params.query,
        params.page ?? 1,
        params.pageSize ?? DEFAULT_CATALOG_PAGE_SIZE,
      );
      return { content: [{ type: "text", text }], details };
    },
  });

  pi.registerCommand("skills", {
    description: "List deferred skills. Usage: /skills [query] [page=N] | /skills --config",
    handler: async (args, ctx) => {
      if (/^\s*--config\s*$/.test(args)) {
        ctx.ui.notify(describeConfig(config, source, getSkills().length), "info");
        return;
      }

      const { query, page } = parseListingArgs(args);
      ctx.ui.notify(commandListing(getSkills(), query, page, "/skills"), "info");
    },
  });

  pi.on("input", async (event) => {
    const expanded = expandSkillCommand(event.text, getSkills());
    return expanded ? { action: "transform", text: expanded, images: event.images } : { action: "continue" };
  });

  pi.on("before_agent_start", async (event) => {
    // If Pi's marker text ever changes, deferral silently stops working and the
    // static catalog reappears in the prompt. Say so once instead of failing
    // quietly.
    if (
      config.stripStaticCatalog &&
      !warnedAboutMarkerDrift &&
      getSkills().length > 0 &&
      !hasStaticSkillCatalog(event.systemPrompt)
    ) {
      warnedAboutMarkerDrift = true;
      console.error(
        "[pi-deferred-skill-catalog] No static skill catalog block found in the system prompt. Pi's marker text may have changed, so the catalog was not deferred. Set \"stripStaticCatalog\": false to silence this.",
      );
    }
    return { systemPrompt: withoutStaticSkillCatalog(event.systemPrompt, config.stripStaticCatalog) };
  });
}
