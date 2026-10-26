import pool from '../db.js';

/**
 * Public counters for the website's "about" section:
 * - services: requestable now ('active' only; coming_soon is not "available" yet)
 * - centers: shown on the website ('active' + 'coming_soon', same as the centers section)
 * - ngos: every NGO account registered with us, whatever its review status
 */
export const getPublicStats = async () => {
    const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(*) FROM services WHERE status = 'active') AS services,
            (SELECT COUNT(*) FROM enablement_centers WHERE status <> 'inactive') AS centers,
            (SELECT COUNT(*) FROM ngos) AS ngos`);
    return rows[0];
};
