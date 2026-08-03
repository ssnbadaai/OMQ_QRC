<?php
/* ============================================================
   OMQ Scraper — the fetching half of the scraping tool.

     POST scrape.php?action=probe    {site, cookie?, robots?}
     POST scrape.php?action=api      {site, endpoint, page, ...}
     POST scrape.php?action=sitemap  {url, ...}
     POST scrape.php?action=pages    {urls: [...], ...}

   Every action requires a Google ID token for an allowed domain:
     Authorization: Bearer <id_token>

   A browser cannot read another origin, so the fetching has to happen
   here. Everything else — the loop over endpoints and URLs, the
   accumulated result, the download — stays in the browser. That is
   deliberate: this file holds no state, needs no table, and a crawl
   that is abandoned half way leaves nothing behind to clean up.

   It also means a run survives nothing: close the tab and it is gone.
   For a tool that is used a handful of times that is the right trade,
   and it is why the page offers the download as soon as there is
   anything worth downloading rather than only at the end.

   One request does a few fetches and returns. The browser decides
   whether to ask for more. Nothing here can run long enough to meet
   max_execution_time, however large the site turns out to be.
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/auth.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/* ---------- limits ----------
   Small on purpose. These bound one HTTP request, not the crawl: the
   browser calls back for the next batch, so lowering them costs a few
   more round trips and nothing else. Raising them is what risks a
   timeout half way through a batch, which loses the whole batch. */
const OMQ_SCRAPE_BATCH     = 5;                 // URLs per pages request
const OMQ_SCRAPE_BODY_CAP  = 3 * 1024 * 1024;   // bytes read from one response
const OMQ_SCRAPE_TEXT_CAP  = 200000;            // characters of text kept per page
const OMQ_SCRAPE_REDIRECTS = 5;
const OMQ_SCRAPE_CONNECT   = 10;                // seconds
const OMQ_SCRAPE_TIMEOUT   = 25;                // seconds
const OMQ_SCRAPE_MAX_DELAY = 30.0;              // seconds between fetches

/* Honest about what it is and who to complain to. A crawler that
   disguises itself as a browser is a crawler that cannot be blocked
   by the people whose server it is running on. */
const OMQ_SCRAPE_UA = 'Mozilla/5.0 (compatible; OMQ-Archiver/1.0; +https://omqpro.com/)';

function omq_scrape_send(array $payload): void
{
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function omq_scrape_body(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($data) ? $data : [];
}

/* ============================================================
   Fetching, with a guard on where it may point

   This endpoint takes a URL from the caller and fetches it from the
   server. Without the checks below that is a proxy into everything the
   host can reach and the public internet cannot: 127.0.0.1, the
   metadata service on 169.254.169.254, other tenants on the private
   network. Being signed in does not make that safe — the point of the
   tool is to fetch a site the *user* named, and none of those are it.

   So: http(s) only, resolve the name ourselves, refuse private and
   reserved addresses, and pin the connection to the address we
   checked. Pinning is what closes the gap between the check and the
   connection — otherwise a name that answers with a public address
   once and a private one a moment later passes the check and then
   connects somewhere else entirely.
   ============================================================ */

function omq_scrape_addresses(string $host): array
{
    /* A bare address needs no lookup — and must not get one, or a
       hostile "host" of 127.0.0.1 would fall through unchecked. */
    if (filter_var($host, FILTER_VALIDATE_IP)) {
        return [$host];
    }

    $ips = gethostbynamel($host);
    $ips = is_array($ips) ? $ips : [];

    /* AAAA as well: a name with no A record but a routable IPv6 one
       would otherwise look unresolvable, and a name with a public A
       record and a loopback AAAA record would look safe. */
    if (defined('DNS_AAAA')) {
        $records = @dns_get_record($host, DNS_AAAA);
        foreach (is_array($records) ? $records : [] as $record) {
            if (!empty($record['ipv6'])) {
                $ips[] = $record['ipv6'];
            }
        }
    }

    return array_values(array_unique($ips));
}

/* Returns [host, port, ip] for a URL that is safe to fetch, or throws. */
function omq_scrape_guard(string $url): array
{
    $parts = parse_url($url);
    if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
        throw new InvalidArgumentException('That does not look like a valid URL.');
    }

    $scheme = strtolower($parts['scheme']);
    if ($scheme !== 'http' && $scheme !== 'https') {
        throw new InvalidArgumentException('Only http and https addresses can be fetched.');
    }

    $host = $parts['host'];
    $port = (int) ($parts['port'] ?? ($scheme === 'https' ? 443 : 80));

    $ips = omq_scrape_addresses($host);
    if (!$ips) {
        throw new InvalidArgumentException("Could not resolve \"$host\".");
    }

    /* Every address the name answers with has to be acceptable, not
       just the first. A name that resolves to both a public address
       and a private one is exactly the case this is here to stop. */
    foreach ($ips as $ip) {
        $public = filter_var(
            $ip,
            FILTER_VALIDATE_IP,
            FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
        );
        if (!$public) {
            throw new InvalidArgumentException(
                "\"$host\" resolves to a private address. Only public sites can be fetched."
            );
        }
    }

    /* IPv4 for preference: CURLOPT_RESOLVE wants a literal IPv6
       address in brackets, and not every curl build agrees about
       that. Either way the address is one we have already checked. */
    foreach ($ips as $ip) {
        if (strpos($ip, ':') === false) {
            return [$host, $port, $ip];
        }
    }

    return [$host, $port, '[' . $ips[0] . ']'];
}

