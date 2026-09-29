const express = require('express');
const router = express.Router();

// Import the controller we just built
const landController = require('../controllers/landController');

// Define the API endpoints
router.post('/register', landController.registerParcel);

// Using PUT or POST for the transfer since it modifies data state
router.post('/transfer', landController.transferOwnership);

// GET request for spatial queries (e.g., /api/land/query?lat=12.9716&lng=77.5946)
router.get('/query', landController.queryLocation);

module.exports = router;