const db = require('../db');

const tradeWaterQuota = async (req, res) => {
    const { seller_parcel_id, buyer_parcel_id, gallons, season_year } = req.body;
    const client = await db.getClient();

    try {
        // Absolute strictness. No phantom reads, no race conditions.
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

        // 1. Lock Seller and Verify Balance
        const sellerRes = await client.query(
            'SELECT gallons_remaining FROM WATER_QUOTA WHERE parcel_id = $1 AND season_year = $2 FOR UPDATE',
            [seller_parcel_id, season_year]
        );

        if (sellerRes.rows.length === 0) throw new Error("Seller water quota not found.");
        if (sellerRes.rows[0].gallons_remaining < gallons) {
            throw new Error("Transaction blocked: Insufficient water quota.");
        }

        // 2. Lock Buyer
        const buyerRes = await client.query(
            'SELECT gallons_remaining FROM WATER_QUOTA WHERE parcel_id = $1 AND season_year = $2 FOR UPDATE',
            [buyer_parcel_id, season_year]
        );

        if (buyerRes.rows.length === 0) throw new Error("Buyer water quota not found.");

        // 3. Execute the Cap-and-Trade Transfer
        await client.query(
            'UPDATE WATER_QUOTA SET gallons_remaining = gallons_remaining - $1 WHERE parcel_id = $2 AND season_year = $3',
            [gallons, seller_parcel_id, season_year]
        );

        await client.query(
            'UPDATE WATER_QUOTA SET gallons_remaining = gallons_remaining + $1 WHERE parcel_id = $2 AND season_year = $3',
            [gallons, buyer_parcel_id, season_year]
        );

        await client.query('COMMIT');
        res.status(200).json({ 
            message: `Cap-and-Trade execution successful. Transferred ${gallons} gallons for season ${season_year}.` 
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Water trade failed:", e.message);
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
};

module.exports = { tradeWaterQuota };