/* ---------- one crawl at a time, per person ----------
   A polite crawler is one request at a time. Nothing about the page
   would send them in parallel, but the endpoint is reachable from
   anything holding a valid token, and fifty concurrent calls of five
   fetches each is two hundred and fifty simultaneous requests landing
   on someone else's server from this company's address. That is a
   thing to be reported for, whatever the intent was.

   The lock is released when the request ends — the handle is held in
   a static so nothing collects it early. */
function omq_scrape_lock(string $email): void
{
    static $handle = null;
    if ($handle !== null) {
        return;
    }

    $path = sys_get_temp_dir() . '/omq-scrape-' . hash('sha256', $email) . '.lock';
    $opened = @fopen($path, 'c');
    /* A host with no writable temp directory should lose the guard,
       not the tool. */
    if ($opened === false) {
        return;
    }

    if (!flock($opened, LOCK_EX | LOCK_NB)) {
        fclose($opened);
        omq_fail(429, 'Another crawl of yours is still running. Let it finish, or stop it first.');
    }

    $handle = $opened;
}

/* One request. No automatic redirect following — each hop is checked
   by the caller through the guard above, which curl would not do. */
function omq_scrape_once(string $url, ?string $cookie): array
{
    if (!function_exists('curl_init')) {
        omq_fail(500, 'This server has no cURL extension, so it cannot fetch anything.');
    }

    [$host, $port, $ip] = omq_scrape_guard($url);

    $body    = '';
    $headers = [];

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => OMQ_SCRAPE_CONNECT,
        CURLOPT_TIMEOUT        => OMQ_SCRAPE_TIMEOUT,
        CURLOPT_ENCODING       => '',           // accept gzip, and decode it
        CURLOPT_RESOLVE        => ["$host:$port:$ip"],
        CURLOPT_USERAGENT      => OMQ_SCRAPE_UA,
        CURLOPT_HTTPHEADER     => array_filter([
            'Accept-Language: ar,en;q=0.8',
            $cookie !== null && $cookie !== '' ? 'Cookie: ' . $cookie : null,
        ]),
        /* Belt and braces beside the scheme check: without this a
           redirect to file:// or gopher:// would be curl's to follow,
           not ours to refuse. */
        CURLOPT_PROTOCOLS      => CURLPROTO_HTTP | CURLPROTO_HTTPS,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers): int {
            $pair = explode(':', $line, 2);
            if (count($pair) === 2) {
                $headers[strtolower(trim($pair[0]))] = trim($pair[1]);
            }
            return strlen($line);
        },
        /* Stop reading at the cap rather than buffer a file of any
           size into memory. Returning short aborts the transfer. */
        CURLOPT_WRITEFUNCTION  => static function ($ch, string $chunk) use (&$body): int {
            if (strlen($body) >= OMQ_SCRAPE_BODY_CAP) {
                return 0;
            }
            $body .= $chunk;
            return strlen($chunk);
        },
    ]);

    curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $errno  = curl_errno($ch);
    curl_close($ch);

    /* CURLE_WRITE_ERROR is how the cap above announces itself, and it
       means we have what we asked for, not that the fetch failed. */
    if ($errno !== 0 && $errno !== CURLE_WRITE_ERROR && $status === 0) {
        throw new InvalidArgumentException('Could not reach that address.');
    }

    return ['status' => $status, 'headers' => $headers, 'body' => $body];
}

