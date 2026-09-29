const pool = require('../db'); // Assuming you export a pg Pool from your db folder

// Register a new land parcel with spatial data
exports.registerParcel = async (req, res) => {
    const { owner_id, geojson_polygon, zoning_type } = req.body;

    try {
        // Using ST_GeomFromGeoJSON to enforce physical geography directly at the DB level
        const query = `
            INSERT INTO land_parcels (owner_id, zoning_type, boundary)
            VALUES ($1, $2, ST_SetSRID(ST_GeomFromGeoJSON($3), 4326))
            RETURNING id;
        `;
        const result = await pool.query(query, [owner_id, zoning_type, geojson_polygon]);
        
        res.status(201).json({ 
            success: true, 
            message: "Parcel registered successfully", 
            parcel_id: result.rows[0].id 
        });
    } catch (error) {
        console.error("Error registering parcel:", error);
        res.status(500).json({ error: "Database error during registration" });
    }
};

// Transfer ownership (High-Concurrency & Immutable History)
exports.transferOwnership = async (req, res) => {
    const { parcel_id, current_owner_id, new_owner_id, transfer_value } = req.body;
    const client = await pool.connect();

    try {
        // Start an atomic transaction
        await client.query('BEGIN');

        // 1. Verify current ownership and lock the row for update (prevents race conditions in cap-and-trade)
        const checkQuery = `SELECT owner_id FROM land_parcels WHERE id = $1 FOR UPDATE`;
        const checkRes = await client.query(checkQuery, [parcel_id]);

        if (checkRes.rows[0].owner_id !== current_owner_id) {
            throw new Error("Ownership verification failed.");
        }

        // 2. Update the parcel owner
        const updateQuery = `UPDATE land_parcels SET owner_id = $1 WHERE id = $2`;
        await client.query(updateQuery, [new_owner_id, parcel_id]);

        // 3. Log the immutable transaction history
        const historyQuery = `
            INSERT INTO transactions_history (parcel_id, from_owner, to_owner, value)
            VALUES ($1, $2, $3, $4)
        `;
        await client.query(historyQuery, [parcel_id, current_owner_id, new_owner_id, transfer_value]);

        // Commit the transaction
        await client.query('COMMIT');
        res.status(200).json({ success: true, message: "Ownership transferred immutably." });

    } catch (error) {
        // Rollback all changes if anything fails
        await client.query('ROLLBACK');
        console.error("Transaction failed:", error);
        res.status(400).json({ success: false, error: error.message });
    } finally {
        client.release();
    }
};

// Spatial Query: Find who owns the land at a specific GPS coordinate
exports.queryLocation = async (req, res) => {
    const { lat, lng } = req.query;

    try {
        // PostGIS ST_Contains checks if the POINT is inside the POLYGON
        const query = `
            SELECT id, owner_id, zoning_type 
            FROM land_parcels 
            WHERE ST_Contains(boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326));
        `;
        const result = await pool.query(query, [lng, lat]); // Note: PostGIS is Longitude, Latitude

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "No registered parcel found at these coordinates." });
        }

        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        console.error("Spatial query error:", error);
        res.status(500).json({ error: "Failed to process spatial query" });
    }
};