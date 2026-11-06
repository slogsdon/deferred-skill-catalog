<?php
/**
 * G · Recovery: an error state offers one route back. No canonical, always noindex.
 */
$this->layout('partials::layout', [
    'title' => 'Page not found · Deferred Skill Catalog',
    'description' => 'This address is not part of the Deferred Skill Catalog microsite.',
    'notFound' => true,
]);
?>
<section class="not-found">
    <p class="t-smallcaps">404 · page not found</p>
    <h1>This page isn’t here.</h1>
    <p class="t-lead">The microsite has an introduction and a getting-started guide.
        Start from the introduction to find the documentation you need.</p>
    <a class="btn-arrow" href="/deferred-skill-catalog/">Back to the introduction</a>
</section>
