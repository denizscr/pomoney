<?php
/**
 * PRO MONEY — PHP Core Banking SQL & REST API Bridge
 *
 * Provides:
 *  - Parameterized PDO connectivity for SQLite (WAL) & PostgreSQL
 *  - Balanced double-entry reconciliation & central fund pool operations
 *  - Node.js Core Banking REST API cURL bridge
 *  - Timing-safe HMAC-SHA256 webhook signature verification
 *  - Clean JSON endpoint router (?action=health|pools|settings|transactions) & CLI support
 */

declare(strict_types=1);

final class ProMoneyCoreClient
{
    private PDO $pdo;
    private array $config;

    public function __construct(?array $config = null)
    {
        $this->config = $config ?? require __DIR__ . '/config.php';
        $this->pdo = $this->connect();
    }

    private function connect(): PDO
    {
        $driver = strtolower((string) ($this->config['db_driver'] ?? 'sqlite'));
        $options = [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ];

        if ($driver === 'pgsql') {
            $pg = $this->config['pgsql'];
            $dsn = sprintf(
                'pgsql:host=%s;port=%s;dbname=%s',
                $pg['host'],
                $pg['port'],
                $pg['database']
            );
            return new PDO($dsn, (string) $pg['user'], (string) $pg['password'], $options);
        }

        $sqlitePath = (string) $this->config['sqlite_path'];
        if (!is_file($sqlitePath)) {
            throw new RuntimeException('SQLite database file not found at configured path.');
        }
        $pdo = new PDO('sqlite:' . $sqlitePath, null, null, $options);
        $pdo->exec('PRAGMA busy_timeout = 5000;');
        $pdo->exec('PRAGMA foreign_keys = ON;');
        return $pdo;
    }

    public function getPdo(): PDO
    {
        return $this->pdo;
    }

    /**
     * Checks SQL connectivity and double-entry ledger balance (SUM(DEBIT) === SUM(CREDIT)).
     */
    public function healthCheck(): array
    {
        $debit = (float) ($this->pdo->query("SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE entry_type = 'DEBIT'")->fetchColumn() ?: 0);
        $credit = (float) ($this->pdo->query("SELECT COALESCE(SUM(amount), 0) FROM ledger_entries WHERE entry_type = 'CREDIT'")->fetchColumn() ?: 0);
        $poolCount = (int) ($this->pdo->query('SELECT COUNT(*) FROM central_fund_pools')->fetchColumn() ?: 0);
        $txCount = (int) ($this->pdo->query('SELECT COUNT(*) FROM transactions')->fetchColumn() ?: 0);
        $delta = round($debit - $credit, 2);

        return [
            'status' => abs($delta) < 0.01 ? 'HEALTHY' : 'IMBALANCE_DETECTED',
            'driver' => $this->config['db_driver'],
            'poolCount' => $poolCount,
            'transactionCount' => $txCount,
            'totalDebits' => round($debit, 2),
            'totalCredits' => round($credit, 2),
            'delta' => $delta,
            'isBalanced' => abs($delta) < 0.01,
            'checkedAt' => gmdate('c'),
        ];
    }

    public function listCentralPools(): array
    {
        $stmt = $this->pdo->query(
            'SELECT id, code, name, category, currency, balance, segregated, custodian_status, updated_at
             FROM central_fund_pools
             ORDER BY code ASC'
        );
        return $stmt->fetchAll();
    }

    public function listSystemSettings(): array
    {
        $stmt = $this->pdo->query(
            'SELECT key, label, enabled, fee_fixed, fee_percent, max_amount, updated_by, updated_at
             FROM system_operation_settings
             ORDER BY key ASC'
        );
        return $stmt->fetchAll();
    }

