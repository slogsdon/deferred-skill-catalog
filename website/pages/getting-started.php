<?php
/**
 * D · Assembly Order: genuinely sequential setup. Step 2 depends on step 1.
 * Each step carries an id so a reader can enter at step 4 from a link.
 */
$this->layout('partials::layout', [
    'title' => 'Getting started · Deferred Skill Catalog',
    'description' => 'Install Deferred Skill Catalog for Pi or Claude Code, turn on deferral, point it at your skill directories, and search the catalog.',
    'path' => '/getting-started/',
    'notFound' => false,
]);
?>
<section class="intro intro--compact" aria-labelledby="guide-title">
    <p class="t-smallcaps">deferred skill catalog · assembly order</p>
    <h1 id="guide-title">Getting <span class="t-accent">started.</span></h1>
    <p class="t-lead">Five steps. Pick your harness in step 2 — Pi and Claude Code are set
        up differently, because they defer the catalog differently.</p>
    <p class="t-meta guide-source">Commands and settings below are quoted from the project
        README and the commented example config. They were not executed while building
        this page.</p>
</section>

<div class="assembly">
    <section class="assembly__step" id="step-1" aria-labelledby="step-1-title">
        <span class="assembly__num" aria-hidden="true">01</span>
        <h2 id="step-1-title" class="t-headline-sm">Check what you already have</h2>
        <div class="prose">
            <p>The package is a Pi package and a Claude Code plugin. You need one of the two
                harnesses, and nothing else for Pi. The Claude Code plugin runs straight from
                its install directory on Node 24+, which strips TypeScript types natively.</p>
            <p>Skills are read from disk, so there is nothing to import or convert. If you
                already have a skills directory, the catalog can search it.</p>
        </div>
    </section>

    <section class="assembly__step" id="step-2" aria-labelledby="step-2-title">
        <span class="assembly__num" aria-hidden="true">02</span>
        <h2 id="step-2-title" class="t-headline-sm">Install for your harness</h2>
        <div class="prose">
            <p>These are two separate setups, not a sequence. Read the one for the harness
                you use.</p>
        </div>

        <div class="harness">
            <h3 class="harness__title">Pi</h3>
            <div class="prose">
                <p>Install the package:</p>
                <pre><code>pi install git:github.com/slogsdon/deferred-skill-catalog</code></pre>
                <p>Or try it for one run, without installing:</p>
                <pre><code>pi -e git:github.com/slogsdon/deferred-skill-catalog</code></pre>
                <p>Restart Pi after installing or after changing configuration.</p>
                <p><strong>Turning deferral on.</strong> Nothing to switch on. Pi's
                    <code>&lt;available_skills&gt;</code> block is replaced in
                    <code>before_agent_start</code> with a short pointer to
                    <code>search_skills</code> and <code>list_skills</code>, controlled by the
                    <code>stripStaticCatalog</code> key, which defaults to
                    <code>true</code>. Set it to <code>false</code> to leave Pi's prompt
                    untouched and treat this package as search-only.</p>
                <p><strong>The limit of that.</strong> Stripping the static catalog hides
                    skills that aren't in your roots. If Pi loads skills from a location you
                    didn't list, they leave the prompt and don't enter this catalog. Either
                    add those locations to <code>roots</code>, or set
                    <code>stripStaticCatalog</code> to <code>false</code>.</p>
                <p><strong>Check it.</strong></p>
                <pre><code>/skills --config</code></pre>
                <p>That prints the resolved config, so you can see which roots were picked up
                    and which exclude rules survived validation.</p>
            </div>
        </div>

        <div class="harness">
            <h3 class="harness__title">Claude Code</h3>
            <div class="prose">
                <p>Add the marketplace, then install the plugin:</p>
                <pre><code>claude plugin marketplace add slogsdon/deferred-skill-catalog
