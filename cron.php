<?php
/* ============================================================
   Nightly maintenance.

     php cron.php            back up, then report orphans
     php cron.php --delete   the same, but actually remove them

   Command line only. This deletes files and reads the whole database,
   and there is no reason for it to be reachable over HTTP — so rather
   than guarding it with a token that could leak, it simply refuses to
   run unless PHP was invoked from a shell.

   In cPanel → Cron Jobs:
     /usr/local/bin/php /home/USER/qr.omqpro.com/cron.php --delete
   ============================================================ */

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/lib.php';

const BACKUP_DIR = __DIR__ . '/backups';
const ASSET_DIR  = __DIR__ . '/assets';
const KEEP_DAYS  = 30;

$deleting = in_array('--delete', $argv, true);
$pdo = omq_db();
omq_ensure_schema();

function out(string $line): void
{
    echo date('Y-m-d H:i:s') . '  ' . $line . "\n";
}

/* ============================================================
   Backup

   Short links are the part that cannot be reconstructed. Every QR
   code printed, every link pasted into an email, resolves through one
   row — losing the table breaks all of them at once, and nothing on
   the site would tell you until someone scanned a code.

   JSON rather than SQL: it restores into anything, and it is readable
   without a database if the worst has happened.
   ============================================================ */
function backup(PDO $pdo): void
{
    if (!is_dir(BACKUP_DIR) && !mkdir(BACKUP_DIR, 0700, true) && !is_dir(BACKUP_DIR)) {
        out('FAILED: could not create ' . BACKUP_DIR);
        return;
    }

    $data = [
        'taken'  => gmdate('c'),
        'links'  => $pdo->query('SELECT * FROM `links` ORDER BY `created_at`')->fetchAll(),
        'assets' => $pdo->query('SELECT * FROM `assets` ORDER BY `id`')->fetchAll(),
    ];

    $path = BACKUP_DIR . '/omq-' . gmdate('Y-m-d') . '.json';
    $written = file_put_contents(
        $path,
        json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
    );

    if ($written === false) {
        out('FAILED: could not write ' . $path);
        return;
    }

    out(sprintf(
        'backup: %d links, %d assets, %s',
        count($data['links']),
        count($data['assets']),
        number_format($written / 1024, 1) . ' KB'
    ));

    /* Keep a month. Enough to notice a bad deletion and go back for it,
       without the folder growing forever. */
    $cutoff = time() - KEEP_DAYS * 86400;
    $removed = 0;
    foreach (glob(BACKUP_DIR . '/omq-*.json') ?: [] as $old) {
        if (filemtime($old) < $cutoff) {
            unlink($old);
            $removed++;
        }
    }
    if ($removed) {
        out("backup: pruned $removed older than " . KEEP_DAYS . ' days');
    }
}

/* ============================================================
   Sweep

   Uploads and rows can come apart in both directions: a request that
   dies between move_uploaded_file and the INSERT leaves a file with
   no row, and a file removed by hand leaves a row pointing nowhere.
   Both are reported; only the first is safe to delete automatically,
   since a missing file may just mean a restore is half-finished.
   ============================================================ */
function sweep(PDO $pdo, bool $deleting): void
{
    if (!is_dir(ASSET_DIR)) {
        out('sweep: no assets folder yet');
        return;
    }

    $known = [];
    foreach ($pdo->query('SELECT `file` FROM `assets` WHERE `file` <> \'\'') as $row) {
        $known[$row['file']] = true;
    }

    $orphans = [];
    $bytes = 0;
    foreach (scandir(ASSET_DIR) ?: [] as $name) {
        if ($name === '.' || $name === '..' || $name[0] === '.') {
            continue; // .htaccess and .gitignore belong here
        }
        if (!is_file(ASSET_DIR . '/' . $name) || isset($known[$name])) {
            continue;
        }
        /* Anything written in the last hour may belong to a request
           that has not finished yet. */
        if (time() - filemtime(ASSET_DIR . '/' . $name) < 3600) {
            continue;
        }
        $orphans[] = $name;
        $bytes += filesize(ASSET_DIR . '/' . $name);
    }

    if (!$orphans) {
        out('sweep: no orphaned files');
    } else {
        out(sprintf(
            'sweep: %d orphaned file(s), %s%s',
            count($orphans),
            number_format($bytes / 1048576, 2) . ' MB',
            $deleting ? '' : ' — run with --delete to remove'
        ));
        foreach ($orphans as $name) {
            if ($deleting) {
                unlink(ASSET_DIR . '/' . basename($name));
            }
            out('  ' . ($deleting ? 'deleted ' : 'orphan  ') . $name);
        }
    }

    /* The other direction. Never deleted automatically — a row is the
       only record that the asset ever existed. */
    $missing = 0;
    foreach ($pdo->query('SELECT `id`, `name`, `file` FROM `assets` WHERE `file` <> \'\'') as $row) {
        if (!is_file(ASSET_DIR . '/' . $row['file'])) {
            $missing++;
            out(sprintf('  MISSING file for asset %d (%s)', $row['id'], $row['name']));
        }
    }
    if ($missing) {
        out("sweep: $missing row(s) point at a file that is gone");
    }
}

out('--- maintenance start' . ($deleting ? ' (deleting)' : ' (dry run)') . ' ---');
backup($pdo);
sweep($pdo, $deleting);
out('--- done ---');
