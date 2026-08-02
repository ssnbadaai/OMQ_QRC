<?php
/* ============================================================
   Brand Kit — logos, fonts, colours, templates and icons.

     GET  assets.php?action=list
     POST assets.php?action=upload   multipart: kind, name, notes, file
     POST assets.php?action=colour   {name, value, notes}
     POST assets.php?action=delete   {id}

   Every action needs a Google ID token for an allowed domain:
     Authorization: Bearer <id_token>

   Assets are shared, not per-account. A brand library exists so that
   everyone uses the same approved files; scoping it per person would
   defeat it. Short links are the opposite case and stay private.
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';
require_once __DIR__ . '/auth.php';

const OMQ_ASSET_DIR = __DIR__ . '/assets';

/* What each kind may contain. An upload is accepted only if its
   extension appears here, so nothing executable can be stored whatever
   the browser claims the MIME type is. */
const OMQ_ALLOWED = [
    'logo'     => ['svg', 'png', 'jpg', 'jpeg', 'webp', 'pdf', 'eps', 'ai'],
    'icon'     => ['svg', 'png', 'webp'],
    'template' => ['pdf', 'png', 'jpg', 'jpeg', 'svg', 'ai', 'psd', 'indd', 'sketch', 'fig', 'zip'],
    'font'     => ['woff2', 'woff', 'ttf', 'otf'],
    /* Card photos. Stored here because an emailed image has to sit at a
       public URL — mail clients refuse data: URIs — not because they
       belong in the brand library. brand.html has no tab for them. */
    'photo'    => ['png', 'jpg', 'jpeg', 'webp', 'gif'],
];

const OMQ_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

$config = omq_config();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function omq_send(array $payload): void
{
    echo json_encode($payload);
    exit;
}

function omq_body(): array
{
    $data = json_decode(file_get_contents('php://input') ?: '', true);
    return is_array($data) ? $data : [];
}

