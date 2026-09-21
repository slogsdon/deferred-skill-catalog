# pi-deferred-skill-catalog

Defers [Pi](https://pi.dev)'s skill catalog out of the system prompt. Instead of
listing every installed skill on every request, skills stay on disk and become
searchable on demand through two tools, a slash command, and `/skill:<name>`
expansion.

Works with any Pi skill directory, including skill trees written for other
harnesses (Claude Code, Codex) and plain repositories that are not Pi packages.

## Install

```bash
pi install git:github.com/slogsdon/pi-deferred-skill-catalog
```

```bash
# once published to npm
pi install npm:pi-deferred-skill-catalog
```

```bash
# try it for one run, without installing
pi -e git:github.com/slogsdon/pi-deferred-skill-catalog
```

Restart Pi after installing or after changing configuration.

## What you get

| Surface | Purpose |
| --- | --- |
| `search_skills` | Query a capability ("fill a PDF form"). Returns at most 8 matches. |
| `list_skills` | Paged inventory. Rated up to 30 per page. |
| `/skills [query] [page=N]` | The same catalog for a human, 10 rows at a time. |
| `/skills --config` | Resolved configuration, roots in precedence order, and any problems. |
| `/skill:<name> [args]` | Inline expansion of a skill body, with its location and reference base. |

It also replaces Pi's `<available_skills>` block with a short pointer to those
surfaces, which is where the token saving comes from.

## Requirements

- Pi, which supplies the bundled `@earendil-works/pi-coding-agent` and `typebox`
  modules. Both are declared as `peerDependencies` and must not be bundled.
- Node 24 or newer **only** to run this package's test suite. Pi loads the
  extension through jiti, so there is no build step and no `dist/`.

## Configuration

Everything is optional. With no configuration file, the catalog covers Pi's own
global skill locations (`~/.pi/agent/skills` and `~/.agents/skills`).

Configuration is read from the first of these that exists:

1. The file named by `PI_DEFERRED_SKILL_CATALOG_CONFIG` (bypasses discovery; a
   missing target falls back to defaults and is reported).
2. `~/.pi/agent/deferred-skill-catalog.json`.

The file is JSON with `//` comments and trailing commas allowed, so it can
explain itself. See
[`deferred-skill-catalog.example.json`](deferred-skill-catalog.example.json) for
a fully commented copy.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `roots` | `string[]` | `["~/.pi/agent/skills", "~/.agents/skills"]` (via Pi's agent dir) | Skill directories, searched **in order**. Accepts `~`, `$VAR`, `${VAR}`, absolute paths, and paths relative to the config file. Replaces the defaults. |
| `exclude` | `(string \| object)[]` | `[]` | Blacklist rules. See below. |
| `skipDirectories` | `string[]` | `[".git", "node_modules"]` | Directory names the walk never descends into. Replaces the defaults. |
| `maxDepth` | `number` | `12` | Maximum directory levels below each root. `0` reads the root itself. Guards against a root that points at a huge tree. |
| `stripStaticCatalog` | `boolean` | `true` | Replace Pi's `<available_skills>` block with the deferral notice. Set `false` to leave Pi's prompt untouched. |

### Exclude rules

A bare string blacklists that skill name in every root:

```json
{ "exclude": ["some-skill-you-never-use"] }
```

The object form scopes name matching to skills whose absolute path contains
`pathIncludes`. That is a plain case-sensitive **substring**, not a glob, and
comparison is normalized to forward slashes on every platform. Omit `names` to
drop every skill under a path:

```json
{
  "exclude": [
    { "pathIncludes": "/vendor/makerskills/skills/", "names": ["decide", "ingest"] },
    { "pathIncludes": "/archived/skills/" }
  ]
}
```

Invalid entries are reported through `/skills --config` and ignored; valid
entries in the same file still apply.

## Behaviour worth knowing

- **Roots are ordered and the first one wins.** When two roots define the same
  skill name, the earlier root shadows the later one. This is also how you
  prefer one vendored copy of a skill over another.
- **Stripping the static catalog hides skills that are not in your roots.** If
  Pi loads skills from a location you did not list, they leave the prompt and do
  not enter this catalog. Either add those locations to `roots`, or set
  `stripStaticCatalog` to `false` and treat this package as search-only.
- **Symlinked directories are not followed.** A symlink to a skill directory is
  skipped, which is what keeps the walk loop-safe.
- **Missing or unreadable roots are skipped, not fatal.** A root that does not
  exist is normal when the same config is used across machines.
- **Discovery is cached for the life of the process.** Restart Pi to pick up a
  skill added mid-session, or use Pi's reload.
- **Pi's own skill loading is unchanged.** This package changes what reaches the
  prompt, not what Pi loads. Pi also provides `/skill:<name>` when
  `enableSkillCommands` is on; this package's version injects the file body with
  its location and reference base, so both can be enabled.
- **The catalog markers are Pi's.** Deferral matches on the literal
  `<available_skills>` block that Pi's `formatSkillsForPrompt` emits. If Pi ever
  changes that text, a one-time message is written to Pi's log and the prompt is
  left alone rather than half-rewritten.

### Fixed limits

These are baked into the tool schemas and the descriptions Pi shows the model,
so they are deliberately not configurable:

| Limit | Value |
| --- | --- |
| `search_skills` results | 8 max, 5 by default |
| `list_skills` page size | 20 by default, 30 max |
| `/skills` page size | 10 |
| Result description budgets | 220 chars (`search_skills`), 120 (`list_skills`), 80 (`/skills`) |

## Security

Roots are read from disk, and `/skill:<name>` injects a full `SKILL.md` body
into the conversation. Point `roots` only at directories whose contents you
would be willing to run, exactly as you would for any Pi package or skill.

Configuration is treated as untrusted input. It is parsed defensively: unknown
keys are ignored, wrong types are reported and replaced with defaults, the file
is never executed, and exclusion names are held in a `Set`, so values such as
`__proto__` or `constructor` cannot resolve to `Object.prototype` members.

## Performance

Knowledge of a catalog costs I/O at startup, so this package does two things
about it:

- **Discovery is lazy and memoized.** Roots are walked on first use (first
  agent turn, tool call, or `/skills`) rather than during Pi startup, so
  `pi -p`, `--list-models`, and other runs that never touch skills pay nothing.
- **Frontmatter is read from a 4 KB window.** Skill descriptions are capped at
  1024 characters by the Agent Skills spec, so the window covers effectively
  every real file; a file whose frontmatter does not close inside it falls back
  to a full read.

Measured on a real catalog of 27 roots, 773 directories and 347 `SKILL.md`
files holding 2.96 MB of skill content: the previous eager implementation read
all 2.96 MB on every Pi startup. Reading only the first 4 KB of each file brings
that to 1.20 MB (59% less), and lazy discovery keeps it off the startup path.

## Development

```
extensions/deferred-skill-catalog.ts   Pi wiring: tools, command, event handlers
lib/config.ts                          Config discovery, validation, exclusion matcher
lib/catalog.ts                         Discovery, frontmatter, search, paging, prompt rewrite
tests/                                 node:test suites
```

`lib/` is deliberately outside `extensions/` and imports **only** Node
built-ins. That keeps the logic testable with a bare `node --test`, with no Pi
runtime, no `typebox`, and no build step. The `pi.extensions` manifest lists the
one extension file explicitly, so nothing in `lib/` is ever discovered as an
extension.

```bash
npm install          # devDependencies, plus Pi and typebox for type checking
npm test             # node --test, 44 tests, no runtime dependencies
npm run typecheck    # tsc --noEmit, strict + noUncheckedIndexedAccess
```

Tests build their fixtures in a temporary directory, so the suite asserts
against synthetic skill trees rather than anything on the machine that happens
to be running it.

## Releasing

```bash
npm test && npm run typecheck
git tag v0.1.0 && git push --tags
npm publish --access public
```

`npm pack --dry-run` should list exactly `LICENSE`, `README.md`, `package.json`,
`deferred-skill-catalog.example.json`, `extensions/`, and `lib/`.

## License

MIT
