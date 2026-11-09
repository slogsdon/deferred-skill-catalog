# Deferred Skill Catalog — microsite

Static microsite for [Deferred Skill Catalog](https://github.com/slogsdon/deferred-skill-catalog),
served at `https://projects.logsdon.io/deferred-skill-catalog/`.

Source revision: `0d4002f773fb551e49755a32d33807a4ee6a1e5c` (branch `feature/website`
of `slogsdon/deferred-skill-catalog`, HEAD at the time of writing). All product
content on the site is derived from that revision: `README.md`,
`deferred-skill-catalog.example.json`, `package.json`, and
`.claude-plugin/{plugin,marketplace}.json`.

## Build

Node 26.12.0, PHP 8.3+, and Composer are required.

```sh
cd website
composer install --no-interaction --prefer-dist
node scripts/build-site.ts          # SITE_NOINDEX=1 by default: preview, noindex
SITE_NOINDEX=0 node scripts/build-site.ts   # indexable production artifact
```

Output is a physical subtree at `website/dist/<slug>/`, plus `dist/_headers` in
preview builds. Nothing else is written at the `dist/` root: the hub owns
`/robots.txt`, `/sitemap.xml`, and the slashless `/<slug>` redirect.

Packaging (local only; neither command deploys):

```sh
npm ci
npx --no-install cf build --mode microsite
npx --no-install cf build --mode microsite-production
```

## One file drives the site

`site.json` holds the four values the build and the pages need — `slug`, `name`,
`origin`, `lastmod` — plus the `source` URL. `scripts/build-site.ts` validates
them, exports them to the PHP layout as `SITE_SLUG`, `SITE_NAME`, `SITE_ORIGIN`
and `SITE_NOINDEX`, and mounts every emitted URL under `/<slug>/`. The layout
throws if they are missing, so nothing falls back to a hard-coded project name.

To reuse this skeleton for another project: replace `site.json`, replace the
`pages/`, and change the Worker identity (name and fetch `pattern`) in
`cloudflare.config.ts`. Nothing else in `scripts/`, `resources/`, or
`public/assets/` names this project.

`cloudflare.config.ts` keeps the Worker name and route pattern as literals on
purpose: they are the deployment identity, not site content, and the file is
loaded by the Cloudflare CLI outside the build script.

## What the build asserts

`scripts/build-site.ts` fails the build unless all of the following hold:

- `index.html`, `404.html`, `sitemap.xml`, `assets/site.css`, `assets/tokens.css`,
  `assets/fonts/*` exist and are non-empty.
- No `_redirects`, `robots.txt`, `sitemap.xml`, `index.html`, or `404.html` at the
  `dist/` root; the root holds only `<slug>/` (and `_headers` when `SITE_NOINDEX=1`).
- Every HTML page has exactly one `<h1>`, a unique `<title>` containing the project
  name, a meta description, the skip link, the `main` landmark, and the primary
  `nav`.
- Canonical and `og:url` equal `https://projects.logsdon.io/<slug>/<path>`; the 404
  carries neither and is always noindex.
- The `noindex` meta matches `SITE_NOINDEX`, and the footer links both
  `https://projects.logsdon.io/` and `https://shane.logsdon.io/`.
- No `href`/`src` is root-relative outside `/<slug>/`, and every local link and
  asset target exists in the artifact.
- The sitemap lists exactly the canonical pages, with `lastmod` set to
  `site.json`'s `lastmod`.

The Google Fonts `@import` is stripped from the copied `tokens.css` (fonts are
served locally) and `/assets/` inside the copied CSS is rewritten to
`/<slug>/assets/`.

## Content and design provenance

- Pages: `pages/index.php` is F · Frontispiece (the single entry point, no
  figures). `pages/getting-started.php` is D · Assembly Order (numbered steps;
  step 2 splits into separate Pi and Claude Code setups). `pages/404.html.php` is
  G · Recovery.
- `public/assets/tokens.css`, the fonts, `assets/fonts/LICENSES.txt`, and the
  first part of `public/assets/site.css` are copied from the collection hub
  (`projects.logsdon.io`) at its `main`; `design/provenance.json` is copied with
  them and records the personal-site hashes (its paths are hub-relative). A
  clearly marked section is appended to `site.css` for what a project page needs
  and the hub's two pages do not: prose sections, code, tables, and harness
  blocks. No new colors and no new rule weights; everything comes from the
  tokens.
- `composer.lock` pins `slogsdon/flat-file` to the same reference as the hub
  (`dev-code-highlight`, `3ba5285e424aa376af324db0424f53c33a2c07a5`); only the
  lock's `content-hash` differs, regenerated for this package name.
- `package.json` pins the hub's `cf`, `@cloudflare/vite-plugin`, and `vite`
  versions exactly. Lint, formatting, and browser test tooling from the hub are
  not included; this site has no client JavaScript.

## Verified here

- `composer install`, `node scripts/build-site.ts` (preview and
  `SITE_NOINDEX=0`), and the artifact assertions above.
- `npm ci` and both `npx --no-install cf build` modes (packaging only).
- The absence of out-of-namespace root-relative URLs, and the preview/production
  indexing difference.

## Not verified here (Unverified)

No product command on the site was executed while building it. The site quotes
them from the source revision, and the getting-started page says so.

- `pi install git:github.com/slogsdon/deferred-skill-catalog` and
  `pi -e git:github.com/slogsdon/deferred-skill-catalog` — from `README.md`
  (Install → Pi). Not run; Pi is not installed in this build environment.
- `claude plugin marketplace add slogsdon/deferred-skill-catalog` and
  `claude plugin install deferred-skill-catalog@deferred-skill-catalog` — from
  `README.md` (Install → Claude Code). Not run.
- `{ "skillListingBudgetFraction": 0.0001 }` in `~/.claude/settings.json` — from
  `README.md` (Install → Claude Code). The effect on a real prompt was not
  measured here.
- `/skills --config`, `/skills [query] [page=N]`,
  `/deferred-skill-catalog:skills [query] [page=N]` and
  `/deferred-skill-catalog:skills --config` — from `README.md` ("What you get")
  and `commands/skills.md`. Not run.
- `node claude/server.ts --list pdf` — from `README.md` (Development). Not run:
  it reads this machine's real skill directories.
- The fixed limits table (8/5 results, 20/30 page size, 10 per human listing,
  220/120/80 character budgets) — from `README.md` (Fixed limits) and
  `lib/catalog.ts`. Read, not exercised.
- The source README's performance measurement (one machine, 315 skills, a
  `claude -p` run going from 46,306 to 41,707 input tokens) is deliberately not
  published on the site. It was not reproduced here, and a single machine is not
  a claim about another.

## Deployment

Published 2026-11-09 with a manual deploy from this directory. There is no Workers
Builds connection yet, so a content change needs the same steps:

```sh
npm ci
npm run build:production
npx --no-install cf build --mode microsite-production
npx --no-install cf deploy --prebuilt --mode microsite-production
```

Before going live, the site was checked on a noindex Worker Preview from
`npx --no-install cf previews deploy microsite --mode microsite`. The hub owns the
hostname (`projects.logsdon.io`), the sitemap index, and the slashless redirect;
this Worker claims only `projects.logsdon.io/deferred-skill-catalog/*`.
