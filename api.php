<?php
/* ============================================================
   OMQ Short Links — admin API.

     GET  api.php?action=list
     POST api.php?action=create   {url, code?, label?}
     POST api.php?action=update   {code, url?, label?}
     POST api.php?action=delete   {code}

   Every action requires a Google ID token for an allowed domain:
     Authorization: Bearer <id_token>
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/auth.php';

$config = omq_config();

/* The UI is served from this same document root, so there is no CORS
   to configure and no preflight to answer. A cross-origin caller gets
   no Access-Control-Allow-Origin header and the browser stops it. */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function omq_send(array $payload): void
{
    echo json_encode($payload);
    exit;
}

function omq_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function omq_row(array $row, string $base): array
{
    return [
        'code'    => $row['code'],
        'url'     => $row['url'],
        'label'   => $row['label'],
        'short'   => $base . $row['code'],
        'created' => $row['created_at'],
        'by'      => $row['created_by'],
        'hits'    => (int) $row['hits'],
        'lastHit' => $row['last_hit_at'],
    ];
}

$action = $_GET['action'] ?? '';

/* The one unauthenticated action: the browser cannot sign in until it
   knows the Google client ID, so it cannot have signed in to ask.

   Everything returned here is public by nature — it is what would be
   embedded in the page source anyway. Serving it from config.php
   rather than a committed config.js means a deployment has exactly
   one file to edit, and that file is gitignored, so `git pull` never
   collides with a local change. */
if ($action === 'config') {
    echo json_encode([
        'googleClientId' => $config['google_client_id'],
        'allowedDomain'  => $config['allowed_domains'][0] ?? '',
        'shortBase'      => $config['short_base'],
    ]);
    exit;
}

$user = omq_require_user();
$pdo  = omq_db();
$base = $config['short_base'];
$now  = gmdate('Y-m-d H:i:s');

try {
    switch ($action) {
        /* Cheapest way to ask "will this account be allowed?". Holding a
           Google token is not the same as being permitted here, and the
           difference should surface at sign-in, not on the first write. */
        case 'me': {
            omq_send(['user' => $user, 'base' => $base]);
        }

        case 'list': {
            $stmt = $pdo->prepare(
                'SELECT * FROM `links` WHERE `created_by` = ? ORDER BY `created_at` DESC'
            );
            $stmt->execute([$user['email']]);
            omq_send([
                'user'  => $user,
                'base'  => $base,
                'links' => array_map(static fn(array $r): array => omq_row($r, $base), $stmt->fetchAll()),
            ]);
        }

        case 'create': {
            $body  = omq_body();
            $url   = omq_normalize_url((string) ($body['url'] ?? ''));
            $label = omq_clip((string) ($body['label'] ?? ''), 255);

            $custom = trim((string) ($body['code'] ?? ''));
            $code   = $custom !== '' ? omq_validate_code($custom) : omq_make_code($pdo);

            $stmt = $pdo->prepare(
                'INSERT INTO `links` (`code`, `url`, `label`, `created_at`, `created_by`)
                 VALUES (?, ?, ?, ?, ?)'
            );
            try {
                $stmt->execute([$code, $url, $label, $now, $user['email']]);
            } catch (PDOException $e) {
                /* 23000 is the duplicate-key class: someone took the
                   code between validation and insert, or typed one
                   that already exists. */
                if ($e->getCode() === '23000') {
                    omq_fail(409, "\"$code\" is already taken.");
                }
                throw $e;
            }

            $stmt = $pdo->prepare('SELECT * FROM `links` WHERE `code` = ? AND `created_by` = ?');
            $stmt->execute([$code, $user['email']]);
            omq_send(['link' => omq_row($stmt->fetch(), $base)]);
        }

        case 'update': {
            $body = omq_body();
            $code = omq_validate_code((string) ($body['code'] ?? ''));

            $sets = [];
            $args = [];
            if (array_key_exists('url', $body)) {
                $sets[] = '`url` = ?';
                $args[] = omq_normalize_url((string) $body['url']);
            }
            if (array_key_exists('label', $body)) {
                $sets[] = '`label` = ?';
                $args[] = omq_clip((string) $body['label'], 255);
            }
            if (!$sets) {
                omq_fail(400, 'Nothing to update.');
            }

            $sets[] = '`updated_at` = ?';
            $args[] = $now;
            $sets[] = '`updated_by` = ?';
            $args[] = $user['email'];
            $args[] = $code;
            $args[] = $user['email'];

            /* Ownership is enforced in the WHERE clause, not by having
               listed the link earlier: codes are short and public, so
               anyone could name one they do not own. */
            $stmt = $pdo->prepare(
                'UPDATE `links` SET ' . implode(', ', $sets) . ' WHERE `code` = ? AND `created_by` = ?'
            );
            $stmt->execute($args);

            /* MySQL reports 0 affected rows when the new values match
               the old ones, so a miss here is not proof of absence —
               look the row up before deciding. */
            $stmt = $pdo->prepare('SELECT * FROM `links` WHERE `code` = ? AND `created_by` = ?');
            $stmt->execute([$code, $user['email']]);
            $row = $stmt->fetch();
            if (!$row) {
                /* Same answer whether it belongs to someone else or does
                   not exist — otherwise this doubles as a way to probe
                   which codes are taken. */
                omq_fail(404, "You have no link \"$code\".");
            }
            omq_send(['link' => omq_row($row, $base)]);
        }

        case 'delete': {
            $body = omq_body();
            $code = omq_validate_code((string) ($body['code'] ?? ''));

            $stmt = $pdo->prepare('DELETE FROM `links` WHERE `code` = ? AND `created_by` = ?');
            $stmt->execute([$code, $user['email']]);
            if ($stmt->rowCount() === 0) {
                omq_fail(404, "You have no link \"$code\".");
            }
            omq_send(['deleted' => $code]);
        }

        default:
            omq_fail(400, 'Unknown action.');
    }
} catch (InvalidArgumentException $e) {
    omq_fail(422, $e->getMessage());
} catch (PDOException $e) {
    error_log('OMQ short links: ' . $e->getMessage());
    omq_fail(500, 'The database refused that. Try again.');
}