/* Follows redirects by hand so every hop goes through the guard. */
function omq_scrape_get(string $url, ?string $cookie, float $delay = 0.0): array
{
    if ($delay > 0) {
        usleep((int) round(min($delay, OMQ_SCRAPE_MAX_DELAY) * 1000000));
    }

    $seen = [];
    for ($hop = 0; $hop <= OMQ_SCRAPE_REDIRECTS; $hop++) {
        $res = omq_scrape_once($url, $cookie);
        $res['url'] = $url;

        $moved = $res['status'] >= 300 && $res['status'] < 400 && !empty($res['headers']['location']);
        if (!$moved) {
            return $res;
        }

        /* Relative Location headers are common and legal. */
        $next = omq_scrape_absolute($url, $res['headers']['location']);
        if ($next === null || isset($seen[$next])) {
            return $res;
        }
        $seen[$url] = true;
        $url = $next;
    }

    return $res;
}

/* Resolves a possibly-relative href against the page it was found on.
   Only the shapes that actually occur in markup — enough to build a
   crawl list, not a general URL library. */
function omq_scrape_absolute(string $base, string $href): ?string
{
    $href = trim($href);
    if ($href === '' || $href[0] === '#') {
        return null;
    }
    if (preg_match('#^https?://#i', $href)) {
        return $href;
    }
    if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $href)) {
        return null;              // mailto:, tel:, javascript:, data:
    }

    $parts = parse_url($base);
    if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
        return null;
    }
    $origin = $parts['scheme'] . '://' . $parts['host']
        . (isset($parts['port']) ? ':' . $parts['port'] : '');

    if (strncmp($href, '//', 2) === 0) {
        return $parts['scheme'] . ':' . $href;
    }
    if ($href[0] === '/') {
        return $origin . $href;
    }
    if ($href[0] === '?') {
        return $origin . ($parts['path'] ?? '/') . $href;
    }

    $dir = isset($parts['path']) ? preg_replace('#/[^/]*$#', '/', $parts['path']) : '/';
    return $origin . $dir . $href;
}

/* ============================================================
   robots.txt
   ============================================================ */

/* The subset that decides whether we may fetch a path: the group that
   applies to us, its rules, its crawl delay, and any sitemaps it
   advertises. Groups are matched by longest User-agent match, with `*`
   as the fallback, which is what the standard asks for. */
function omq_robots_parse(string $text): array
{
    $groups   = [];
    $sitemaps = [];
    $at       = -1;      // index of the group being filled
    $bare     = false;   // it has agents but no rules yet

    foreach (preg_split('/\r\n|\r|\n/', $text) ?: [] as $line) {
        $line = trim(preg_replace('/#.*$/', '', $line) ?? '');
        if ($line === '') {
            continue;
        }
        $pair = explode(':', $line, 2);
        if (count($pair) !== 2) {
            continue;
        }
        $field = strtolower(trim($pair[0]));
        $value = trim($pair[1]);

        if ($field === 'sitemap') {
            $sitemaps[] = $value;
            continue;
        }

        if ($field === 'user-agent') {
            /* Consecutive User-agent lines share one set of rules, so a
               new group starts only once the current one has been
               given something to say. */
            if ($at < 0 || !$bare) {
                $groups[] = ['agents' => [], 'rules' => [], 'delay' => null];
                $at   = count($groups) - 1;
                $bare = true;
            }
            $groups[$at]['agents'][] = strtolower($value);
            continue;
        }

        if ($at < 0) {
            continue;                 // a rule before any User-agent line
        }
        $bare = false;

        if ($field === 'allow' || $field === 'disallow') {
            $groups[$at]['rules'][] = ['allow' => $field === 'allow', 'path' => $value];
        } elseif ($field === 'crawl-delay') {
            $groups[$at]['delay'] = (float) $value;
        }
    }

    return ['groups' => $groups, 'sitemaps' => array_values(array_unique($sitemaps))];
}

