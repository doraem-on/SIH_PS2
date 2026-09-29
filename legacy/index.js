require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const path = require('path');
const pool = require('./db'); // Re-added to ensure DB initializes on startup

const PORT = process.env.PORT || 5001;

// ==========================================
// 1. IMPORT ROUTES (Grouped for cleanliness) . 
// ==========================================
const spatialRoutes = require('./routes/spatialRoutes');
const landRoutes = require('./routes/landRoutes');
const greenRoutes = require('./routes/greenRoutes');
const txRoutes = require('./routes/txRoutes');
const waterRoutes = require('./routes/waterRoutes');
const ownerRoutes = require('./routes/ownerRoutes');
const enterpriseRoutes = require('./routes/enterpriseRoutes');

// ==========================================
// 2. GLOBAL MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json()); // Parses incoming JSON requests

// Serve the frontend command center from the 'public' directory
// (Removed the duplicate, keeping the safer path.join version)
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 3. MOUNT API ENDPOINTS
// ==========================================
app.use('/api/spatial', spatialRoutes);
app.use('/api/land', landRoutes);
app.use('/api/green', greenRoutes);
app.use('/api/water', waterRoutes);
app.use('/api/owners', ownerRoutes);
app.use('/api/enterprise', enterpriseRoutes);

// CRITICAL FIX: Kept as '/api/transactions' so your 3NF Ledger frontend doesn't break
app.use('/api/transactions', txRoutes); 

// Health Check API
app.get('/api/health', (req, res) => {
    res.json({ status: "Secure", message: "GDLR Core Engine is Active." });
});

// ==========================================
// 4. START SERVER
// ==========================================
app.listen(PORT, () => {
    console.log(`>> GDLR Core Engine engaged on port ${PORT}`);
});
