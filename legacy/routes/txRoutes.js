const express = require('express');
const router = express.Router();
const pool = require('../db'); 

// GET: Fetch the most recent 50 transactions for the UI Ledger
router.get('/ledger', async (req, res) => {
    try {
        // Wrap AUDIT_LOG in double quotes to match your capital-letter schema
        const query = `
            SELECT 
                TO_CHAR(changed_at, 'YYYY-MM-DD HH24:MI:SS') AS timestamp, 
                record_id AS resource_id, 
                table_name,
                action_type,
                UPPER(table_name) || '_' || action_type AS action, 
                old_value,
                new_value,
                hash,
                'COMMITTED' AS status 
            FROM audit_log
            ORDER BY changed_at DESC 
            LIMIT 50;
        `;
        const result = await pool.query(query);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error("Ledger query failed:", error);
        res.status(500).json({ error: "Failed to retrieve 3NF ledger data." });
    }
});

module.exports = router;