function omq_robots_group(array $robots, string $ua): array
{
    $ua    = strtolower($ua);
    $best  = null;
    $bestN = -1;

    foreach ($robots['groups'] as $group) {
        foreach ($group['agents'] as $agent) {
            $match = $agent === '*' ? 0 : (strpos($ua, $agent) !== false ? strlen($agent) : -1);
            if ($match > $bestN) {
                $bestN = $match;
                $best  = $group;
            }
        }
    }

    return $best ?? ['agents' => [], 'rules' => [], 'delay' => null];
}

/* Longest matching rule wins; Allow wins a tie. An empty Disallow
   means "nothing is disallowed" and is skipped. */
function omq_robots_allows(array $group, string $url): bool
{
    $path = parse_url($url, PHP_URL_PATH) ?: '/';
    $query = parse_url($url, PHP_URL_QUERY);
    if ($query !== null && $query !== '') {
        $path .= '?' . $query;
    }

    $verdict = true;
    $winner  = -1;

    foreach ($group['rules'] as $rule) {
        $pattern = $rule['path'];
        if ($pattern === '') {
            continue;
        }
        if (!omq_robots_matches($pattern, $path)) {
            continue;
        }
        $length = strlen($pattern);
        if ($length > $winner || ($length === $winner && $rule['allow'])) {
            $winner  = $length;
            $verdict = $rule['allow'];
        }
    }

    return $verdict;
}

/* `*` matches any run of characters, `$` anchors the end. Both are
   near-universal extensions and WordPress sitemaps rely on them. */
function omq_robots_matches(string $pattern, string $path): bool
{
    $anchored = substr($pattern, -1) === '$';
    if ($anchored) {
        $pattern = substr($pattern, 0, -1);
    }
    $regex = str_replace('\*', '.*', preg_quote($pattern, '#'));
    return (bool) preg_match('#^' . $regex . ($anchored ? '$' : '') . '#', $path);
}

/* ============================================================
   Extracting a page
   ============================================================ */

function omq_scrape_dom(string $html): ?DOMDocument
{
    if ($html === '') {
        return null;
    }
    $doc = new DOMDocument();
    /* Without a charset hint libxml assumes Latin-1 and Arabic comes
       back as mojibake. The hint has to precede any content, and a
       duplicate meta later in the real markup is harmless. */
    $ok = @$doc->loadHTML(
        '<?xml encoding="UTF-8">' . $html,
        LIBXML_NOWARNING | LIBXML_NOERROR | LIBXML_NONET
    );
    return $ok ? $doc : null;
}

function omq_scrape_meta(DOMXPath $xpath, string $attr, string $name): ?string
{
    $nodes = $xpath->query(sprintf('//meta[@%s="%s"]/@content', $attr, $name));
    if ($nodes === false || $nodes->length === 0) {
        return null;
    }
    $value = trim($nodes->item(0)->nodeValue ?? '');
    return $value === '' ? null : $value;
}

/* Elements that end a line. DOM `textContent` runs every text node
   together, so two paragraphs come back as one word joined at the
   seam — "…the end.The next…". Walking the tree and breaking at block
   boundaries is what turns markup back into something readable. */
const OMQ_SCRAPE_BLOCKS = [
    'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl',
    'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2',
    'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
    'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
];

function omq_scrape_text(DOMNode $node): string
{
    if ($node->nodeType === XML_TEXT_NODE || $node->nodeType === XML_CDATA_SECTION_NODE) {
        /* Runs of whitespace inside one text node are indentation, not
           content — the markup decides where a line breaks. */
        return preg_replace('/\s+/u', ' ', (string) $node->nodeValue) ?? '';
    }
    if ($node->nodeType !== XML_ELEMENT_NODE) {
        return '';
    }

    $name = strtolower($node->nodeName);
    if ($name === 'br') {
        return "\n";
    }

    $out = '';
    foreach ($node->childNodes as $child) {
        $out .= omq_scrape_text($child);
    }

    /* A paragraph is a line. A <span> inside it is not. */
    return in_array($name, OMQ_SCRAPE_BLOCKS, true) ? "\n" . $out . "\n" : $out;
}

