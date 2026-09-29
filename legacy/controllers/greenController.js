const db = require('../db');

const tradeMicrogridEnergy = async (req, res) => {
    const { seller_parcel_id, buyer_parcel_id, credits_to_trade } = req.body;
    
    const client = await db.getClient();

    try {
        await client.query('BEGIN');

        // 1. PostGIS Spatial Validation (Must be within 50 meters)
        const spatialQuery = `
            SELECT ST_DWithin(
                (SELECT geo_boundary FROM LAND_PARCEL WHERE parcel_id = $1)::geography,
                (SELECT geo_boundary FROM LAND_PARCEL WHERE parcel_id = $2)::geography,
                50 -- distance in meters
            ) as is_close_enough;
        `;
        
        const spatialRes = await client.query(spatialQuery, [seller_parcel_id, buyer_parcel_id]);
        
        if (!spatialRes.rows[0].is_close_enough) {
            throw new Error("Parcels are too far apart. Microgrid connection not physically possible.");
        }

        // 2. Validate Seller has enough credits
        const sellerRes = await client.query(
            'SELECT carbon_credit_balance FROM LAND_PARCEL WHERE parcel_id = $1 FOR UPDATE', 
            [seller_parcel_id]
        );
        
        if (sellerRes.rows[0].carbon_credit_balance < credits_to_trade) {
            throw new Error("Seller does not have enough carbon credits.");
        }

        // 3. Lock Buyer row and execute the transfer
        await client.query('SELECT * FROM LAND_PARCEL WHERE parcel_id = $1 FOR UPDATE', [buyer_parcel_id]);

        await client.query(
            'UPDATE LAND_PARCEL SET carbon_credit_balance = carbon_credit_balance - $1 WHERE parcel_id = $2',
            [credits_to_trade, seller_parcel_id]
        );

        await client.query(
            'UPDATE LAND_PARCEL SET carbon_credit_balance = carbon_credit_balance + $1 WHERE parcel_id = $2',
            [credits_to_trade, buyer_parcel_id]
        );

        await client.query('COMMIT');
        res.status(200).json({ 
            message: "Spatial verification passed. Energy credits transferred successfully across the microgrid." 
        });

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Microgrid trade failed:", e.message);
        res.status(400).json({ error: e.message });
    } finally {
        client.release();
    }
};

module.exports = { tradeMicrogridEnergy };