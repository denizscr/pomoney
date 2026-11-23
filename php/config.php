<?php
/**
 * PRO MONEY — PHP Integration Configuration
 *
 * Reads all database, API, and webhook configuration from environment variables.
 * Supports embedded SQLite (default sandbox/dev) and Production PostgreSQL via PDO.
 */

declare(strict_types=1);

return [
    'db_driver' => getenv('PROMONEY_DB_DRIVER') ?: 'sqlite', // 'sqlite' | 'pgsql'
    'sqlite_path' => getenv('PROMONEY_SQLITE_PATH') ?: dirname(__DIR__) . '/data/promoney.db',
    'pgsql' => [
        'host' => getenv('PGHOST') ?: 'localhost',
        'port' => getenv('PGPORT') ?: '5432',
        'database' => getenv('PGDATABASE') ?: 'pro_money',
        'user' => getenv('PGUSER') ?: 'pro_money_app',
        'password' => getenv('PGPASSWORD') ?: '',
    ],
    'api_base_url' => rtrim(getenv('PROMONEY_API_URL') ?: 'http://127.0.0.1:3000', '/'),
    'webhook_secret' => getenv('PROMONEY_WEBHOOK_SECRET') ?: '',
];
