const API_BASE_URL = '/api/land';
// 1. Register a new parcel from the UI
async function registerLandParcel(ownerId, zoningType, geojsonPolygon) {
    try {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                owner_id: ownerId,
                zoning_type: zoningType,
                geojson_polygon: geojsonPolygon
            })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Registration failed');
        
        console.log("Success:", data.message);
        return data;
    } catch (error) {
        console.error("API Error:", error.message);
        return null;
    }
}

// 2. Query the map at a specific GPS coordinate
async function checkLocationOwnership(lat, lng) {
    try {
        const response = await fetch(`${API_BASE_URL}/query?lat=${lat}&lng=${lng}`);
        const data = await response.json();
        
        if (response.status === 404) {
            return null; // Land is unregistered
        }
        
        if (!response.ok) throw new Error(data.error);
        
        return data.data;
    } catch (error) {
        console.error("API Error:", error.message);
        return null;
    }
}

// 3. Execute a cap-and-trade transfer
async function executeTrade(parcelId, currentOwner, newOwner, value) {
    try {
        const response = await fetch(`${API_BASE_URL}/transfer`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                parcel_id: parcelId,
                current_owner_id: currentOwner,
                new_owner_id: newOwner,
                transfer_value: value
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        return data;
    } catch (error) {
        console.error("Trade failed:", error.message);
        return null;
    }
}