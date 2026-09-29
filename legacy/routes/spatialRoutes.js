const express = require('express');
const router = express.Router();
const pool = require('../db');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getSustainabilityReport } = require('../services/aiServices'); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// 1. IDENTIFY EXISTING PARCEL (DB HEAVY)
// ==========================================
router.post('/identify', async (req, res) => {
    const { lat, lng } = req.body;
    try {
        const query = `
            SELECT 
                p.parcel_id, 
                p.area_sqm,
                p.sustainability_score,
                r.asset_type,
                r.capacity_kw,
                r.carbon_credits_available,
                w.gallons_remaining,
                COALESCE(r.description, w.description) as description,
                o.owner_name,
                o.entity_type,
                COUNT(cr.record_id) as criminal_record_count
            FROM LAND_PARCEL p
            LEFT JOIN RENEWABLE_ASSETS r ON p.parcel_id = r.parcel_id
            LEFT JOIN WATER_QUOTA w ON p.parcel_id = w.parcel_id
            LEFT JOIN TITLE_DEED td ON p.parcel_id = td.parcel_id AND td.status = 'ACTIVE'
            LEFT JOIN LAND_OWNERS o ON td.owner_id = o.owner_id
            LEFT JOIN COMPLIANCE_RECORDS cr ON o.owner_id = cr.owner_id
            WHERE ST_Contains(p.geo_boundary, ST_SetSRID(ST_Point($1, $2), 4326))
            GROUP BY p.parcel_id, p.area_sqm, p.sustainability_score, r.asset_type, r.capacity_kw, r.carbon_credits_available, w.gallons_remaining, r.description, w.description, o.owner_name, o.entity_type;
        `;
        const result = await pool.query(query, [lng, lat]);
        
        if (result.rows.length > 0) {
            let aiInsight = "AI Sustainability Analysis is currently unavailable due to high API demand.";
            try {
                aiInsight = await getSustainabilityReport(result.rows[0]);
            } catch (aiErr) {
                console.error("Gemini API Error (Identify):", aiErr.message);
            }

            res.status(200).json({ 
                data: result.rows[0],
                aiAnalysis: aiInsight 
            });
        } else {
            res.status(404).json({ message: "Unregistered Void" });
        }
    } catch (err) {
        console.error("Spatial Route Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. AI AUTO-SCOUT (Dynamic Gemini Feature)
// ==========================================
router.post('/scout', async (req, res) => {
    const { lat, lng } = req.body;
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `
            You are a geographic AI. Analyze the coordinates: Latitude ${lat}, Longitude ${lng}.
            Based on the global geography and typical biome/climate of these coordinates, identify the single best sustainable feature to build here (e.g., "Solar Farm", "Wind Turbine", "Rainwater Harvesting", "Urban Forest", "Desalination Plant") for a 1000 sqm plot.
            Also estimate its primary capacity (e.g., kW for Solar/Wind, Liters for Water, Trees for Forest).
            Provide a short reasoning (max 2 sentences) why this is suitable here.
            Return ONLY a valid JSON object in this exact format, nothing else:
            {"feature_type": "Solar Farm", "estimated_capacity": 500, "capacity_unit": "kW", "reasoning": "Short explanation here."}
        `;
        
        const result = await model.generateContent(prompt);
        let aiResponse = result.response.text();
        
        aiResponse = aiResponse.replace(/```json/g, '').replace(/```/g, '').trim();
        res.json(JSON.parse(aiResponse));
    } catch (err) {
        console.error("Scouting Error:", err.message);
        res.json({
            feature_type: "Generic Asset",
            estimated_capacity: 100,
            capacity_unit: "Units",
            reasoning: "AI analysis unavailable due to high API demand. Proceeding with fallback mode."
        });
    }
});

// ==========================================
// 3. EXECUTE TRANSACTION (Dynamic DB Heavy)
// ==========================================
router.post('/register', async (req, res) => {
    const { lat, lng, feature_type, capacity, description, owner_name, entity_type, contact_info } = req.body;
    
    if (!owner_name || !entity_type || !contact_info) {
        return res.status(400).json({ error: "Ownership details (name, entity, contact) are strictly required for registration." });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // 1. Create Parcel
        const resParcel = await client.query(`
            INSERT INTO LAND_PARCEL (geo_boundary, area_sqm)
            VALUES (ST_SetSRID(ST_MakeEnvelope($1 - 0.0005, $2 - 0.0005, $1 + 0.0005, $2 + 0.0005), 4326), 1000)
            RETURNING parcel_id;
        `, [lng, lat]);
        const new_parcel_id = resParcel.rows[0].parcel_id;

        // 2. Create Mandatory Owner
        const resOwner = await client.query(`
            INSERT INTO LAND_OWNERS (owner_name, entity_type, contact_info) 
            VALUES ($1, $2, $3) RETURNING owner_id;
        `, [owner_name, entity_type, contact_info]);
        const new_owner_id = resOwner.rows[0].owner_id;

        // 3. Issue Title Deed
        const resDeed = await client.query(`
            INSERT INTO TITLE_DEED (parcel_id, owner_id, status)
            VALUES ($1, $2, 'ACTIVE') RETURNING deed_id;
        `, [new_parcel_id, new_owner_id]);
        const new_deed_id = resDeed.rows[0].deed_id;

        // 4. Assign Market Asset linked to Deed
        const ft = (feature_type || '').toLowerCase();
        if (ft.includes('water') || ft.includes('rain')) {
            await client.query(`INSERT INTO WATER_QUOTA (parcel_id, deed_id, season_year, gallons_remaining, description) VALUES ($1, $2, EXTRACT(YEAR FROM CURRENT_DATE), $3, $4)`, [new_parcel_id, new_deed_id, capacity, description || feature_type]);
        } else {
            await client.query(`INSERT INTO RENEWABLE_ASSETS (parcel_id, deed_id, asset_type, capacity_kw, description) VALUES ($1, $2, $3, $4, $5)`, [new_parcel_id, new_deed_id, feature_type || 'Generic Asset', capacity, description || feature_type]);
        }

        await client.query('COMMIT');
        res.status(200).json({ message: "Parcel officially committed to 3NF Ledger. Title Deed Issued.", parcel_id: new_parcel_id });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error("Transaction Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
});

// ==========================================
// 4. GET DASHBOARD METRICS
// ==========================================
router.get('/metrics', async (req, res) => {
    try {
        await pool.query('REFRESH MATERIALIZED VIEW MV_SUSTAINABILITY_METRICS');
        const result = await pool.query('SELECT * FROM MV_SUSTAINABILITY_METRICS');
        res.status(200).json(result.rows[0] || {});
    } catch (err) {
        console.error("Metrics Error:", err);
        res.status(500).json({ error: "Failed to fetch metrics" });
    }
});

module.exports = router;