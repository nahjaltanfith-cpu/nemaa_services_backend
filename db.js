import 'dotenv/config';
import pg from 'pg';

// Return BIGINT (COUNT/SUM results) and NUMERIC (DECIMAL columns) as JS numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => parseFloat(v));

const useSsl = process.env.DB_SSL === 'true';

const pool = new pg.Pool(
    process.env.DATABASE_URL
        ? {
            connectionString: process.env.DATABASE_URL,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined,
            max: 10,
        }
        : {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            port: Number(process.env.DB_PORT) || 5432,
            ssl: useSsl ? { rejectUnauthorized: false } : undefined,
            max: 10,
        }
);

pool.on('error', (err) => {
    console.error('[db] Unexpected idle client error:', err);
});

export default pool;