claude plugin install deferred-skill-catalog@deferred-skill-catalog</code></pre>
                <p><strong>Turning deferral on.</strong> This is a second, separate step.
                    Claude Code has no hook that can rewrite its system prompt, so the plugin
                    can't remove the listing on its own. Add this to
                    <code>~/.claude/settings.json</code>:</p>
                <pre><code>{ "skillListingBudgetFraction": 0.0001 }</code></pre>
                <p>When the skill listing exceeds that budget, Claude Code drops descriptions
                    and lists <code>- name</code> only. At <code>0.0001</code> the budget is
                    smaller than the names alone, so every description goes; the plugin then
                    serves those descriptions on demand. Restart Claude Code afterwards.</p>
                <p><strong>The limit of that.</strong> Names stay in the prompt — only
                    descriptions are removed. A few thousand tokens of names remain for a few
                    hundred skills, which is also what lets a search result go straight to the
                    Skill tool. Claude Code's own bundled skills keep their descriptions,
                    because it exempts them from the budget.</p>
                <p><strong>Check it.</strong></p>
                <pre><code>/deferred-skill-catalog:skills --config</code></pre>
                <p>That shows whether the setting is in effect, alongside the resolved
                    configuration and sources.</p>
            </div>
        </div>
    </section>

    <section class="assembly__step" id="step-3" aria-labelledby="step-3-title">
        <span class="assembly__num" aria-hidden="true">03</span>
        <h2 id="step-3-title" class="t-headline-sm">Point it at your skill directories</h2>
        <div class="prose">
            <p>Everything in this step is optional. Without a config file both harnesses use
                their defaults.</p>
        </div>
        <div class="table-wrap">
            <table>
                <caption class="t-smallcaps">config file and override</caption>
                <thead>
                    <tr><th scope="col">Setting</th><th scope="col">Pi</th><th scope="col">Claude Code</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <th scope="row">Config file</th>
                        <td><code>~/.pi/agent/deferred-skill-catalog.json</code></td>
                        <td><code>~/.claude/deferred-skill-catalog.json</code> (<code>$CLAUDE_CONFIG_DIR</code> respected)</td>
                    </tr>
                    <tr>
                        <th scope="row">Override env var</th>
                        <td><code>PI_DEFERRED_SKILL_CATALOG_CONFIG</code></td>
                        <td><code>CLAUDE_DEFERRED_SKILL_CATALOG_CONFIG</code></td>
                    </tr>
                    <tr>
                        <th scope="row">Default <code>roots</code></th>
                        <td><code>~/.pi/agent/skills</code>, <code>~/.agents/skills</code></td>
                        <td>none — Claude Code's own sources are always indexed</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="prose">
            <p>The env var names a file and bypasses discovery. If that file doesn't exist,
                the defaults are used and the problem is reported.</p>
            <p><strong>One file can serve both harnesses.</strong> Symlink it into both
                places. In Claude Code, a root skill is dropped when its bare name matches an
                indexed Claude skill, so Pi's clone of an installed plugin doesn't double
                every search result. The Claude copy is the one the Skill tool loads.</p>
            <p>The file is JSON with <code>//</code> comments and trailing commas allowed, so
                it can explain itself. The
                <a href="https://github.com/slogsdon/deferred-skill-catalog/blob/main/deferred-skill-catalog.example.json">commented example config</a>
                carries every key with its default.</p>
        </div>
        <div class="table-wrap">
            <table>
                <caption class="t-smallcaps">configuration keys</caption>
                <thead>
                    <tr><th scope="col">Key</th><th scope="col">Default</th><th scope="col">What it does</th></tr>
                </thead>
                <tbody>
                    <tr>
                        <th scope="row"><code>roots</code></th>
                        <td>see above</td>
                        <td>Skill directories, searched <strong>in order</strong>; the first root wins when two roots define the same name. Replaces the defaults. In Claude Code these are <em>extra</em> roots. Accepts <code>~</code>, <code>$VAR</code>, <code>${VAR}</code>, absolute paths, and paths relative to the config file.</td>
                    </tr>
                    <tr>
                        <th scope="row"><code>exclude</code></th>
                        <td><code>[]</code></td>
                        <td>Blacklist rules. A bare string blacklists that skill name in every root; the object form adds <code>pathIncludes</code>, a plain case-sensitive substring of the absolute path (not a glob). Excluding removes a skill from search only.</td>
                    </tr>
                    <tr>
                        <th scope="row"><code>skipDirectories</code></th>
                        <td><code>[".git", "node_modules"]</code></td>
                        <td>Directory names the walk never descends into. Replaces the defaults.</td>
                    </tr>
                    <tr>
                        <th scope="row"><code>maxDepth</code></th>
                        <td><code>12</code></td>
                        <td>Maximum directory levels below each root. <code>0</code> reads the root itself. Guards against a root that points at a huge tree.</td>
                    </tr>
                    <tr>
                        <th scope="row"><code>stripStaticCatalog</code></th>
                        <td><code>true</code></td>
                        <td><strong>Pi only.</strong> Replace Pi's static catalog block with the deferral notice. Set <code>false</code> to leave Pi's prompt untouched.</td>
                    </tr>
                </tbody>
            </table>
        </div>
        <div class="prose">
            <p>Shortened from the commented example: a minimal file that adds one shared
                tree and drops two vendored skills.</p>
            <pre><code>{
  "roots": ["~/.pi/agent/skills", "~/.agents/skills", "~/.claude/skills"],
  "exclude": [
    "some-skill-you-never-use",
    { "pathIncludes": "/vendor/makerskills/skills/", "names": ["decide", "ingest"] }
  ]
}</code></pre>
            <p>Restart the harness after editing. Discovery is cached for the life of the
                process, and rooted walks are lazy: roots are read on first use, not at
                startup.</p>
        </div>
    </section>

    <section class="assembly__step" id="step-4" aria-labelledby="step-4-title">
        <span class="assembly__num" aria-hidden="true">04</span>
        <h2 id="step-4-title" class="t-headline-sm">Know the limits you can't configure</h2>
        <div class="prose">
            <p>These values are baked into the tool schemas and descriptions the model sees,
                so they are deliberately not configurable. The deferral knobs are the only
                tuning surface: <code>stripStaticCatalog</code> in this package's config for
                Pi, and <code>skillListingBudgetFraction</code> in Claude Code's own settings
                for Claude Code.</p>
        </div>
        <div class="table-wrap">
            <table>
                <caption class="t-smallcaps">fixed limits</caption>
                <thead>
                    <tr><th scope="col">Limit</th><th scope="col">Value</th></tr>
                </thead>
                <tbody>
                    <tr><th scope="row"><code>search_skills</code> results</th><td>8 max, 5 by default</td></tr>
                    <tr><th scope="row"><code>list_skills</code> page size</th><td>20 by default, 30 max</td></tr>
                    <tr><th scope="row">Human listing page size</th><td>10</td></tr>
                    <tr><th scope="row">Result description budgets</th><td>220 chars (<code>search_skills</code>), 120 (<code>list_skills</code>), 80 (listing)</td></tr>
                </tbody>
            </table>
        </div>
        <div class="prose">
            <p>Two more edges are fixed by the harness rather than by this package. In
                Claude Code, claude.ai-synced plugins aren't indexed: their skills are still
                listed name-only, but search won't find them unless you add their directories
                to <code>roots</code>. And the MCP tools may themselves be deferred behind
                ToolSearch — if so, the server's instructions say to load
                <code>search_skills</code> through ToolSearch first.</p>
        </div>
    </section>

    <section class="assembly__step" id="step-5" aria-labelledby="step-5-title">
        <span class="assembly__num" aria-hidden="true">05</span>
        <h2 id="step-5-title" class="t-headline-sm">Search or list the catalog</h2>
        <div class="prose">
            <p>Ask the model for a capability and it calls <code>search_skills</code>; ask
                what's installed and it calls <code>list_skills</code>. To look yourself, use
                the human listing — a query, a page number, or both:</p>
            <pre><code>/skills pdf
