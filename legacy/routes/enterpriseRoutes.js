const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post('/routine', async (req, res) => {
    const { action } = req.body;
    try {
        if (action === 'distribute_carbon_credits') {
            await pool.query('CALL distribute_carbon_credits();');
            return res.status(200).json({ message: 'Stored Procedure "distribute_carbon_credits()" executed successfully. Monthly loops and cursors completed.' });
        } 
        else if (action === 'validate_parcels') {
            await pool.query('CALL validate_parcels();');
            // Let's fetch if there are any errors
            const errorCheck = await pool.query('SELECT COUNT(*) FROM ERROR_LOG');
            const errorCount = errorCheck.rows[0].count;
            return res.status(200).json({ message: `Stored Procedure "validate_parcels()" finished parsing cursors. Found ${errorCount} spatial integrity errors.` });
        }
        else {
            return res.status(400).json({ error: 'Unknown enterprise routine.' });
        }
    } catch (err) {
        console.error("Enterprise Routine Error:", err);
        return res.status(500).json({ error: err.message });
    }
});

router.get('/telemetry', async (req, res) => {
    try {
        // Query Materialized View
        let mvData = null;
        try {
            const mvQuery = await pool.query('SELECT * FROM MV_STATE_SUSTAINABILITY LIMIT 1');
            mvData = mvQuery.rows[0];
        } catch (e) { console.error(e); }

        // Query Table Counts
        const queries = [
            'SELECT COUNT(*) as count FROM ML_PREDICTIONS'
        ];
        
        const counts = {};
        for (let q of queries) {
            const result = await pool.query(q);
            const tableName = q.split('FROM ')[1];
            counts[tableName] = result.rows[0].count;
        }

        res.json({ mvData, counts });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
