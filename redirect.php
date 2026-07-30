<?php
/* ============================================================
   OMQ Short Links — the redirect.

   .htaccess sends every path that is not a real file here, so
   qr.omqpro.com/abc12 arrives as code "abc12".

   This is the only part that runs on a public scan, so it does
   the least possible: one indexed lookup, one redirect.
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

$path = (string) parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
$code = strtolower(trim(rawurldecode($path), '/'));
/* Tolerate a trailing segment so /abc12/anything still resolves. */
if (strpos($code, '/') !== false) {
    $code = substr($code, 0, strpos($code, '/'));
}

/* Bare domain. DirectoryIndex normally serves index.html before this
   script is reached, so this only fires if that is missing. */
if ($code === '') {
    header('Location: /', true, 302);
    exit;
}

$url = null;
if (preg_match('/^[a-z0-9][a-z0-9-]{1,31}$/', $code)) {
    try {
        $pdo  = omq_db();
        $stmt = $pdo->prepare('SELECT `url` FROM `links` WHERE `code` = ?');
        $stmt->execute([$code]);
        $url = $stmt->fetchColumn() ?: null;

        if ($url !== null) {
            /* Best-effort: a scan must never fail because the counter did. */
            try {
                $hit = $pdo->prepare(
                    'UPDATE `links` SET `hits` = `hits` + 1, `last_hit_at` = ? WHERE `code` = ?'
                );
                $hit->execute([gmdate('Y-m-d H:i:s'), $code]);
            } catch (PDOException $e) {
                error_log('OMQ short links: hit count failed: ' . $e->getMessage());
            }
        }
    } catch (PDOException $e) {
        error_log('OMQ short links: lookup failed: ' . $e->getMessage());
    }
}

if ($url !== null) {
    /* 302, deliberately. A 301 is cached by browsers indefinitely, so
       re-pointing a link would not reach anyone who had already used
       it — which is the whole reason these links exist. */
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Location: ' . $url, true, 302);
    exit;
}

http_response_code(404);
header('Content-Type: text/html; charset=utf-8');
$shown = htmlspecialchars($code, ENT_QUOTES, 'UTF-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex" />
<title>Link not found — OMQ</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center;
    justify-content: center; padding: 24px; text-align: center;
    font-family: "Segoe UI", system-ui, -apple-system, Roboto, sans-serif;
    background: radial-gradient(1200px 600px at 80% -10%, #232a55 0%, #0f1220 55%);
    color: #eef0fa;
  }
  .card { max-width: 420px; width: 100%; }
  h1 { font-size: 20px; margin: 0 0 10px; }
  p { color: #9aa3c7; font-size: 14px; line-height: 1.6; margin: 0 0 20px; }
  code {
    background: #1f2440; border: 1px solid #2c3355; border-radius: 6px;
    padding: 2px 8px; font-size: 13px; color: #eef0fa;
  }
  a.btn {
    display: inline-block; background: #4361ee; color: #fff; text-decoration: none;
    padding: 12px 22px; border-radius: 9px; font-size: 15px; line-height: 22px;
  }
  a.btn:hover { background: #5573f5; }
</style>
</head>
<body>
  <div class="card">
    <h1>Link not found</h1>
    <p>
      There is no short link for <code><?= $shown ?></code>.<br />
      It may have been mistyped or removed.
    </p>
    <a class="btn" href="/">Go to OMQ Tools</a>
  </div>
</body>
</html>
