<?php
/**
 * F · Frontispiece: the single entry point to this project's set.
 * It names the work, states the problem, and indexes what follows.
 * No figure: a frontispiece carries no argument.
 */
$this->layout('partials::layout', [
    'title' => 'Deferred Skill Catalog · skill descriptions on demand',
    'description' => 'Keeps skill descriptions out of the prompt for Pi and Claude Code and makes them searchable on demand through search_skills and list_skills.',
    'path' => '/',
    'notFound' => false,
]);
?>
<section class="intro" aria-labelledby="project-title">
    <p class="t-smallcaps">shane logsdon · pi + claude code</p>
    <h1 id="project-title">Skills on disk.<br>Descriptions <span class="t-accent">on demand.</span></h1>
    <p class="t-lead">Both harnesses put installed skills and their descriptions into the
        model’s context. With hundreds of skills installed, that catalog is a fixed cost on
        every turn. This package leaves the skills on disk and makes them searchable
        instead.</p>
    <a class="btn-arrow" href="/deferred-skill-catalog/getting-started/">Set it up</a>
</section>

<section class="page-section" aria-labelledby="problem-title">
    <header class="index-head">
        <h2 id="problem-title" class="t-smallcaps-lg">the problem</h2>
        <span class="t-dateline">cost per turn</span>
    </header>
    <div class="prose">
        <p>Pi and Claude Code both put a catalog of installed skills into the model’s
            context. Each entry is a name plus a description, and the catalog is rebuilt on
            every request. Nothing about it changes between turns; it is simply there, every
            time, ahead of the work.</p>
        <p>Deferred Skill Catalog keeps the skills on disk where they already are. What
            changes is where the <em>descriptions</em> live: out of the prompt, behind two
            tools the model calls when it needs them.</p>
    </div>
</section>

<section class="page-section" aria-labelledby="surfaces-title">
    <header class="index-head">
        <h2 id="surfaces-title" class="t-smallcaps-lg">what it does</h2>
        <span class="t-dateline">two tools, one listing</span>
    </header>
    <div class="prose">
        <dl class="facts">
            <div class="fact">
                <dt><code>search_skills</code></dt>
                <dd>Answers “which skill fills a PDF form?” with at most 8 matches, each
                    naming the skill, its trimmed description, and how to load it.</dd>
            </div>
            <div class="fact">
                <dt><code>list_skills</code></dt>
                <dd>Pages through the full inventory, 20 per page by default and 30 at
                    most.</dd>
            </div>
            <div class="fact">
                <dt>Human listing</dt>
                <dd><code>/skills [query] [page=N]</code> in Pi, and
                    <code>/deferred-skill-catalog:skills [query] [page=N]</code> in Claude
                    Code.</dd>
            </div>
        </dl>
        <p>It works with any skill directory: skills written for one harness and used
            from another, plain repositories that aren't packages, and any directory
            listed in <code>roots</code>.</p>
        <p>The two harnesses defer differently. Pi replaces its
            <code>&lt;available_skills&gt;</code> block with a short pointer to the tools,
            so its deferral is automatic. Claude Code has no hook that can rewrite its
            system prompt, so descriptions are dropped by its own
            <code>skillListingBudgetFraction</code> setting and served back by an MCP
            server bundled with the plugin. In Claude Code the skill <em>names</em> stay in
            the prompt; only descriptions are removed.</p>
    </div>
</section>

<section class="page-section" aria-labelledby="status-title">
    <header class="index-head">
        <h2 id="status-title" class="t-smallcaps-lg">status</h2>
        <span class="t-dateline">0.2.1</span>
    </header>
    <div class="prose">
        <p>Version 0.2.1, MIT licensed, installable as a Pi package and as a Claude Code
            plugin from its Git repository. The two harnesses are not symmetric, and this
            site keeps that distinction: Pi's deferral is part of the package, while Claude
            Code's depends on a setting you turn on in its own configuration.</p>
        <p>This site publishes no benchmark, percentage, or savings figure. The source
            README records one measurement taken on one machine; that measurement has not
            been reproduced here, and a single machine is not a promise about yours.</p>
    </div>
</section>

<section class="page-section" aria-labelledby="next-title">
    <header class="index-head">
        <h2 id="next-title" class="t-smallcaps-lg">where to go</h2>
        <span class="t-dateline">005 entries</span>
    </header>
    <ul class="link-list">
        <li>
            <a href="/deferred-skill-catalog/getting-started/">Getting started<span aria-hidden="true"> →</span></a>
            <p>Separate Pi and Claude Code setup, the deferral settings, the fixed limits,
                and a search example.</p>
        </li>
        <li>
            <a href="https://github.com/slogsdon/deferred-skill-catalog">Source on GitHub<span aria-hidden="true"> ↗</span></a>
            <p>The package, the Pi extension, the Claude Code plugin, and the test suites.</p>
        </li>
        <li>
            <a href="https://github.com/slogsdon/deferred-skill-catalog/blob/main/deferred-skill-catalog.example.json">Commented example config<span aria-hidden="true"> ↗</span></a>
            <p>Every key with its default, including the exclusion rules.</p>
        </li>
        <li>
            <a href="https://pi.dev">Pi<span aria-hidden="true"> ↗</span></a>
            <p>The harness where deferral is part of the package.</p>
        </li>
        <li>
            <a href="https://claude.com/claude-code">Claude Code<span aria-hidden="true"> ↗</span></a>
            <p>The harness where deferral is a setting you turn on.</p>
        </li>
    </ul>
</section>