function omq_asset_row(array $r): array
{
    return [
        'id'       => (int) $r['id'],
        'kind'     => $r['kind'],
        'name'     => $r['name'],
        'value'    => $r['value'],
        'url'      => $r['file'] !== '' ? 'assets/' . rawurlencode($r['file']) : '',
        'original' => $r['original'],
        'mime'     => $r['mime'],
        'bytes'    => (int) $r['bytes'],
        'notes'    => $r['notes'],
        'created'  => $r['created_at'],
        'by'       => $r['created_by'],
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
            $rows = $pdo->query(
                'SELECT * FROM `assets` ORDER BY `kind`, `name`'
            )->fetchAll();
            omq_send(['assets' => array_map('omq_asset_row', $rows)]);
        }

        case 'colour': {
            $body = omq_body();
            $name = omq_clip((string) ($body['name'] ?? ''), 160);
            $hex  = strtoupper(trim((string) ($body['value'] ?? '')));

            if ($name === '') {
                throw new InvalidArgumentException('Give the colour a name.');
            }
            if (!preg_match('/^#?[0-9A-F]{6}$/', $hex)) {
                throw new InvalidArgumentException('Use a 6-digit hex colour, e.g. #4361EE.');
            }
            if ($hex[0] !== '#') {
                $hex = '#' . $hex;
            }

            $stmt = $pdo->prepare(
                'INSERT INTO `assets` (`kind`,`name`,`value`,`notes`,`created_at`,`created_by`)
                 VALUES (\'colour\', ?, ?, ?, ?, ?)'
            );
            $stmt->execute([$name, $hex, omq_clip((string) ($body['notes'] ?? ''), 255), $now, $user['email']]);

            $stmt = $pdo->prepare('SELECT * FROM `assets` WHERE `id` = ?');
            $stmt->execute([$pdo->lastInsertId()]);
            omq_send(['asset' => omq_asset_row($stmt->fetch())]);
        }

        case 'upload': {
            $kind = (string) ($_POST['kind'] ?? '');
            if (!isset(OMQ_ALLOWED[$kind])) {
                throw new InvalidArgumentException('Unknown asset type.');
            }
            if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
                throw new InvalidArgumentException('No file was uploaded.');
            }

            $file = $_FILES['file'];
            if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
                /* The two size errors are worth naming; the rest are
                   server problems the user cannot act on. */
                $why = in_array($file['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)
                    ? 'That file is too large.'
                    : 'The upload did not complete.';
                throw new InvalidArgumentException($why);
            }
            if ($file['size'] > OMQ_MAX_BYTES) {
                throw new InvalidArgumentException('Files are limited to 20 MB.');
            }
            /* Proves the file really came through PHP's upload handling
               and is not an arbitrary path supplied by the caller. */
            if (!is_uploaded_file($file['tmp_name'])) {
                throw new InvalidArgumentException('That upload was not accepted.');
            }

            $ext = strtolower(pathinfo((string) $file['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, OMQ_ALLOWED[$kind], true)) {
                throw new InvalidArgumentException(
                    strtoupper($ext ?: 'that file') . ' is not allowed for ' . $kind . 's. Use: '
                    . implode(', ', OMQ_ALLOWED[$kind]) . '.'
                );
            }

            if (!is_dir(OMQ_ASSET_DIR) && !mkdir(OMQ_ASSET_DIR, 0755, true) && !is_dir(OMQ_ASSET_DIR)) {
                omq_fail(500, 'The assets folder could not be created.');
            }

            /* Randomised, so a stored name can never be steered by the
               uploader and one asset cannot be guessed from another. */
            $stored = bin2hex(random_bytes(8)) . '.' . $ext;
            if (!move_uploaded_file($file['tmp_name'], OMQ_ASSET_DIR . '/' . $stored)) {
                omq_fail(500, 'The file could not be saved.');
            }
            @chmod(OMQ_ASSET_DIR . '/' . $stored, 0644);

            $name = omq_clip((string) ($_POST['name'] ?? ''), 160);
            if ($name === '') {
                $name = pathinfo((string) $file['name'], PATHINFO_FILENAME);
            }

            $stmt = $pdo->prepare(
                'INSERT INTO `assets`
                 (`kind`,`name`,`file`,`original`,`mime`,`bytes`,`notes`,`created_at`,`created_by`)
                 VALUES (?,?,?,?,?,?,?,?,?)'
            );
            $stmt->execute([
                $kind,
                $name,
                $stored,
                omq_clip((string) $file['name'], 200),
                omq_clip((string) ($file['type'] ?? ''), 100),
                (int) $file['size'],
                omq_clip((string) ($_POST['notes'] ?? ''), 255),
                $now,
                $user['email'],
            ]);

            $stmt = $pdo->prepare('SELECT * FROM `assets` WHERE `id` = ?');
            $stmt->execute([$pdo->lastInsertId()]);
            omq_send(['asset' => omq_asset_row($stmt->fetch())]);
        }

        case 'delete': {
            $id = (int) (omq_body()['id'] ?? 0);
            if ($id <= 0) {
                throw new InvalidArgumentException('Which asset?');
            }

            $stmt = $pdo->prepare('SELECT * FROM `assets` WHERE `id` = ?');
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row) {
                omq_fail(404, 'That asset no longer exists.');
            }

            $pdo->prepare('DELETE FROM `assets` WHERE `id` = ?')->execute([$id]);

            /* basename() keeps a crafted stored name from reaching out of
               the assets folder, however it got into the database. */
            if ($row['file'] !== '') {
                @unlink(OMQ_ASSET_DIR . '/' . basename((string) $row['file']));
            }
            omq_send(['deleted' => $id]);
        }

        default:
            omq_fail(400, 'Unknown action.');
    }
} catch (InvalidArgumentException $e) {
    omq_fail(422, $e->getMessage());
} catch (PDOException $e) {
    error_log('OMQ brand kit: ' . $e->getMessage());
    omq_fail(500, 'The database refused that. The server error log has the detail.');
}
