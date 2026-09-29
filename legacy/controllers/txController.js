const db = require('../db');

const transferProperty = async (req, res) => {
    const { parcel_id, new_citizen_id } = req.body;
    const client = await db.getClient();

    try {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        const parcelRes = await client.query(
            'SELECT * FROM LAND_PARCEL WHERE parcel_id = $1 FOR UPDATE',
            [parcel_id]
        );

        if (parcelRes.rows.length === 0) throw new Error("Parcel not found");

        await client.query(
            `UPDATE OWNERSHIP SET valid_to = CURRENT_TIMESTAMP 
             WHERE parcel_id = $1 AND valid_to IS NULL`,
            [parcel_id]
        );

        await client.query(
            `INSERT INTO OWNERSHIP (parcel_id, citizen_id, ownership_percent) 
             VALUES ($1, $2, 100.00)`,
            [parcel_id, new_citizen_id]
        );

        await client.query('COMMIT');
        res.status(200).json({ message: "Property transferred successfully with full audit trail." });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Transaction failed:", e.message);
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
};

module.exports = { transferProperty };