function omq_scrape_extract(string $html, string $url): array
{
    $doc = omq_scrape_dom($html);
    if ($doc === null) {
        return ['url' => $url, 'title' => null, 'text' => '', 'links' => [], 'images' => []];
    }
    $xpath = new DOMXPath($doc);

    $titles = $xpath->query('//title');
    $title  = ($titles && $titles->length) ? trim($titles->item(0)->textContent) : null;

    /* Script and style text is not content, and leaving it in is how a
       page's "text" ends up being mostly jQuery. */
    foreach (['script', 'style', 'noscript', 'template', 'svg'] as $tag) {
        $nodes = $doc->getElementsByTagName($tag);
        for ($i = $nodes->length - 1; $i >= 0; $i--) {
            $node = $nodes->item($i);
            if ($node && $node->parentNode) {
                $node->parentNode->removeChild($node);
            }
        }
    }

    /* The article body if the theme marks one, and progressively
       broader containers if it does not. WordPress themes almost
       always have .entry-content; the rest is for everything else. */
    $body = null;
    $candidates = [
        '//*[contains(concat(" ", normalize-space(@class), " "), " entry-content ")]',
        '//article',
        '//main',
        '//*[@id="content"]',
        '//body',
    ];
    foreach ($candidates as $query) {
        $nodes = $xpath->query($query);
        if ($nodes && $nodes->length) {
            $body = $nodes->item(0);
            break;
        }
    }

    $text = '';
    if ($body) {
        /* Trim each line, then collapse the runs of blank ones that
           every layout wrapper leaves behind. */
        $lines = array_map('trim', preg_split('/\n/', omq_scrape_text($body)) ?: []);
        $text  = trim(preg_replace('/\n{3,}/', "\n\n", implode("\n", $lines)) ?? '');
    }
    if (function_exists('mb_strlen') && mb_strlen($text) > OMQ_SCRAPE_TEXT_CAP) {
        $text = mb_substr($text, 0, OMQ_SCRAPE_TEXT_CAP) . '…';
    }

    $links = [];
    foreach ($xpath->query('//a/@href') ?: [] as $attr) {
        $abs = omq_scrape_absolute($url, $attr->nodeValue ?? '');
        if ($abs !== null) {
            $links[$abs] = true;
        }
    }

    $images = [];
    foreach ($xpath->query('//img/@src') ?: [] as $attr) {
        $abs = omq_scrape_absolute($url, $attr->nodeValue ?? '');
        if ($abs !== null) {
            $images[$abs] = true;
        }
    }

    return [
        'url'         => $url,
        'title'       => $title,
        'description' => omq_scrape_meta($xpath, 'name', 'description')
            ?? omq_scrape_meta($xpath, 'property', 'og:description'),
        'published'   => omq_scrape_meta($xpath, 'property', 'article:published_time'),
        'modified'    => omq_scrape_meta($xpath, 'property', 'article:modified_time'),
        'text'        => $text,
        'links'       => array_keys($links),
        'images'      => array_keys($images),
    ];
}

/* ============================================================
   Actions
   ============================================================ */

$user = omq_require_user();
omq_scrape_lock($user['email']);

$action = $_GET['action'] ?? '';
$body   = omq_scrape_body();

$cookie = trim((string) ($body['cookie'] ?? ''));
$cookie = $cookie === '' ? null : $cookie;

$delay = (float) ($body['delay'] ?? 1.5);
$delay = max(0.0, min($delay, OMQ_SCRAPE_MAX_DELAY));

/* The rules the browser was given by `probe`, handed back on each
   call. Re-checked here rather than trusted as a verdict: the client
   deciding what it is allowed to fetch is not a check. */
$rules  = is_array($body['rules'] ?? null) ? $body['rules'] : [];
$group  = ['agents' => [], 'rules' => [], 'delay' => null];
foreach ($rules as $rule) {
    if (is_array($rule) && isset($rule['path'])) {
        $group['rules'][] = ['allow' => !empty($rule['allow']), 'path' => (string) $rule['path']];
    }
}
$obeyRobots = ($body['obeyRobots'] ?? true) !== false;

function omq_scrape_permitted(string $url, array $group, bool $obey): bool
{
    return !$obey || omq_robots_allows($group, $url);
}