/deferred-skill-catalog:skills pdf page=2</code></pre>
            <p>From a checkout of the repository, the same listing runs directly. This is the
                example the README's development section uses, and it needs a clone:</p>
            <pre><code>node claude/server.ts --list pdf</code></pre>
            <p>A search result names the skill, gives a trimmed description, and says how to
                load it. Claude Code skills — project, user, and enabled plugins — say
                <code>Load with the Skill tool: &lt;name&gt;</code>, so arguments,
                <code>allowed-tools</code>, and <code>${CLAUDE_PLUGIN_ROOT}</code> work as
                normal. Everything else, including Pi skills and extra roots in Claude Code,
                says <code>Read &lt;path&gt;/SKILL.md before applying it.</code></p>
            <p>That last distinction is the one worth internalising: search is a pointer, not
                a loader. The skill file is read before it is applied.</p>
        </div>
    </section>
</div>

<section class="page-section" aria-labelledby="next-title">
    <header class="index-head">
        <h2 id="next-title" class="t-smallcaps-lg">where to go</h2>
        <span class="t-dateline">after setup</span>
    </header>
    <ul class="link-list">
        <li>
            <a href="/deferred-skill-catalog/">Project introduction<span aria-hidden="true"> →</span></a>
            <p>What the package is, and what it does not claim.</p>
        </li>
        <li>
            <a href="https://github.com/slogsdon/deferred-skill-catalog">Source on GitHub<span aria-hidden="true"> ↗</span></a>
            <p>README, the Pi extension, the Claude Code plugin, and the test suites.</p>
        </li>
        <li>
            <a href="https://github.com/slogsdon/deferred-skill-catalog/blob/main/deferred-skill-catalog.example.json">Commented example config<span aria-hidden="true"> ↗</span></a>
            <p>Every key with its default, including the exclusion rules.</p>
        </li>
    </ul>
</section>
