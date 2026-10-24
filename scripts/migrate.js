import { readdir, readFile } from 'node:fs/promises';
import pool from '../db.js';
let connection;
try {
    connection = await pool.connect();
    await connection.query('BEGIN');
    // Serialize concurrent migration processes against this database.
    await connection.query('SELECT pg_advisory_xact_lock(7007)');
    await connection.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            id SERIAL PRIMARY KEY,
            filename TEXT NOT NULL UNIQUE,
            applied_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
    `);
    const directory = new URL('../migrations/', import.meta.url);
    const files = (await readdir(directory))
        .filter((file) => /^\d+.*\.sql$/.test(file))
        .sort();
    for (const file of files) {
        const { rows: applied } = await connection.query(
            'SELECT id FROM schema_migrations WHERE filename = $1', [file]
        );
        if (applied.length) {
            console.log(`[migrate] Already applied: ${file}`);
            continue;
        }
        await connection.query(await readFile(new URL(file, directory), 'utf8'));
        await connection.query(
            'INSERT INTO schema_migrations (filename) VALUES ($1)', [file]
        );
        console.log(`[migrate] Applied: ${file}`);
    }
    await connection.query('COMMIT');
} catch (error) {
    if (connection) await connection.query('ROLLBACK');
    console.error('[migrate] Failed:', error.message);
    process.exitCode = 1;
} finally {
    connection?.release();
    await pool.end();
}
