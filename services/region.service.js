import pool from '../db.js';

// Saudi regions (migration 028), in their official order.
export const listRegions = async () => {
    const { rows } = await pool.query('SELECT id, name FROM regions ORDER BY id');
    return rows;
};
