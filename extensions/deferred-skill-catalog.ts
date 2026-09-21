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
  COMMAND_DESCRIPTION_CHARS,
  COMMAND_PAGE_SIZE,
  DEFAULT_CATALOG_PAGE_SIZE,
  LIST_DESCRIPTION_CHARS,
  MAX_CATALOG_PAGE_SIZE,
  MAX_SEARCH_RESULTS,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_DESCRIPTION_CHARS,
  type Skill,
  discoverSkills,
  expandSkillCommand,
  formatSkill,
  hasStaticSkillCatalog,
  isGenericInventoryQuery,
  score,
  selectCatalogPage,
  tokenize,
  truncateDescription,
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
      const terms = tokenize(params.query);
      if (isGenericInventoryQuery(terms)) {
        return {
          content: [{ type: "text", text: "This is an inventory request. Use list_skills instead of search_skills." }],
          details: { matches: [] },
        };
      }

      const matches = getSkills()
        .map((skill) => ({ skill, score: score(skill, terms) }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
        .slice(0, params.limit ?? SEARCH_DEFAULT_LIMIT);
      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No specialized skill matched: ${params.query}` }],
          details: { matches: [] },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: matches.map(({ skill }) => formatSkill(skill, SEARCH_DESCRIPTION_CHARS)).join("\n"),
          },
        ],
        details: { matches: matches.map(({ skill }) => skill.name) },
      };
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
      const catalogPage = selectCatalogPage(
        getSkills(),
        params.query,
        params.page ?? 1,
        params.pageSize ?? DEFAULT_CATALOG_PAGE_SIZE,
      );
      const heading = `Skills ${catalogPage.matches.length === 0 ? 0 : catalogPage.start + 1}-${catalogPage.start + catalogPage.pageSkills.length} of ${catalogPage.matches.length}; page ${catalogPage.page}/${catalogPage.totalPages}.`;
      const nextPage = catalogPage.page < catalogPage.totalPages ? ` Call list_skills with page ${catalogPage.page + 1} for more.` : "";
      return {
        content: [
          {
            type: "text",
            text: `${heading}${nextPage}\n${catalogPage.pageSkills.map((skill) => formatSkill(skill, LIST_DESCRIPTION_CHARS)).join("\n")}`,
          },
        ],
        details: {
          page: catalogPage.page,
          totalPages: catalogPage.totalPages,
          matches: catalogPage.pageSkills.map((skill) => skill.name),
        },
      };
    },
  });

  pi.registerCommand("skills", {
    description: "List deferred skills. Usage: /skills [query] [page=N] | /skills --config",
    handler: async (args, ctx) => {
      if (/^\s*--config\s*$/.test(args)) {
        ctx.ui.notify(describeConfig(config, source, getSkills().length), "info");
        return;
      }

      const pageMatch = args.match(/(?:^|\s)page=(\d+)\s*$/);
      const requestedPage = pageMatch ? Number(pageMatch[1]) : 1;
      const query = args.replace(pageMatch?.[0] ?? "", "").trim() || undefined;
      const catalogPage = selectCatalogPage(getSkills(), query, requestedPage, COMMAND_PAGE_SIZE);
      const heading = `Skills ${catalogPage.matches.length === 0 ? 0 : catalogPage.start + 1}-${catalogPage.start + catalogPage.pageSkills.length} of ${catalogPage.matches.length}; page ${catalogPage.page}/${catalogPage.totalPages}.`;
      const nextPage = catalogPage.page < catalogPage.totalPages ? ` Next: /skills${query ? ` ${query}` : ""} page=${catalogPage.page + 1}` : "";
      const rows = catalogPage.pageSkills.map(
        (skill) => `- ${skill.name}: ${truncateDescription(skill.description, COMMAND_DESCRIPTION_CHARS)}`,
      );
      ctx.ui.notify(`${heading}${nextPage}\n${rows.join("\n")}`, "info");
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
