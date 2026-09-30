# deferred-skill-catalog

Keeps skill descriptions out of the prompt for [Pi](https://pi.dev) and
[Claude Code](https://claude.com/claude-code). Both harnesses list every
installed skill and its description on every request. With hundreds of skills
installed, that listing is a large fixed cost on every turn. This package leaves
the skills on disk and makes them searchable on demand through two tools:

- `search_skills` answers "which skill fills a PDF form?" with at most 8
  matches.
- `list_skills` pages through the full inventory.

It works with any skill directory. That includes skill trees written for one
harness and used from another, and plain repositories that aren't packages.

## Install

### Pi

```bash
pi install git:github.com/slogsdon/deferred-skill-catalog
```

```bash
# try it for one run, without installing
pi -e git:github.com/slogsdon/deferred-skill-catalog
```

Restart Pi after installing or after changing configuration.

### Claude Code

```bash
claude plugin marketplace add slogsdon/deferred-skill-catalog
claude plugin install deferred-skill-catalog@deferred-skill-catalog
```

Then turn on the deferral itself by adding this to `~/.claude/settings.json`:

```json
{ "skillListingBudgetFraction": 0.0001 }
```

Claude Code has no hook that can rewrite its system prompt, so the plugin can't
remove the listing on its own. That setting does it natively. When the skill
listing exceeds the budget, Claude Code drops descriptions and lists `- name`
only. At `0.0001` the budget is smaller than the names alone, so every
description goes. The plugin then serves those descriptions on demand. Restart
Claude Code afterwards.

`/deferred-skill-catalog:skills --config` shows whether the setting is in
effect.

## What you get

| Surface | Pi | Claude Code |
| --- | --- | --- |
| Search by capability | `search_skills` tool | `search_skills` MCP tool |
| Paged inventory | `list_skills` tool | `list_skills` MCP tool |
| Human listing | `/skills [query] [page=N]` | `/deferred-skill-catalog:skills [query] [page=N]` |
| Resolved config | `/skills --config` | `/deferred-skill-catalog:skills --config` |
| Load a skill inline | `/skill:<name> [args]` | native `/<skill>` or `/<plugin>:<skill>` |
| Remove descriptions from the prompt | automatic (`stripStaticCatalog`) | `skillListingBudgetFraction` setting |

Each search result names the skill, gives a trimmed description, and says how to
load it:

- **Claude Code skills** (project, user, and enabled plugins) say
  `Load with the Skill tool: <name>`. Loading goes through Claude Code's own
  Skill tool, so arguments, `allowed-tools`, and `${CLAUDE_PLUGIN_ROOT}` all
  work as normal.
- **Everything else** (Pi skills, and extra roots in Claude Code) says
  `Read <path>/SKILL.md before applying it.`

## How each harness defers

**Pi.** Pi's `<available_skills>` block is replaced in `before_agent_start`
with a short pointer to the tools. Only skills in your configured roots stay
reachable, so list every location Pi loads skills from.

**Claude Code.** The listing is cut to names only, and descriptions are served
by an MCP server bundled with the plugin. The server's instructions tell Claude
to search before starting a task a skill might cover. Some differences from Pi:

- **Names stay in the prompt.** Only descriptions are removed. A few thousand
  tokens of names remain for a few hundred skills, which is also what lets a
  search result go straight to the Skill tool.
- **Bundled skills keep their descriptions.** Claude Code exempts its own
  bundled skills from the budget.
- **What gets indexed.** Claude Code's own sources are indexed in its precedence
  order: `<project>/.claude/skills`, `~/.claude/skills`, then every enabled
  plugin as `<plugin>:<skill>`. Enabled means `enabledPlugins` in user settings,
  overridden by project and local settings; a project-scoped install counts only
  in its own project. A plugin's manifest `skills` path is scanned alongside
  `skills/`.
- **claude.ai-synced plugins aren't indexed.** Their skills still end up listed
  name-only, but search won't find them. If you need them searchable, add their
  directories to `roots`.
- **The MCP tools may be deferred.** Claude Code may hide MCP tools behind
  ToolSearch. If it does, the server's instructions say to load `search_skills`
  through ToolSearch first.

## Configuration

Everything is optional.

| | Pi | Claude Code |
| --- | --- | --- |
| Config file | `~/.pi/agent/deferred-skill-catalog.json` | `~/.claude/deferred-skill-catalog.json` (`$CLAUDE_CONFIG_DIR` respected) |
| Override env var | `PI_DEFERRED_SKILL_CATALOG_CONFIG` | `CLAUDE_DEFERRED_SKILL_CATALOG_CONFIG` |
| Default `roots` | `~/.pi/agent/skills`, `~/.agents/skills` | none (Claude Code's own sources are always indexed) |

The env var names a file and bypasses discovery. If that file doesn't exist,
the defaults are used and the problem is reported.

**One file can serve both harnesses.** Symlink it into both places. In Claude
Code, a root skill that copies an indexed Claude skill is dropped, so Pi's clone
of an installed plugin doesn't double every search result. A copy means the same
bare name and the same description.

The file is JSON with `//` comments and trailing commas allowed, so it can
explain itself. See
[`deferred-skill-catalog.example.json`](deferred-skill-catalog.example.json) for
a fully commented copy.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `roots` | `string[]` | see above | Skill directories, searched **in order**. Accepts `~`, `$VAR`, `${VAR}`, absolute paths, and paths relative to the config file. Replaces the defaults. In Claude Code these are *extra* roots, searched after Claude's own sources. |
| `exclude` | `(string \| object)[]` | `[]` | Blacklist rules. See below. |
| `skipDirectories` | `string[]` | `[".git", "node_modules"]` | Directory names the walk never descends into. Replaces the defaults. |
| `maxDepth` | `number` | `12` | Maximum directory levels below each root. `0` reads the root itself. Guards against a root that points at a huge tree. |
| `stripStaticCatalog` | `boolean` | `true` | **Pi only.** Replace Pi's `<available_skills>` block with the deferral notice. Set `false` to leave Pi's prompt untouched. |

### Exclude rules

A bare string blacklists that skill name in every root. In Claude Code this is
the name as the skill declares it, without the `plugin:` prefix:

```json
{ "exclude": ["some-skill-you-never-use"] }
```

The object form limits name matching to skills whose absolute path contains
`pathIncludes`. That's a plain case-sensitive **substring**, not a glob.
Comparison is normalized to forward slashes on every platform. Omit `names` to
drop every skill under a path:

```json
{
  "exclude": [
    { "pathIncludes": "/vendor/makerskills/skills/", "names": ["decide", "ingest"] },
    { "pathIncludes": "/archived/skills/" }
  ]
}
```

Invalid entries are reported through `--config` and ignored. Valid entries in
the same file still apply.

Excluding a skill removes it from search only. To hide it from Claude Code
itself, use Claude Code's `/skills` menu or `skillOverrides`.

## Behaviour worth knowing

- **Roots are ordered and the first one wins.** When two roots define the same
  skill name, the earlier root shadows the later one. You can use that to prefer
  one vendored copy of a skill over another.
- **Pi: stripping the static catalog hides skills that aren't in your roots.**
  If Pi loads skills from a location you didn't list, they leave the prompt and
  don't enter this catalog. Either add those locations to `roots`, or set
  `stripStaticCatalog` to `false` and treat this package as search-only.
- **Symlinked directories aren't followed.** A symlink to a skill directory is
  skipped, which is what keeps the walk loop-safe.
- **Missing or unreadable roots are skipped, not fatal.** A root that doesn't
  exist is normal when the same config is used across machines.
- **Discovery is cached for the life of the process.** Restart the harness to
  pick up a skill added mid-session.
- **`when_to_use` is searchable.** It's appended to the description the same
  way Claude Code lists it (`description - when_to_use`).
- **The Pi catalog markers are Pi's.** Deferral matches on the literal
  `<available_skills>` block that Pi's `formatSkillsForPrompt` emits. If Pi ever
  changes that text, a one-time message goes to Pi's log, and the prompt is
  left alone rather than half-rewritten.

### Fixed limits

These are baked into the tool schemas and descriptions the model sees, so
they're deliberately not configurable:

| Limit | Value |
| --- | --- |
| `search_skills` results | 8 max, 5 by default |
| `list_skills` page size | 20 by default, 30 max |
| Human listing page size | 10 |
| Result description budgets | 220 chars (`search_skills`), 120 (`list_skills`), 80 (listing) |

## Security

Roots are read from disk, and a matched skill's instructions are followed by
the agent. Point `roots` only at directories whose contents you'd be willing to
run, the same as for any package or skill.

Configuration is treated as untrusted input and parsed defensively:

- Unknown keys are ignored.
- Wrong types are reported and replaced with defaults.
- The file is never executed.
- Exclusion names are held in a `Set`, so values such as `__proto__` or
  `constructor` can't resolve to `Object.prototype` members.

Claude Code's `settings.json` and `installed_plugins.json` are only read,
never written.

## Performance

Knowledge of a catalog costs I/O, so this package does two things about it:

- **Discovery is lazy and memoized.** Roots are walked on first use (the first
  agent turn in Pi, the first tool call in Claude Code), not during startup.
- **Frontmatter is read from a 4 KB window.** The Agent Skills spec caps skill
  descriptions at 1024 characters, so the window covers effectively every real
  file. A file whose frontmatter doesn't close inside it falls back to a full
  read.

**Claude Code: measured prompt size.** This was measured on one machine with
315 listed skills, whose full listing is 154,314 characters. A one-word
`claude -p` run went from 46,306 input tokens to 41,707 with the plugin loaded
and `skillListingBudgetFraction: 0.0001`. That's 4,599 tokens (10%) off every
request, net of the plugin's own MCP instructions. The saving is smaller than
the raw listing size suggests because Claude Code already caps the listing at 1%
of the context window by default, trimming descriptions it considers least
used. With the plugin, those descriptions come back through search instead of
being lost.

**Pi: startup I/O.** Here's a measurement on a real catalog: 27 roots, 773 directories, and 347
`SKILL.md` files holding 2.96 MB of skill content. The previous eager
implementation read all 2.96 MB on every Pi startup. Reading only the first
4 KB of each file brings that to 1.20 MB (59% less), and lazy discovery keeps
it off the startup path.

## Development

```
lib/config.ts                          Config discovery, validation, exclusion matcher
lib/catalog.ts                         Discovery, frontmatter, search, paging, result text, Pi prompt rewrite
extensions/deferred-skill-catalog.ts   Pi wiring: tools, command, event handlers
claude/sources.ts                      Claude Code skill sources: user, project, enabled plugins
claude/server.ts                       Claude Code wiring: zero-dependency MCP stdio server + CLI
.claude-plugin/, commands/             Claude Code plugin manifest, marketplace, slash command
tests/                                 node:test suites
```

`lib/` and `claude/` import **only** Node built-ins. The benefits:

- The logic is testable with a bare `node --test`, with no Pi runtime, no
  `typebox`, and no build step.
- The Claude plugin runs straight from its install directory on Node 24+,
  which strips TypeScript types natively.

The MCP server implements just the JSON-RPC methods Claude Code uses
(`initialize`, `ping`, `tools/list`, `tools/call`), so it needs no SDK.

```bash
npm install          # devDependencies, plus Pi and typebox for type checking
npm test             # node --test, no runtime dependencies
npm run typecheck    # tsc --noEmit, strict + noUncheckedIndexedAccess
node claude/server.ts --config        # Claude Code: resolved config, sources, budget knob
node claude/server.ts --list pdf      # Claude Code: human listing
```

Tests build their fixtures in a temporary directory, including a fake Claude
config dir. The suite asserts against synthetic skill trees, not whatever
happens to be on the machine running it.

## Releasing

```bash
npm test && npm run typecheck
git tag v0.2.0 && git push --tags
npm publish --access public
```

Keep `version` in step across `package.json` and `.claude-plugin/plugin.json`.
`npm pack --dry-run` should list exactly these:

- `LICENSE`, `README.md`, `package.json`
- `deferred-skill-catalog.example.json`
- `extensions/`, `lib/`, `claude/`, `commands/`, `.claude-plugin/`

## License

MIT
