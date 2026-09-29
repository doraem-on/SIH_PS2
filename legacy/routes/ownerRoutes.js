const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET all owners (for dropdowns)
router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT owner_id, owner_name, entity_type FROM LAND_OWNERS');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching owners:", err);
        res.status(500).json({ error: "Failed to fetch owners." });
    }
});

// POST to transfer ownership
router.post('/transfer', async (req, res) => {
    const { parcel_id, new_owner_name, entity_type, contact_info } = req.body;
    try {
        await pool.query('BEGIN');
        const resOwner = await pool.query(
            'INSERT INTO LAND_OWNERS (owner_name, entity_type, contact_info) VALUES ($1, $2, $3) RETURNING owner_id',
            [new_owner_name, entity_type, contact_info]
        );
        const new_owner_id = resOwner.rows[0].owner_id;
        
        // We use the DB-heavy stored procedure!
        await pool.query('CALL transfer_ownership($1, $2)', [parcel_id, new_owner_id]);
        await pool.query('COMMIT');
        
        res.status(200).json({ message: "Deed transferred to new owner successfully. Ledger updated." });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error("Error transferring deed:", err);
        res.status(500).json({ error: "Ownership transfer failed." });
    }
});

// GET detailed ownership records
router.get('/detailed', async (req, res) => {
    try {
        const query = `
            SELECT 
                td.deed_id, td.issue_date, td.status,
                o.owner_id, o.owner_name, o.entity_type,
                p.parcel_id,
                ST_Y(ST_Centroid(p.geo_boundary)) as lat,
                ST_X(ST_Centroid(p.geo_boundary)) as lng,
                COUNT(cr.record_id) as violations
            FROM TITLE_DEED td
            JOIN LAND_OWNERS o ON td.owner_id = o.owner_id
            JOIN LAND_PARCEL p ON td.parcel_id = p.parcel_id
            LEFT JOIN COMPLIANCE_RECORDS cr ON o.owner_id = cr.owner_id
            GROUP BY td.deed_id, td.issue_date, td.status, o.owner_id, o.owner_name, o.entity_type, p.parcel_id
            ORDER BY td.issue_date DESC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching detailed owners:", err);
        res.status(500).json({ error: "Failed to fetch detailed ownership records." });
    }
});

module.exports = router;
