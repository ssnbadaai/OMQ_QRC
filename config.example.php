<?php
/* ============================================================
   Copy this file to config.php and fill it in. config.php holds
   the database password — it is gitignored, and .htaccess denies
   it over HTTP. Create it on the server; never commit it.
   ============================================================ */

return [
    /* ---------- MySQL (cPanel → MySQL Databases) ---------- */
    'db' => [
        /* cPanel prefixes both with your account name, e.g. omqpro_links */
        'name' => 'omqpro_links',
        'user' => 'omqpro_links',
        'pass' => '',
        'host' => 'localhost',
    ],

    /* ---------- Google sign-in ----------
       Google Cloud Console → APIs & Services → Credentials →
       Create credentials → OAuth client ID → Web application.

       Under "Authorised JavaScript origins" add the site's origin,
       exactly, with no trailing slash:
         https://qr.omqpro.com                                  */
    'google_client_id' => 'REPLACE_ME.apps.googleusercontent.com',

    /* Only Google Workspace accounts in these domains may sign in.
       Checked against the token's `hd` claim, which Google sets on
       Workspace accounts only — a personal gmail.com account that
       merely *claims* an omqpro.com address has no `hd` and is
       refused. */
    'allowed_domains' => ['omqpro.com'],

    /* Naming people here REPLACES the domain rule above: only these
       addresses get in, whatever domain they belong to. Empty means
       the domain rule applies.

       Use this if omqpro.com is not Google Workspace — no account
       would ever carry `hd`, so the domain rule alone would let
       nobody in at all. */
    'allowed_emails' => [],

    /* ---------- Short link base ----------
       The public prefix a code is appended to. Stated explicitly
       rather than taken from the request: this is what ends up
       printed on things, and a link built from whatever hostname
       someone happened to browse with is a link that stops working.
       Keep the trailing slash. */
    'short_base' => 'https://qr.omqpro.com/',
];
