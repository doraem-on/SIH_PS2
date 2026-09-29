const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { predictTradeImpact } = require('../services/aiServices');
// POST: Execute an Energy Trade (Carbon Credits)
router.post('/trade', async (req, res) => {
    const { source_parcel_id, target_parcel_id, energy_kwh } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN'); // Start Serializable Mode

        // 1. Enforce Market Logic
        // Deduct from source, add to target (creates record if target doesn't exist? No, MVP assumes it exists or just silently ignores)
        await client.query(`UPDATE RENEWABLE_ASSETS SET carbon_credits_available = COALESCE(carbon_credits_available, 0) - $1 WHERE parcel_id = $2`, [energy_kwh, source_parcel_id]);
        
        const resTarget = await client.query(`UPDATE RENEWABLE_ASSETS SET carbon_credits_available = COALESCE(carbon_credits_available, 0) + $1 WHERE parcel_id = $2`, [energy_kwh, target_parcel_id]);
        
        // If target doesn't have an asset, create a dummy one to hold the credits
        if (resTarget.rowCount === 0) {
            await client.query(`INSERT INTO RENEWABLE_ASSETS (parcel_id, asset_type, carbon_credits_available) VALUES ($1, 'Trade', $2)`, [target_parcel_id, energy_kwh]);
        }



        await client.query('COMMIT');
        res.status(200).json({ success: true, message: `Successfully traded ${energy_kwh} credits.` });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Energy Trade Failed:", error);
        res.status(500).json({ success: false, error: "Serializable Transaction Failed. State Rolled Back." });
    } finally {
        client.release();
    }
});

// POST: Predict Trade Impact
router.post('/predict', async (req, res) => {
    const { source_parcel_id, target_parcel_id, energy_kwh } = req.body;
    try {
        const prediction = await predictTradeImpact(source_parcel_id, target_parcel_id, energy_kwh, "kWh of Energy");
        res.status(200).json({ prediction });
    } catch (err) {
        console.error("Prediction Error:", err);
        res.status(500).json({ error: "Failed to generate prediction." });
    }
});

// GET: Fetch all renewable assets
router.get('/records', async (req, res) => {
    try {
        const query = `
            SELECT 
                r.asset_id, r.asset_type, r.capacity_kw, r.carbon_credits_available,
                p.parcel_id, r.deed_id, p.created_at,
                ST_Y(ST_Centroid(p.geo_boundary)) as lat,
                ST_X(ST_Centroid(p.geo_boundary)) as lng
            FROM RENEWABLE_ASSETS r
            JOIN LAND_PARCEL p ON r.parcel_id = p.parcel_id
            ORDER BY p.created_at DESC;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (err) {
        console.error("Error fetching green records:", err);
        res.status(500).json({ error: "Failed to fetch green records." });
    }
});

module.exports = router;