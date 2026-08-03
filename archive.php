<?php
/* ============================================================
   Archives — a saved crawl, kept so it can be read back.

     GET  archive.php?action=list
     GET  archive.php?action=get&id=N     the whole archive, as stored
     POST archive.php?action=save         {name, archive:{…}}
     POST archive.php?action=rename       {id, name}
     POST archive.php?action=delete       {id}

   Every action needs a Google ID token for an allowed domain:
     Authorization: Bearer <id_token>

   Archives are shared, not per-account, for the same reason the brand
   library is: a crawl is a day of someone's patience and a lot of
   somebody else's bandwidth. Running it twice because the first copy
   was invisible to everyone but its owner is the outcome to avoid.

   The JSON lives on disk and only its description is in the database.
   A row holding megabytes makes every query that touches the table pay
   for it, and the list wants none of the content.
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/auth.php';

const OMQ_ARCHIVE_DIR = __DIR__ . '/archives';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function omq_send(array $payload): void
{
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function omq_body(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($data) ? $data : [];
}

function omq_archive_row(array $r): array
{
    return [
        'id'       => (int) $r['id'],
        'name'     => $r['name'],
        'site'     => $r['site'],
        'bytes'    => (int) $r['bytes'],
        'records'  => (int) $r['records'],
        'summary'  => $r['summary'],
        'complete' => (bool) (int) $r['complete'],
        'created'  => $r['created_at'],
        'by'       => $r['created_by'],
    ];
}

/* What is in it, in the words the list needs. Counting here rather
   than trusting a client-supplied figure keeps the list honest about
   what was actually stored. */
function omq_archive_describe(array $archive): array
{
    $parts   = [];
    $records = 0;

    foreach (($archive['api'] ?? []) as $name => $items) {
        if (is_array($items) && $items) {
            $records += count($items);
            $parts[] = count($items) . ' ' . $name;
        }
    }
    if (!empty($archive['pages']) && is_array($archive['pages'])) {
        $records += count($archive['pages']);
        $parts[] = count($archive['pages']) . ' pages of text';
    }
    if (!empty($archive['urls']) && is_array($archive['urls'])) {
        $parts[] = count($archive['urls']) . ' addresses';
    }

    return [
        'records' => $records,
        'summary' => omq_clip(implode(' · ', $parts), 255),
    ];
}

omq_ensure_schema();

$user   = omq_require_user();
$pdo    = omq_db();
$action = $_GET['action'] ?? '';
$now    = gmdate('Y-m-d H:i:s');