    public function listUserTransactions(string $userId, int $limit = 50): array
    {
        $safeLimit = max(1, min(200, $limit));
        $stmt = $this->pdo->prepare(
            'SELECT id, type, category, counterparty_name, direction, amount, fee, currency, status, reference, created_at
             FROM transactions
             WHERE user_id = :user_id
             ORDER BY created_at DESC
             LIMIT :limit'
        );
        $stmt->bindValue(':user_id', $userId, PDO::PARAM_STR);
        $stmt->bindValue(':limit', $safeLimit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /**
     * Executes an atomic, balanced double-entry inter-pool transfer directly via PDO.
     */
    public function transferBetweenPoolsInSql(
        string $actorUserId,
        string $fromPoolId,
        string $toPoolId,
        float $amount,
        string $reason
    ): array {
        if ($fromPoolId === $toPoolId) {
            throw new InvalidArgumentException('Source and destination pools must differ.');
        }
        if ($amount <= 0) {
            throw new InvalidArgumentException('Transfer amount must be positive.');
        }

        $this->pdo->beginTransaction();
        try {
            $poolStmt = $this->pdo->prepare('SELECT * FROM central_fund_pools WHERE id = :id');
            $poolStmt->execute([':id' => $fromPoolId]);
            $fromPool = $poolStmt->fetch();

            $poolStmt->execute([':id' => $toPoolId]);
            $toPool = $poolStmt->fetch();

            if (!$fromPool || !$toPool) {
                throw new RuntimeException('Pool not found.');
            }
            if ((float) $fromPool['balance'] < $amount) {
                throw new RuntimeException('Insufficient pool balance.');
            }

            $now = gmdate('c');
            $txId = 'tx_php_' . bin2hex(random_bytes(6));
            $idem = 'idem_php_' . bin2hex(random_bytes(6));
            $ref = 'PM-PHP-POOL-' . random_int(10000, 99999);
            $authCode = 'PHP-' . strtoupper(bin2hex(random_bytes(3)));

            $txInsert = $this->pdo->prepare(
                "INSERT INTO transactions
                 (id, idempotency_key, tenant_id, user_id, from_account_id, to_account_id, counterparty_name, counterparty_iban, type, category, amount, fee, currency, direction, status, reference, source, authorization_code, is_sandbox, created_at)
                 VALUES
                 (:id, :idem, 'tenant_promoney', :uid, NULL, NULL, :cname, :ciban, 'INTERNAL_TRANSFER', 'PHP Inter-Pool Transfer', :amt, 0, :cur, 'INTERNAL', 'COMPLETED', :ref, 'PHP_CORE_BRIDGE', :auth, 1, :now)"
            );
            $txInsert->execute([
                ':id' => $txId,
                ':idem' => $idem,
                ':uid' => $actorUserId,
                ':cname' => "Pool {$fromPool['code']} -> Pool {$toPool['code']}",
                ':ciban' => "POOL-{$fromPool['code']}-TO-{$toPool['code']}",
                ':amt' => $amount,
                ':cur' => $fromPool['currency'],
                ':ref' => $ref,
                ':auth' => $authCode,
                ':now' => $now,
            ]);

            $ldgInsert = $this->pdo->prepare(
                'INSERT INTO ledger_entries (id, transaction_id, account_id, pool_id, entry_type, amount, currency, description, created_at)
                 VALUES (:id, :txid, NULL, :pid, :etype, :amt, :cur, :desc, :now)'
            );

            $ldgInsert->execute([
                ':id' => 'ldg_php_' . bin2hex(random_bytes(5)),
                ':txid' => $txId,
                ':pid' => $fromPool['id'],
                ':etype' => 'DEBIT',
                ':amt' => $amount,
                ':cur' => $fromPool['currency'],
                ':desc' => "PHP Bridge Pool {$fromPool['code']} debit: {$reason}",
                ':now' => $now,
            ]);

            $ldgInsert->execute([
                ':id' => 'ldg_php_' . bin2hex(random_bytes(5)),
                ':txid' => $txId,
                ':pid' => $toPool['id'],
                ':etype' => 'CREDIT',
                ':amt' => $amount,
                ':cur' => $fromPool['currency'],
                ':desc' => "PHP Bridge Pool {$toPool['code']} credit: {$reason}",
                ':now' => $now,
            ]);

            $upd = $this->pdo->prepare('UPDATE central_fund_pools SET balance = ROUND(balance + :delta, 2), updated_at = :now WHERE id = :id');
            $upd->execute([':delta' => -$amount, ':now' => $now, ':id' => $fromPool['id']]);
            $upd->execute([':delta' => $amount, ':now' => $now, ':id' => $toPool['id']]);

            $this->pdo->commit();
            return ['transactionId' => $txId, 'reference' => $ref, 'amount' => $amount, 'currency' => $fromPool['currency']];
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Bridges an admin pool adjustment call to the Node.js Core Banking REST API.
     */
    public function adjustCentralPoolViaApi(
        string $bearerToken,
        string $poolId,
        string $direction,
        float $amount,
        string $reason
    ): array {
        $url = $this->config['api_base_url'] . '/api/admin/pools/' . rawurlencode($poolId) . '/adjust';
        $payload = json_encode([
            'direction' => strtoupper($direction) === 'DEBIT' ? 'DEBIT' : 'CREDIT',
            'amount' => $amount,
            'reason' => $reason,
        ], JSON_THROW_ON_ERROR);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $bearerToken,
            ],
            CURLOPT_POSTFIELDS => $payload,
        ]);

        $response = curl_exec($ch);
        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($response === false) {
            throw new RuntimeException('API bridge error: ' . $curlError);
        }

        $decoded = json_decode($response, true);
        if ($statusCode < 200 || $statusCode >= 300) {
            throw new RuntimeException($decoded['error'] ?? "API HTTP {$statusCode}");
        }
        return is_array($decoded) ? $decoded : ['raw' => $response];
    }

    /**
     * Verifies an incoming HMAC-SHA256 webhook signature using constant-time comparison.
     */
    public function verifyWebhookSignature(string $rawBody, string $signatureHeader): bool
    {
        $secret = (string) ($this->config['webhook_secret'] ?? '');
        if ($secret === '' || $signatureHeader === '') {
            return false;
        }
        $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
        return hash_equals($expected, $signatureHeader);
    }
}

// Run HTTP/CLI dispatcher only when executed directly
if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $action = $argv[1] ?? 'health';
    try {
        $client = new ProMoneyCoreClient();
        $out = match ($action) {
            'pools' => $client->listCentralPools(),
            'settings' => $client->listSystemSettings(),
            default => $client->healthCheck(),
        };
        echo json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    } catch (Throwable $e) {
        fwrite(STDERR, 'Error: ' . $e->getMessage() . PHP_EOL);
        exit(1);
    }
} elseif (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    header('Content-Type: application/json; charset=utf-8');
    $bridgeToken = (string) (getenv('PROMONEY_BRIDGE_TOKEN') ?: '');
    $providedToken = (string) ($_SERVER['HTTP_X_PROMONEY_BRIDGE_TOKEN'] ?? '');
    if ($bridgeToken === '' || !hash_equals($bridgeToken, $providedToken)) {
        http_response_code(401);
        echo json_encode(['error' => 'Unauthorized PHP bridge request.']);
        exit;
    }

    $action = $_GET['action'] ?? 'health';
    try {
        $client = new ProMoneyCoreClient();
        $out = match ($action) {
            'pools' => ['pools' => $client->listCentralPools()],
            'settings' => ['settings' => $client->listSystemSettings()],
            'transactions' => [
                'transactions' => isset($_GET['userId']) && is_string($_GET['userId'])
                    ? $client->listUserTransactions($_GET['userId'], (int) ($_GET['limit'] ?? 50))
                    : [],
            ],
            default => $client->healthCheck(),
        };
        echo json_encode($out, JSON_UNESCAPED_UNICODE);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Internal banking bridge error.']);
    }
}