try {
    switch ($action) {
        /* ---------- what is there ----------
           robots.txt, whether the WordPress REST API answers, and
           which sitemap the site actually uses. One round trip so the
           page can show the plan before committing to a crawl. */
        case 'probe': {
            $site = omq_normalize_url((string) ($body['site'] ?? ''));
            $parts = parse_url($site);
            $origin = $parts['scheme'] . '://' . $parts['host']
                . (isset($parts['port']) ? ':' . $parts['port'] : '');

            $report = [
                'origin'    => $origin,
                'robots'    => ['found' => false, 'rules' => [], 'crawlDelay' => null, 'sitemaps' => []],
                'endpoints' => [],
                'sitemaps'  => [],
                'notes'     => [],
            ];

            /* robots.txt is exempt from its own delay — it is the file
               that tells us what the delay should be. */
            try {
                $res = omq_scrape_get($origin . '/robots.txt', $cookie);
                if ($res['status'] === 200 && stripos($res['headers']['content-type'] ?? '', 'html') === false) {
                    $robots = omq_robots_parse($res['body']);
                    $mine   = omq_robots_group($robots, OMQ_SCRAPE_UA);
                    $report['robots'] = [
                        'found'      => true,
                        'rules'      => $mine['rules'],
                        'crawlDelay' => $mine['delay'],
                        'sitemaps'   => $robots['sitemaps'],
                    ];
                    $group = $mine;
                } else {
                    $report['notes'][] = 'No robots.txt — nothing is excluded.';
                }
            } catch (InvalidArgumentException $e) {
                $report['notes'][] = 'robots.txt could not be read: ' . $e->getMessage();
            }

            /* Custom post types as well as the built-in collections —
               most WordPress sites of any age have some, and they hold
               content the standard endpoints do not return. */
            $wanted = ['posts', 'pages', 'categories', 'tags', 'comments', 'media', 'users'];
            $typesUrl = $origin . '/wp-json/wp/v2/types';
            if (omq_scrape_permitted($typesUrl, $group, $obeyRobots)) {
                try {
                    $res = omq_scrape_get($typesUrl, $cookie, $delay);
                    if ($res['status'] === 200) {
                        $types = json_decode($res['body'], true);
                        foreach (is_array($types) ? $types : [] as $type) {
                            $rest = $type['rest_base'] ?? null;
                            if (is_string($rest) && $rest !== '' && !in_array($rest, $wanted, true)) {
                                $wanted[] = $rest;
                            }
                        }
                        $report['endpoints'] = $wanted;
                    } else {
                        $report['notes'][] = 'No WordPress REST API here (HTTP ' . $res['status'] . ').';
                    }
                } catch (InvalidArgumentException $e) {
                    $report['notes'][] = 'REST API check failed: ' . $e->getMessage();
                }
            }

            /* Whatever robots.txt advertises first, then the three
               conventional names. Stops at the first that answers. */
            $candidates = array_merge($report['robots']['sitemaps'], [
                $origin . '/wp-sitemap.xml',
                $origin . '/sitemap_index.xml',
                $origin . '/sitemap.xml',
            ]);
            foreach (array_unique($candidates) as $candidate) {
                if (!omq_scrape_permitted($candidate, $group, $obeyRobots)) {
                    continue;
                }
                try {
                    $res = omq_scrape_get($candidate, $cookie, $delay);
                } catch (InvalidArgumentException $e) {
                    continue;
                }
                if ($res['status'] === 200 && strpos($res['body'], '<') !== false) {
                    $report['sitemaps'][] = $candidate;
                    break;
                }
            }
            if (!$report['sitemaps']) {
                $report['notes'][] = 'No sitemap found — only the REST API can be listed.';
            }

            omq_scrape_send($report);
        }

        /* ---------- one page of one REST collection ----------
           X-WP-TotalPages is how the browser knows when to stop; it is
           returned rather than inferred, because an empty page can
           also mean the collection is private. */
        case 'api': {
            $site     = omq_normalize_url((string) ($body['site'] ?? ''));
            $endpoint = preg_replace('/[^a-z0-9_-]/i', '', (string) ($body['endpoint'] ?? ''));
            $page     = max(1, (int) ($body['page'] ?? 1));

            if ($endpoint === '') {
                omq_fail(400, 'No endpoint named.');
            }

            $parts = parse_url($site);
            $url = $parts['scheme'] . '://' . $parts['host']
                . (isset($parts['port']) ? ':' . $parts['port'] : '')
                . '/wp-json/wp/v2/' . $endpoint . '?per_page=100&page=' . $page;

            if (!omq_scrape_permitted($url, $group, $obeyRobots)) {
                omq_scrape_send(['status' => 0, 'blocked' => true, 'items' => [], 'totalPages' => 0]);
            }

            $res   = omq_scrape_get($url, $cookie, $delay);
            $items = $res['status'] === 200 ? json_decode($res['body'], true) : null;

            omq_scrape_send([
                'status'     => $res['status'],
                'items'      => is_array($items) ? $items : [],
                'totalPages' => (int) ($res['headers']['x-wp-totalpages'] ?? 0),
                'total'      => (int) ($res['headers']['x-wp-total'] ?? 0),
            ]);
        }

        /* ---------- one sitemap ----------
           An index returns its children and no URLs; the browser walks
           them. Recursing here instead would put an unbounded number
           of fetches inside one request, which is the thing this whole
           design avoids. */
        case 'sitemap': {
            $url = omq_normalize_url((string) ($body['url'] ?? ''));

            if (!omq_scrape_permitted($url, $group, $obeyRobots)) {
                omq_scrape_send(['status' => 0, 'blocked' => true, 'children' => [], 'urls' => []]);
            }

            $res = omq_scrape_get($url, $cookie, $delay);
            $children = [];
            $urls     = [];

            if ($res['status'] === 200) {
                $previous = libxml_use_internal_errors(true);
                $xml = simplexml_load_string($res['body'], 'SimpleXMLElement', LIBXML_NOCDATA | LIBXML_NONET);
                libxml_clear_errors();
                libxml_use_internal_errors($previous);

                if ($xml !== false) {
                    foreach ($xml->sitemap as $entry) {
                        $loc = trim((string) $entry->loc);
                        if ($loc !== '') {
                            $children[] = $loc;
                        }
                    }
                    foreach ($xml->url as $entry) {
                        $loc = trim((string) $entry->loc);
                        if ($loc !== '') {
                            $lastmod = trim((string) $entry->lastmod);
                            $urls[] = ['url' => $loc, 'lastmod' => $lastmod === '' ? null : $lastmod];
                        }
                    }
                }
            }

            omq_scrape_send([
                'status'   => $res['status'],
                'children' => $children,
                'urls'     => $urls,
            ]);
        }

        /* ---------- a handful of pages ----------
           Capped per request so a batch always finishes well inside
           max_execution_time, delay included. */
        case 'pages': {
            $wanted = is_array($body['urls'] ?? null) ? $body['urls'] : [];
            if (!$wanted) {
                omq_fail(400, 'No URLs given.');
            }
            $wanted = array_slice($wanted, 0, OMQ_SCRAPE_BATCH);

            $pages = [];
            foreach ($wanted as $raw) {
                $url = trim((string) $raw);
                try {
                    $url = omq_normalize_url($url);
                } catch (InvalidArgumentException $e) {
                    $pages[] = ['url' => $url, 'status' => 0, 'error' => $e->getMessage()];
                    continue;
                }

                if (!omq_scrape_permitted($url, $group, $obeyRobots)) {
                    $pages[] = ['url' => $url, 'status' => 0, 'blocked' => true];
                    continue;
                }

                try {
                    $res = omq_scrape_get($url, $cookie, $delay);
                } catch (InvalidArgumentException $e) {
                    $pages[] = ['url' => $url, 'status' => 0, 'error' => $e->getMessage()];
                    continue;
                }

                if ($res['status'] !== 200) {
                    $pages[] = ['url' => $url, 'status' => $res['status']];
                    continue;
                }

                /* A PDF or an image has no text to pull out, and
                   running the HTML parser over one wastes the fetch we
                   already paid for on nothing. */
                $type = strtolower($res['headers']['content-type'] ?? '');
                if ($type !== '' && strpos($type, 'html') === false) {
                    $pages[] = ['url' => $url, 'status' => 200, 'skipped' => $type];
                    continue;
                }

                $page = omq_scrape_extract($res['body'], $res['url']);
                $page['status'] = 200;
                $pages[] = $page;
            }

            omq_scrape_send(['pages' => $pages]);
        }

        default:
            omq_fail(400, 'Unknown action.');
    }
} catch (InvalidArgumentException $e) {
    omq_fail(422, $e->getMessage());
}
