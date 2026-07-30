<?php
/* ============================================================
   OMQ Short Links — config, database, validation.
   Shared by api.php (the admin API) and redirect.php.
   ============================================================ */

declare(strict_types=1);

function omq_config(): array
{
    static $config = null;
    if ($config === null) {
        $path = __DIR__ . '/config.php';
        if (!is_file($path)) {
            omq_fail(500, 'Server is not configured: config.php is missing.');
        }
        $config = require $path;
    }
    return $config;
}

/* Ends the request with a JSON error. The redirect script catches
   nothing, so this is also the last line of defence there. */
function omq_fail(int $status, string $message): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $message]);
    exit;
}

function omq_db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $db = omq_config()['db'];
    $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', $db['host'], $db['name']);

    try {
        $pdo = new PDO($dsn, $db['user'], $db['pass'], [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    } catch (PDOException $e) {
        /* The message can contain the credentials — never echo it. */
        error_log('OMQ short links: DB connection failed: ' . $e->getMessage());
        omq_fail(500, 'Could not reach the database.');
    }

    return $pdo;
}

/* Creates any table that is missing, so a deployment works without
   anyone importing schema.sql by hand.

   Called by the two admin endpoints only — never by redirect.php. That
   runs on every public scan, and re-checking the schema on the hot path
   would buy nothing: if a table is missing the redirect has nothing to
   serve anyway. */
function omq_ensure_schema(): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $pdo = omq_db();

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS `links` (
            `code`        VARCHAR(64)  NOT NULL,
            `url`         TEXT         NOT NULL,
            `label`       VARCHAR(255) NOT NULL DEFAULT \'\',
            `created_at`  DATETIME     NOT NULL,
            `created_by`  VARCHAR(255) NOT NULL DEFAULT \'\',
            `updated_at`  DATETIME         NULL DEFAULT NULL,
            `updated_by`  VARCHAR(255) NOT NULL DEFAULT \'\',
            `hits`        INT UNSIGNED NOT NULL DEFAULT 0,
            `last_hit_at` DATETIME         NULL DEFAULT NULL,
            PRIMARY KEY (`code`),
            KEY `created_at` (`created_at`),
            KEY `created_by` (`created_by`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS `assets` (
            `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
            `kind`       VARCHAR(16)  NOT NULL,
            `name`       VARCHAR(160) NOT NULL,
            `value`      VARCHAR(64)  NOT NULL DEFAULT \'\',
            `file`       VARCHAR(160) NOT NULL DEFAULT \'\',
            `original`   VARCHAR(200) NOT NULL DEFAULT \'\',
            `mime`       VARCHAR(100) NOT NULL DEFAULT \'\',
            `bytes`      INT UNSIGNED NOT NULL DEFAULT 0,
            `notes`      VARCHAR(255) NOT NULL DEFAULT \'\',
            `created_at` DATETIME     NOT NULL,
            `created_by` VARCHAR(255) NOT NULL DEFAULT \'\',
            PRIMARY KEY (`id`),
            KEY `kind` (`kind`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
}

/* ---------- validation ---------- */

/* The site and the redirects share one document root, so a code must
   not collide with anything that is actually served. Apache checks for
   a real file first, which covers exact names like "qr.html" — this
   list covers the extensionless forms and the pretty aliases. Add to
   it whenever a page is added. */
const OMQ_RESERVED = [
    'index', 'home', 'qr', 'short', 'shorten', 'links', 'link', 'api',
    'auth', 'lib', 'config', 'redirect', 'schema', 'styles', 'app',
    'admin', 'assets', 'img', 'css', 'js', 'robots', 'favicon',
    'sitemap', 'readme', 'login', 'logout',
    /* Dev tools */
    'dev', 'tools', 'brand', 'image', 'images', 'font', 'fonts',
    'colour', 'colours', 'color', 'colors', 'icon', 'icons', 'palette',
];

/* Ambiguous glyphs are left out so a code survives being read aloud
   or copied off a printed page: no l, i, o, 0 or 1. */
const OMQ_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/* Labels are free text, so cutting them to fit the column must not
   split a multi-byte character. mbstring is normally present, but a
   missing extension should not take the whole API down. */
function omq_clip(string $text, int $length): string
{
    $text = trim($text);
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $length);
    }
    if (strlen($text) <= $length) {
        return $text;
    }
    $cut = substr($text, 0, $length);
    /* Drop a trailing partial UTF-8 sequence. */
    return preg_replace('/[\x80-\xBF]*$|[\xC0-\xFF][\x80-\xBF]*$/', '', $cut) ?? $cut;
}

function omq_normalize_url(string $raw): string
{
    $url = trim($raw);
    if ($url === '') {
        throw new InvalidArgumentException('Enter a destination URL.');
    }
    if (!preg_match('#^https?://#i', $url)) {
        $url = 'https://' . $url;
    }

    $parts = parse_url($url);
    if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
        throw new InvalidArgumentException('That does not look like a valid URL.');
    }
    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        throw new InvalidArgumentException('Only http and https links are allowed.');
    }
    if (strpos($parts['host'], '.') === false) {
        throw new InvalidArgumentException('That does not look like a valid URL.');
    }
    if (strlen($url) > 2000) {
        throw new InvalidArgumentException('That URL is too long.');
    }
    return $url;
}

function omq_validate_code(string $raw): string
{
    $code = strtolower(trim($raw));
    if (!preg_match('/^[a-z0-9][a-z0-9-]{1,31}$/', $code)) {
        throw new InvalidArgumentException('Use 2–32 characters: letters, numbers or hyphens.');
    }
    if (in_array($code, OMQ_RESERVED, true)) {
        throw new InvalidArgumentException("\"$code\" is reserved — pick another.");
    }
    return $code;
}

/* Generated server-side: only the database knows what is already
   taken, so a client could not do this without racing. */
function omq_make_code(PDO $pdo, int $length = 5): string
{
    $alphabet = OMQ_ALPHABET;
    $max = strlen($alphabet) - 1;

    for ($attempt = 0; $attempt < 40; $attempt++) {
        $code = '';
        for ($i = 0; $i < $length; $i++) {
            $code .= $alphabet[random_int(0, $max)];
        }
        if (in_array($code, OMQ_RESERVED, true)) {
            continue;
        }
        $stmt = $pdo->prepare('SELECT 1 FROM `links` WHERE `code` = ?');
        $stmt->execute([$code]);
        if (!$stmt->fetchColumn()) {
            return $code;
        }
    }
    return omq_make_code($pdo, $length + 1);
}