try {
    switch ($action) {
        case 'list': {
            $rows = $pdo->query('SELECT * FROM `archives` ORDER BY `created_at` DESC')->fetchAll();
            omq_send(['archives' => array_map('omq_archive_row', $rows)]);
        }

        /* Streamed rather than decoded and re-encoded: the file is
           already the JSON the reader wants, and parsing a 60 MB
           document here only to print it again would cost the memory
           limit for nothing. */
        case 'get': {
            /* Either a query parameter, so an archive can be linked to
               directly, or the JSON body the shared client sends. */
            $id = (int) ($_GET['id'] ?? omq_body()['id'] ?? 0);
            $stmt = $pdo->prepare('SELECT * FROM `archives` WHERE `id` = ?');
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row) {
                omq_fail(404, 'That archive no longer exists.');
            }

            $path = OMQ_ARCHIVE_DIR . '/' . basename((string) $row['file']);
            if (!is_file($path)) {
                omq_fail(410, 'The archive row is here but its file is gone.');
            }

            /* No Content-Length: with zlib.output_compression on — and
               it is, on plenty of cPanel builds — the figure would
               describe the file rather than the compressed body, and a
               browser that believes it truncates the archive. */
            readfile($path);
            exit;
        }

        case 'save': {
            omq_check_rate($pdo, 'archives', $user['email']);

            $body    = omq_body();
            $archive = $body['archive'] ?? null;
            if (!is_array($archive)) {
                throw new InvalidArgumentException('There is nothing to save.');
            }

            $site = (string) ($archive['site'] ?? '');
            $name = omq_clip((string) ($body['name'] ?? ''), 160);
            if ($name === '') {
                /* The host is a better default than "Untitled", and it
                   is what someone would have typed anyway. */
                $name = omq_clip(preg_replace('#^https?://#', '', $site) ?: 'Archive', 160);
            }

            $json = json_encode($archive, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($json === false) {
                throw new InvalidArgumentException('That archive could not be encoded.');
            }

            $bytes = strlen($json);
            if ($bytes > OMQ_ARCHIVE_MAX) {
                throw new InvalidArgumentException(sprintf(
                    'That archive is %.0f MB, past the %.0f MB limit for one archive.',
                    $bytes / 1048576,
                    OMQ_ARCHIVE_MAX / 1048576
                ));
            }
            omq_check_storage($pdo, $bytes, 'archives', OMQ_ARCHIVE_CAP, 'archive store');

            if (!is_dir(OMQ_ARCHIVE_DIR) && !mkdir(OMQ_ARCHIVE_DIR, 0755, true) && !is_dir(OMQ_ARCHIVE_DIR)) {
                omq_fail(500, 'The archives folder could not be created.');
            }

            /* Randomised: a stored name is never steered by a caller,
               and one archive cannot be guessed from another. */
            $stored = bin2hex(random_bytes(8)) . '.json';
            if (file_put_contents(OMQ_ARCHIVE_DIR . '/' . $stored, $json, LOCK_EX) === false) {
                omq_fail(500, 'The archive could not be written.');
            }
            @chmod(OMQ_ARCHIVE_DIR . '/' . $stored, 0644);

            $shape = omq_archive_describe($archive);

            $stmt = $pdo->prepare(
                'INSERT INTO `archives`
                 (`name`,`site`,`file`,`bytes`,`records`,`summary`,`complete`,`created_at`,`created_by`)
                 VALUES (?,?,?,?,?,?,?,?,?)'
            );
            $stmt->execute([
                $name,
                omq_clip($site, 255),
                $stored,
                $bytes,
                $shape['records'],
                $shape['summary'],
                !empty($archive['complete']) ? 1 : 0,
                $now,
                $user['email'],
            ]);

            $stmt = $pdo->prepare('SELECT * FROM `archives` WHERE `id` = ?');
            $stmt->execute([$pdo->lastInsertId()]);
            omq_send(['archive' => omq_archive_row($stmt->fetch())]);
        }

        case 'rename': {
            $body = omq_body();
            $id   = (int) ($body['id'] ?? 0);
            $name = omq_clip((string) ($body['name'] ?? ''), 160);
            if ($name === '') {
                throw new InvalidArgumentException('Give it a name.');
            }

            $pdo->prepare('UPDATE `archives` SET `name` = ? WHERE `id` = ?')->execute([$name, $id]);

            $stmt = $pdo->prepare('SELECT * FROM `archives` WHERE `id` = ?');
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row) {
                omq_fail(404, 'That archive no longer exists.');
            }
            omq_send(['archive' => omq_archive_row($row)]);
        }

        case 'delete': {
            $id = (int) (omq_body()['id'] ?? 0);
            if ($id <= 0) {
                throw new InvalidArgumentException('Which archive?');
            }

            $stmt = $pdo->prepare('SELECT * FROM `archives` WHERE `id` = ?');
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row) {
                omq_fail(404, 'That archive no longer exists.');
            }

            $pdo->prepare('DELETE FROM `archives` WHERE `id` = ?')->execute([$id]);

            /* basename() keeps a crafted stored name from reaching out
               of the archives folder, however it got into the row. */
            @unlink(OMQ_ARCHIVE_DIR . '/' . basename((string) $row['file']));
            omq_send(['deleted' => $id]);
        }

        default:
            omq_fail(400, 'Unknown action.');
    }
} catch (InvalidArgumentException $e) {
    omq_fail(422, $e->getMessage());
} catch (PDOException $e) {
    error_log('OMQ archives: ' . $e->getMessage());
    omq_fail(500, 'The database refused that. The server error log has the detail.');
}
