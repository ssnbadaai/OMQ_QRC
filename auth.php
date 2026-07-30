<?php
/* ============================================================
   Google sign-in.

   The browser sends the ID token Google issued it as a bearer
   token on every request. Nothing is trusted from the client
   beyond that string: the token is validated by Google, and the
   `hd` claim it carries is what decides whether the caller is an
   @omqpro.com person. There is no session cookie, so there is
   nothing to fixate and no CSRF surface.
   ============================================================ */

declare(strict_types=1);

require_once __DIR__ . '/lib.php';

/* Validation is delegated to Google's tokeninfo endpoint rather than
   verifying RS256 locally. It costs one HTTPS call per cold token —
   cached below for the token's remaining life — and removes any
   chance of a subtle signature-checking bug in code that would
   otherwise guard every write. */
const OMQ_TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo?id_token=';

function omq_bearer_token(): string
{
    $header = '';
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $key) {
        if (!empty($_SERVER[$key])) {
            $header = $_SERVER[$key];
            break;
        }
    }
    /* Some cPanel/Apache setups strip the header unless mod_rewrite
       puts it back; .htaccess does that, this is the fallback. */
    if ($header === '' && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) {
                $header = $value;
                break;
            }
        }
    }

    if (!preg_match('/^Bearer\s+(\S+)$/i', trim($header), $m)) {
        omq_fail(401, 'Sign in to continue.');
    }
    return $m[1];
}

function omq_cache_path(string $token): string
{
    return sys_get_temp_dir() . '/omq-idtoken-' . hash('sha256', $token) . '.json';
}

function omq_fetch_tokeninfo(string $token): array
{
    $url = OMQ_TOKENINFO . urlencode($token);
    $body = false;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($body === false || $status !== 200) {
            $body = false;
        }
    } else {
        $body = @file_get_contents($url, false, stream_context_create([
            'http' => ['timeout' => 10, 'ignore_errors' => true],
            'ssl'  => ['verify_peer' => true, 'verify_peer_name' => true],
        ]));
    }

    if ($body === false) {
        omq_fail(401, 'Could not check that sign-in with Google. Try again.');
    }

    $claims = json_decode((string) $body, true);
    if (!is_array($claims) || isset($claims['error']) || isset($claims['error_description'])) {
        omq_fail(401, 'That sign-in has expired. Sign in again.');
    }
    return $claims;
}

/* Returns the verified caller, or ends the request with 401/403. */
function omq_require_user(): array
{
    $config = omq_config();
    $token  = omq_bearer_token();
    $now    = time();

    /* A token is good for about an hour; re-asking Google on every
       keystroke-driven request would be pointless latency. */
    $cache = omq_cache_path($token);
    $claims = null;
    if (is_file($cache)) {
        $cached = json_decode((string) @file_get_contents($cache), true);
        if (is_array($cached) && isset($cached['exp']) && (int) $cached['exp'] > $now + 30) {
            $claims = $cached;
        } else {
            @unlink($cache);
        }
    }

    if ($claims === null) {
        $claims = omq_fetch_tokeninfo($token);

        if (!isset($claims['exp']) || (int) $claims['exp'] <= $now) {
            omq_fail(401, 'That sign-in has expired. Sign in again.');
        }
        /* The token must have been minted for *this* application.
           Without this check any Google ID token from any site would
           be accepted. */
        if (!isset($claims['aud']) || !hash_equals((string) $config['google_client_id'], (string) $claims['aud'])) {
            omq_fail(401, 'That sign-in was issued for a different application.');
        }
        @file_put_contents($cache, json_encode($claims), LOCK_EX);
    }

    $email = strtolower((string) ($claims['email'] ?? ''));
    /* tokeninfo returns booleans as the strings "true"/"false". */
    $verified = ($claims['email_verified'] ?? 'false');
    if ($verified !== true && $verified !== 'true') {
        omq_fail(403, 'That Google account has no verified email address.');
    }

    /* `hd` is set by Google only for Workspace accounts, and only to
       the domain that actually administers the account. Matching on
       the email suffix alone would let a personal account named
       someone@omqpro.com through; `hd` cannot be spoofed. */
    $domain  = strtolower((string) ($claims['hd'] ?? ''));
    $allowed = array_map('strtolower', $config['allowed_domains'] ?? []);
    $people  = array_map('strtolower', $config['allowed_emails'] ?? []);

    /* A named list of people takes over completely rather than
       narrowing the domain rule. It has to: when the domain is not
       Workspace there is no `hd` to match, so a rule that required
       both would let nobody in at all. */
    $ok = $people
        ? in_array($email, $people, true)
        : ($domain !== '' && in_array($domain, $allowed, true));

    if (!$ok) {
        $who = $people ? 'approved accounts' : implode(' and ', $allowed) . ' accounts';
        omq_fail(403, 'Short links are limited to ' . $who . '.');
    }

    return [
        'email' => $email,
        'name'  => (string) ($claims['name'] ?? ''),
        'sub'   => (string) ($claims['sub'] ?? ''),
    ];
}
