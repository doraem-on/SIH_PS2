const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { predictTradeImpact } = require('../services/aiServices');

// POST: Execute a Water Quota Transfer
router.post('/trade', async (req, res) => {
    const { source_parcel_id, target_parcel_id, water_liters } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN'); 

        // 1. Enforce Water Market Logic
        await client.query(`UPDATE WATER_QUOTA SET gallons_remaining = gallons_remaining - $1 WHERE parcel_id = $2`, [water_liters, source_parcel_id]);
        
        const resTarget = await client.query(`UPDATE WATER_QUOTA SET gallons_remaining = gallons_remaining + $1 WHERE parcel_id = $2`, [water_liters, target_parcel_id]);
        
        if (resTarget.rowCount === 0) {
            // Assume season_year is current year
            await client.query(`INSERT INTO WATER_QUOTA (parcel_id, season_year, gallons_remaining) VALUES ($1, EXTRACT(YEAR FROM CURRENT_DATE), $2)`, [target_parcel_id, water_liters]);
        }



        await client.query('COMMIT');
        res.status(200).json({ success: true, message: `Successfully allocated ${water_liters}L of water.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Water Trade Failed:", error);
        res.status(500).json({ success: false, error: "Transaction Failed." });
    } finally {
        client.release();
    }
});

// POST: Predict Trade Impact
router.post('/predict', async (req, res) => {
    const { source_parcel_id, target_parcel_id, water_liters } = req.body;
    try {
        const prediction = await predictTradeImpact(source_parcel_id, target_parcel_id, water_liters, "Liters of Water");
        res.status(200).json({ prediction });
    } catch (err) {
        console.error("Prediction Error:", err);
        res.status(500).json({ error: "Failed to generate prediction." });
    }
});

// GET: Fetch all water records
router.get('/records', async (req, res) => {
    try {
        const query = `
            SELECT 
                w.quota_id, w.gallons_remaining, w.season_year,
                p.parcel_id, w.deed_id, w.last_updated as created_at,
                ST_Y(ST_Centroid(p.geo_boundary)) as lat,
                ST_X(ST_Centroid(p.geo_boundary)) as lng
            FROM WATER_QUOTA w
            JOIN LAND_PARCEL p ON w.parcel_id = p.parcel_id
            ORDER BY w.last_updated DESC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching water records:", err);
        res.status(500).json({ error: "Failed to fetch water records." });
    }
});

module.exports = router;