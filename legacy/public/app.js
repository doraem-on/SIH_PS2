let activeParcelId = null;
let activeTradeType = null;
let allOwners = [];

// Global Data Storage for Search/Sort
let globalLedger = [];
let globalEnergy = [];
let globalWater = [];
let globalOwnership = [];

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Initialize Lucide Icons
    if (window.lucide) lucide.createIcons();

    // Fetch owners for dropdown
    try {
        const res = await fetch('/api/owners');
        if (res.ok) allOwners = await res.json();
    } catch (e) { console.error("Could not fetch owners"); }

    // 2. Initialize Leaflet Map
    window.gdlrMap = L.map('map').setView([12.9716, 77.5946], 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap & Carto'
    }).addTo(window.gdlrMap);

    refreshOverview();
    refreshLedger();
    refreshEnergy();
    refreshWater();
    refreshOwnership();

    setupSearchSortListeners();

    // 3. Map Click Handler
    window.gdlrMap.on('click', async function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        const infoPanel = document.getElementById('info-panel');
        
        infoPanel.innerHTML = `<div class="text-slate-400 text-sm mt-4 text-center animate-pulse">Running AI Spatial Analysis...</div>`;

        try {
            const response = await fetch('/api/spatial/identify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lat, lng })
            });

            if (response.ok) {
                const result = await response.json();
                activeParcelId = result.data.parcel_id;
                
                let extraFeatures = '';
                if (result.data.asset_type) {
                    extraFeatures += `<div class="mt-2"><p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Asset Type</p><p class="text-xs text-white">${result.data.asset_type} (${result.data.capacity_kw} kW)</p></div>`;
                }
                if (result.data.gallons_remaining != null) {
                    extraFeatures += `<div class="mt-2"><p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Water Quota</p><p class="text-xs text-white">${result.data.gallons_remaining} Liters</p></div>`;
                }

                infoPanel.innerHTML = `
                    <div class="space-y-4">
                        <div class="pb-3 border-b border-slate-700 flex justify-between items-center">
                            <span class="inline-block px-2 py-1 bg-emerald-900/50 text-emerald-400 text-xs rounded font-semibold">Active Parcel Selected</span>
                        </div>
                        <div>
                            <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Parcel ID</p>
                            <p class="text-xs font-mono text-white mt-1 break-all">${result.data.parcel_id}</p>
                        </div>
                        ${result.data.owner_name ? `
                        <div>
                            <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Ownership Title Deed</p>
                            <p class="text-xs text-white mt-1 flex items-center gap-1">
                                <lucide-icon name="user" class="w-3 h-3 text-slate-400"></lucide-icon>
                                ${result.data.owner_name} <span class="text-slate-500">(${result.data.entity_type})</span>
                            </p>
                            ${result.data.criminal_record_count > 0 ? `
                                <div class="mt-2 bg-red-900/30 border border-red-800 p-2 rounded flex items-start gap-2">
                                    <lucide-icon name="alert-triangle" class="w-4 h-4 text-red-500 mt-0.5 shrink-0"></lucide-icon>
                                    <div>
                                        <p class="text-[10px] text-red-400 uppercase tracking-widest font-bold">Compliance Warning</p>
                                        <p class="text-xs text-red-300">Owner has ${result.data.criminal_record_count} active criminal/compliance violation(s) on record.</p>
                                    </div>
                                </div>
                            ` : ''}
                        </div>` : ''}
                        ${result.data.description ? `<div><p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Ledger Description</p><p class="text-xs text-slate-300 italic">"${result.data.description}"</p></div>` : ''}
                        
                        <div>
                            <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">ESG Sustainability Score</p>
                            <p class="text-xl font-bold ${result.data.sustainability_score > 0 ? 'text-emerald-400' : 'text-slate-400'} mt-1">
                                ${result.data.sustainability_score || 0}
                                <span class="text-[10px] font-normal text-slate-500 ml-1">Automated by DB Trigger</span>
                            </p>
                        </div>

                        ${extraFeatures}
                        
                        <div class="pt-3 border-t border-slate-700">
                            <button onclick="openTransferModal('${result.data.parcel_id}')" class="w-full text-xs py-1.5 border border-slate-600 text-slate-300 rounded hover:bg-slate-700 transition-colors">
                                Transfer Title Deed
                            </button>
                        </div>
                        <div>
                            <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Sustainability Insight</p>
                            <p class="text-sm text-slate-300 mt-2 leading-relaxed">${result.aiAnalysis}</p>
                        </div>
                    </div>
                `;
                if (window.lucide) lucide.createIcons();
            } else {
                activeParcelId = null;
                infoPanel.innerHTML = `<div class="text-amber-400 text-sm mt-4 text-center animate-pulse">Unregistered Void. AI Geo-Scouting initiated...</div>`;
                
                const scoutRes = await fetch('/api/spatial/scout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat, lng })
                });
                const scoutData = await scoutRes.json();

                infoPanel.innerHTML = `
                    <div class="space-y-4">
                        <div class="pb-3 border-b border-slate-700">
                            <span class="inline-block px-2 py-1 bg-amber-900/50 text-amber-400 text-xs rounded font-semibold">Register New Parcel</span>
                        </div>
                        <p class="text-xs text-slate-400 italic">"${scoutData.reasoning}"</p>
                        <input type="hidden" id="reg-reasoning" value="${scoutData.reasoning}">
                        
                        <div class="space-y-3 mt-4">
                            <!-- Registration Market Details -->
                            <div class="p-3 bg-slate-900/50 rounded border border-slate-700 space-y-3">
                                <p class="text-[10px] text-slate-400 uppercase font-bold tracking-widest border-b border-slate-700 pb-1">1. Market Asset</p>
                                <div>
                                    <label class="text-[10px] text-slate-500 uppercase font-bold">Asset Type</label>
                                    <select id="reg-feature" class="w-full bg-slate-800 text-white p-2 rounded text-sm mt-1 border border-slate-700 focus:border-amber-500 outline-none" onchange="updateCapacityPlaceholder()">
                                        <option value="${scoutData.feature_type}">AI Suggestion: ${scoutData.feature_type}</option>
                                        <option value="Solar Plant">Solar Plant</option>
                                        <option value="Wind Farm">Wind Farm</option>
                                        <option value="Water Reservoir">Water Reservoir</option>
                                        <option value="Forestry Conservation">Forestry Conservation</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-slate-500 uppercase font-bold">Estimated Capacity <span class="text-red-500">*</span></label>
                                    <input type="number" id="reg-capacity" placeholder="Enter manual capacity..." class="w-full bg-slate-800 text-white p-2 rounded text-sm mt-1 border border-slate-700 focus:border-amber-500 outline-none">
                                </div>
                            </div>
                            
                            <!-- Mandatory Ownership Details -->
                            <div class="p-3 bg-slate-900/50 rounded border border-slate-700 space-y-3">
                                <p class="text-[10px] text-slate-400 uppercase font-bold tracking-widest border-b border-slate-700 pb-1">2. Mandatory Title & Ownership</p>
                                <div>
                                    <label class="text-[10px] text-slate-500 uppercase font-bold">Owner Name <span class="text-red-500">*</span></label>
                                    <input type="text" id="reg-owner" placeholder="Full Legal Name" class="w-full bg-slate-800 text-white p-2 rounded text-sm mt-1 border border-slate-700 focus:border-purple-500 outline-none">
                                </div>
                                <div>
                                    <label class="text-[10px] text-slate-500 uppercase font-bold">Entity Type <span class="text-red-500">*</span></label>
                                    <select id="reg-entity" class="w-full bg-slate-800 text-white p-2 rounded text-sm mt-1 border border-slate-700 focus:border-purple-500 outline-none">
                                        <option value="Private">Private Citizen</option>
                                        <option value="Corporate">Corporate Entity</option>
                                        <option value="Government">Government / State</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="text-[10px] text-slate-500 uppercase font-bold">Contact Info <span class="text-red-500">*</span></label>
                                    <input type="text" id="reg-contact" placeholder="Email or Phone" class="w-full bg-slate-800 text-white p-2 rounded text-sm mt-1 border border-slate-700 focus:border-purple-500 outline-none">
                                </div>
                            </div>
                            
                            <button onclick="commitNewParcel(${lat}, ${lng})" class="w-full mt-4 bg-amber-600 hover:bg-amber-500 text-white font-bold py-2 px-4 rounded text-sm transition-colors shadow-lg shadow-amber-900/50">
                                SIGN DEED & COMMIT
                            </button>
                        </div>
                    </div>
                `;
            }
        } catch (error) {
            infoPanel.innerHTML = `<div class="text-red-400 text-sm mt-4 text-center">AI Connection Failed</div>`;
        }
    });
});

function updateCapacityPlaceholder() {
    const feature = document.getElementById('reg-feature').value;
    const capacityInput = document.getElementById('reg-capacity');
    if (feature.includes('Water')) {
        capacityInput.placeholder = "Enter quota in Gallons";
    } else {
        capacityInput.placeholder = "Enter capacity in kW";
    }
}

function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById(`view-${viewId}`).classList.add('active');
    document.getElementById(`nav-${viewId}`).classList.add('active');

    if(viewId === 'map' && window.gdlrMap) {
        setTimeout(() => window.gdlrMap.invalidateSize(), 150);
    }
    
    // Refresh specific tables based on view
    if (viewId === 'energy' || viewId === 'solar' || viewId === 'forestry') refreshEnergy();
    if (viewId === 'water') refreshWater();
    if (viewId === 'ownership') refreshOwnership();
    if (viewId === 'telemetry') refreshTelemetry();
}

async function refreshTelemetry() {
    try {
        const res = await fetch('/api/enterprise/telemetry');
        const data = await res.json();
        
        if (data.mvData) {
            document.getElementById('tel-carbon').innerText = (data.mvData.total_carbon_offset || 0) + ' Tons';
            document.getElementById('tel-biodiversity').innerText = Number(data.mvData.avg_biodiversity || 0).toFixed(2);
            document.getElementById('tel-metrics').innerText = data.mvData.total_metrics || 0;
        }

        if (data.counts) {
            document.getElementById('tel-ml').innerText = data.counts['ML_PREDICTIONS'] || 0;
        }

        // Initialize Chart
        const ctx = document.getElementById('telemetryChart').getContext('2d');
        if (window.telChart) {
            window.telChart.destroy();
        }
        
        const baseCarbon = data.mvData ? Number(data.mvData.total_carbon_offset) : 2480;
        
        window.telChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Q1', 'Q2', 'Q3', 'Q4 (Projected)', 'Next Year (Projected)'],
                datasets: [{
                    label: 'Cumulative Carbon Offsets (Tons)',
                    data: [baseCarbon * 0.2, baseCarbon * 0.5, baseCarbon * 0.8, baseCarbon, baseCarbon * 1.5],
                    borderColor: '#34d399',
                    backgroundColor: 'rgba(52, 211, 153, 0.1)',
                    borderWidth: 2,
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#94a3b8' }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }
                }
            }
        });
    } catch (e) {
        console.error("Telemetry failed:", e);
    }
}

function inspectParcel(lat, lng, parcelId) {
    switchView('map');
    window.gdlrMap.setView([lat, lng], 18); // Zoom in close to the parcel
    // Fire a click event exactly at those coordinates to trigger the AI analysis & inspector UI
    window.gdlrMap.fire('click', { latlng: { lat: lat, lng: lng } });
}

// ==========================================
// TRADING MODAL LOGIC
// ==========================================
function openTradeModal(type) {
    activeTradeType = type;
    document.getElementById('trade-modal-title').innerText = `Execute ${type} Trade`;
    document.getElementById('trade-prediction-box').classList.add('hidden');
    document.getElementById('trade-prediction-text').innerText = "";

    const sourceSelect = document.getElementById('trade-source');
    const targetSelect = document.getElementById('trade-target');
    sourceSelect.innerHTML = '<option value="">Select Source Parcel...</option>';
    targetSelect.innerHTML = '<option value="">Select Target Parcel...</option>';
    
    // Populate dropdown with all records of this type
    const data = type === 'Energy' ? globalEnergy : globalWater;
    data.forEach(r => {
        const idText = `ID: ${r.parcel_id} (${type === 'Energy' ? r.asset_type : 'Water'})`;
        const selected = (r.parcel_id === activeParcelId) ? 'selected' : '';
        sourceSelect.innerHTML += `<option value="${r.parcel_id}" ${selected}>${idText}</option>`;
    });

    updateTradeTargets();
    document.getElementById('trade-modal').classList.remove('hidden');
}

window.updateTradeTargets = function() {
    const sourceVal = document.getElementById('trade-source').value;
    const targetSelect = document.getElementById('trade-target');
    targetSelect.innerHTML = '<option value="">Select Target Parcel...</option>';
    
    const data = activeTradeType === 'Energy' ? globalEnergy : globalWater;
    data.forEach(r => {
        if (r.parcel_id !== sourceVal) {
            targetSelect.innerHTML += `<option value="${r.parcel_id}">ID: ${r.parcel_id} (${activeTradeType === 'Energy' ? r.asset_type : 'Water'})</option>`;
        }
    });
};

function closeModals() {
    document.getElementById('trade-modal').classList.add('hidden');
    document.getElementById('transfer-modal').classList.add('hidden');
}

async function predictTrade() {
    const source = document.getElementById('trade-source').value;
    const target = document.getElementById('trade-target').value;
    const amount = document.getElementById('trade-amount').value;
    if (!source || !target || !amount) {
        alert("Enter source ID, target ID, and amount."); return;
    }

    const endpoint = activeTradeType === 'Energy' ? '/api/green/predict' : '/api/water/predict';
    const body = {
        source_parcel_id: source,
        target_parcel_id: target,
        [activeTradeType === 'Energy' ? 'energy_kwh' : 'water_liters']: amount
    };

    try {
        document.getElementById('trade-prediction-box').classList.remove('hidden');
        document.getElementById('trade-prediction-text').innerText = "Analyzing impact with Gemini AI...";
        
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById('trade-prediction-text').innerText = data.prediction;
        } else {
            document.getElementById('trade-prediction-text').innerText = "AI Prediction Failed.";
        }
    } catch (err) {
        document.getElementById('trade-prediction-text').innerText = "Network Error.";
    }
}

async function executeDynamicTrade() {
    const source = document.getElementById('trade-source').value;
    const target = document.getElementById('trade-target').value;
    const amount = document.getElementById('trade-amount').value;
    if (!source || !target || !amount) {
        alert("Enter source ID, target ID, and amount."); return;
    }

    const endpoint = activeTradeType === 'Energy' ? '/api/green/trade' : '/api/water/trade';
    const body = {
        source_parcel_id: source,
        target_parcel_id: target,
        [activeTradeType === 'Energy' ? 'energy_kwh' : 'water_liters']: amount
    };

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        const data = await response.json();
        if (response.ok) {
            alert(`[TX COMMITTED] ${data.message || 'Trade Successful!'}`);
            closeModals();
            refreshLedger(); 
        } else {
            throw new Error(data.error);
        }
    } catch (err) {
        alert(`[TX FAILED] ${err.message}`);
    }
}

// ==========================================
// OWNERSHIP TRANSFER LOGIC
// ==========================================
function openTransferModal(parcelId) {
    const parcelSelect = document.getElementById('transfer-parcel');
    parcelSelect.innerHTML = '<option value="">Select a Parcel to Transfer...</option>';
    
    globalOwnership.forEach(o => {
        const selected = (o.parcel_id === parcelId) ? 'selected' : '';
        parcelSelect.innerHTML += `<option value="${o.parcel_id}" ${selected}>ID: ${o.parcel_id} (Owner: ${o.owner_name})</option>`;
    });

    document.getElementById('transfer-owner-name').value = '';
    document.getElementById('transfer-contact').value = '';
    
    document.getElementById('transfer-modal').classList.remove('hidden');
}

async function executeTransfer() {
    const parcel_id = document.getElementById('transfer-parcel').value;
    const new_owner_name = document.getElementById('transfer-owner-name').value;
    const entity_type = document.getElementById('transfer-entity-type').value;
    const contact_info = document.getElementById('transfer-contact').value;
    
    if (!parcel_id || !new_owner_name || !contact_info) {
        alert("Please select a parcel and provide new owner details.");
        return;
    }

    try {
        const res = await fetch('/api/owners/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parcel_id, new_owner_name, entity_type, contact_info })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`[DEED RECORDED] ${data.message}`);
            closeModals();
            refreshLedger();
        } else {
            alert(`[ERROR] ${data.error}`);
        }
    } catch (err) {
        alert("Network Error.");
    }
}

// ==========================================
// OVERVIEW DASHBOARD LOGIC
// ==========================================
async function refreshOverview() {
    const parcels = globalOwnership.length;
    const area = parcels * 1500;
    const energy = globalEnergy.reduce((sum, r) => sum + (parseFloat(r.capacity_kw) || 0), 0);
    const water = globalWater.reduce((sum, r) => sum + (parseFloat(r.gallons_remaining) || 0), 0);

    const elParcels = document.getElementById('metric-parcels');
    const elArea = document.getElementById('metric-area');
    const elGrid = document.getElementById('metric-grid');
    const elWater = document.getElementById('metric-water');

    if (elParcels) elParcels.innerText = parcels.toLocaleString();
    if (elArea) elArea.innerHTML = `${area.toLocaleString()} <span class="text-sm text-slate-500">SQM</span>`;
    if (elGrid) elGrid.innerHTML = `+${energy.toLocaleString()} <span class="text-sm text-slate-500">kW</span>`;
    if (elWater) elWater.innerHTML = `${water.toLocaleString()} <span class="text-sm text-slate-500">Gal</span>`;
}

// ==========================================
// SEARCH & SORT SETUP
// ==========================================
function setupSearchSortListeners() {
    ['audit', 'energy', 'solar', 'water', 'ownership', 'forestry'].forEach(type => {
        const search = document.getElementById(`search-${type}`);
        const sort = document.getElementById(`sort-${type}`);
        if(search) search.addEventListener('input', () => renderTable(type));
        if(sort) sort.addEventListener('change', () => renderTable(type));
    });
}

function renderTable(type) {
    if (type === 'audit') renderLedger();
    else if (type === 'energy' || type === 'solar' || type === 'forestry') renderEnergy();
    else if (type === 'water') renderWater();
    else if (type === 'ownership') renderOwnership();
}

// ==========================================
// 3NF LEDGER LOGIC
// ==========================================
async function refreshLedger() {
    try {
        const response = await fetch('/api/transactions/ledger');
        globalLedger = await response.json();
        renderLedger();
    } catch (err) {}
}

function renderLedger() {
    const tbody = document.getElementById('ledger-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let data = [...globalLedger];
    const q = document.getElementById('search-audit').value.toLowerCase();
    const sort = document.getElementById('sort-audit').value;

    if (q) data = data.filter(d => (d.hash && d.hash.toLowerCase().includes(q)) || (d.resource_id && d.resource_id.toLowerCase().includes(q)));
    if (sort === 'oldest') data.reverse(); // Assuming it comes newest first
    
    if (data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="px-6 py-4 text-center text-slate-500">No transactions match search.</td></tr>`;
        return;
    }

    data.forEach(tx => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 transition-colors";
        const actionColor = tx.action.includes('ENERGY') ? 'text-amber-500' : tx.action.includes('DEED') ? 'text-purple-400' : 'text-blue-500';
        
        let changesHTML = `<span class="text-[10px] text-slate-500 italic">No value changes</span>`;
        if (tx.old_value || tx.new_value) {
            changesHTML = `<div class="text-[9px] font-mono text-slate-400 max-w-[200px]" title='${JSON.stringify(tx.old_value)} -> ${JSON.stringify(tx.new_value)}'>`;
            if (tx.old_value && tx.new_value) {
                const changes = [];
                for(let k in tx.new_value) {
                    if (JSON.stringify(tx.new_value[k]) !== JSON.stringify(tx.old_value[k])) {
                        changes.push(`<span class="text-slate-300">${k}:</span> ${tx.old_value[k]} &rarr; <span class="text-white font-bold">${tx.new_value[k]}</span>`);
                    }
                }
                changesHTML += changes.join('<br>') || 'Unchanged properties update';
            } else if (tx.new_value) {
                changesHTML += `<span class="text-emerald-400">Created Fields: ${Object.keys(tx.new_value).join(', ')}</span>`;
            } else if (tx.old_value) {
                changesHTML += `<span class="text-red-400">Deleted Record</span>`;
            }
            changesHTML += `</div>`;
        }

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-xs text-slate-300 font-mono">${tx.timestamp}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <div class="text-xs text-emerald-500 font-bold mb-0.5 uppercase">${tx.table_name || 'System'}</div>
                <div class="text-sm text-white font-mono">${tx.resource_id}</div>
                <div class="text-[10px] text-slate-500 font-mono mt-1" title="Cryptographic Hash">
                    <lucide-icon name="lock" class="w-3 h-3 inline pb-0.5"></lucide-icon> ${tx.hash ? tx.hash.substring(0, 16) + '...' : 'N/A'}
                </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm font-bold ${actionColor}">${tx.action_type || tx.action}</td>
            <td class="px-6 py-4">${changesHTML}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-emerald-100/10 text-emerald-400">${tx.status}</span>
            </td>
        `;
        tbody.appendChild(tr);
    });
    if (window.lucide) lucide.createIcons();

    // Update dynamic metric
    const txCard = document.getElementById('card-energy-tx');
    if (txCard) txCard.innerHTML = `${globalLedger.length.toLocaleString()} <span class="text-lg text-slate-500">TXs</span>`;
}

// ==========================================
// DETAILED RECORDS LOGIC
// ==========================================
async function refreshEnergy() {
    try {
        const res = await fetch('/api/green/records');
        globalEnergy = await res.json();
        renderEnergy();
    } catch (e) {}
}

function renderEnergy() {
    const eBody = document.getElementById('energy-body');
    const sBody = document.getElementById('solar-body');
    if (!eBody || !sBody) return;
    
    eBody.innerHTML = ''; sBody.innerHTML = '';
    
    // Energy
    let eData = [...globalEnergy];
    const eq = document.getElementById('search-energy').value.toLowerCase();
    const es = document.getElementById('sort-energy').value;
    if (eq) eData = eData.filter(d => d.asset_type.toLowerCase().includes(eq) || d.asset_id.toLowerCase().includes(eq) || (d.deed_id && d.deed_id.toLowerCase().includes(eq)));
    if (es === 'capacity_desc') eData.sort((a,b) => b.capacity_kw - a.capacity_kw);
    if (es === 'credits_desc') eData.sort((a,b) => b.carbon_credits_available - a.carbon_credits_available);

    eData.forEach(r => {
        const date = new Date(r.created_at).toLocaleString();
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 cursor-pointer transition-colors";
        tr.onclick = () => inspectParcel(r.lat, r.lng, r.parcel_id);
        tr.innerHTML = `
            <td class="px-6 py-4 font-mono text-xs text-white">
                <div>${r.asset_id.substring(0,8)}...</div>
                <div class="text-[9px] text-slate-500 mt-0.5">Deed: ${r.deed_id ? r.deed_id.substring(0,8) + '...' : 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-emerald-400 font-bold">${r.asset_type}</td>
            <td class="px-6 py-4 text-white">${r.capacity_kw}</td>
            <td class="px-6 py-4 text-amber-400 font-bold">${r.carbon_credits_available}</td>
            <td class="px-6 py-4 text-xs font-mono">${date}</td>
        `;
        eBody.appendChild(tr);
    });

    // Solar
    let sData = globalEnergy.filter(d => d.asset_type.toLowerCase() === 'solar');
    const sq = document.getElementById('search-solar').value.toLowerCase();
    const ss = document.getElementById('sort-solar').value;
    if (sq) sData = sData.filter(d => d.asset_id.toLowerCase().includes(sq) || (d.deed_id && d.deed_id.toLowerCase().includes(sq)));
    if (ss === 'capacity_desc') sData.sort((a,b) => b.capacity_kw - a.capacity_kw);

    sData.forEach(r => {
        const date = new Date(r.created_at).toLocaleString();
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 cursor-pointer transition-colors";
        tr.onclick = () => inspectParcel(r.lat, r.lng, r.parcel_id);
        tr.innerHTML = `
            <td class="px-6 py-4 font-mono text-xs text-white">
                <div>${r.asset_id.substring(0,8)}...</div>
                <div class="text-[9px] text-slate-500 mt-0.5">Deed: ${r.deed_id ? r.deed_id.substring(0,8) + '...' : 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-white">${r.capacity_kw}</td>
            <td class="px-6 py-4 text-amber-400 font-bold">${r.carbon_credits_available}</td>
            <td class="px-6 py-4 text-xs font-mono">${date}</td>
        `;
        sBody.appendChild(tr);
    });

    // Update dynamic metric
    const capCard = document.getElementById('card-energy-capacity');
    if (capCard) {
        const totalKw = globalEnergy.reduce((sum, r) => sum + (parseFloat(r.capacity_kw) || 0), 0);
        capCard.innerHTML = `${(totalKw / 1000).toFixed(1)} <span class="text-lg text-slate-500">MW</span>`;
    }

    const solarCapCard = document.getElementById('card-solar-capacity');
    const solarNodesCard = document.getElementById('card-solar-nodes');
    if (solarCapCard) {
        const totalSolar = sData.reduce((sum, r) => sum + (parseFloat(r.capacity_kw) || 0), 0);
        solarCapCard.innerHTML = `${(totalSolar / 1000).toFixed(1)} <span class="text-lg text-slate-500">MW</span>`;
    }
    if (solarNodesCard) {
        solarNodesCard.innerHTML = `${sData.length} <span class="text-lg text-slate-500">Active</span>`;
    }

    // Forestry
    const fBody = document.getElementById('forestry-body');
    if (fBody) {
        fBody.innerHTML = '';
        let fData = globalEnergy.filter(d => d.asset_type.toLowerCase().includes('forest'));
        const fq = document.getElementById('search-forestry').value.toLowerCase();
        const fs = document.getElementById('sort-forestry').value;
        if (fq) fData = fData.filter(d => d.asset_id.toLowerCase().includes(fq) || (d.deed_id && d.deed_id.toLowerCase().includes(fq)));
        if (fs === 'capacity_desc') fData.sort((a,b) => b.capacity_kw - a.capacity_kw);

        fData.forEach(r => {
            const date = new Date(r.created_at).toLocaleString();
            const tr = document.createElement('tr');
            tr.className = "hover:bg-slate-800/50 cursor-pointer transition-colors";
            tr.onclick = () => inspectParcel(r.lat, r.lng, r.parcel_id);
            tr.innerHTML = `
                <td class="px-6 py-4 font-mono text-xs text-white">
                    <div>${r.asset_id.substring(0,8)}...</div>
                    <div class="text-[9px] text-slate-500 mt-0.5">Deed: ${r.deed_id ? r.deed_id.substring(0,8) + '...' : 'N/A'}</div>
                </td>
                <td class="px-6 py-4 text-emerald-400 font-bold">${r.asset_type}</td>
                <td class="px-6 py-4 text-white">${r.capacity_kw} Trees</td>
                <td class="px-6 py-4 text-amber-400 font-bold">${r.carbon_credits_available}</td>
                <td class="px-6 py-4 text-xs font-mono">${date}</td>
            `;
            fBody.appendChild(tr);
        });

        // Update Forestry cards
        const treeCard = document.getElementById('card-forestry-trees');
        const carbonCard = document.getElementById('card-forestry-carbon');
        if (treeCard) {
            const totalTrees = fData.reduce((sum, r) => sum + (parseFloat(r.capacity_kw) || 0), 0);
            treeCard.innerHTML = `${totalTrees.toLocaleString()} <span class="text-lg text-slate-500">Trees</span>`;
        }
        if (carbonCard) {
            const totalCarbon = fData.reduce((sum, r) => sum + (parseFloat(r.carbon_credits_available) || 0), 0);
            carbonCard.innerHTML = `${totalCarbon.toLocaleString()} <span class="text-lg text-slate-500">Credits</span>`;
        }
    }

    refreshOverview();
}

async function refreshWater() {
    try {
        const res = await fetch('/api/water/records');
        globalWater = await res.json();
        renderWater();
    } catch (e) {}
}

function renderWater() {
    const tbody = document.getElementById('water-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    let data = [...globalWater];
    const q = document.getElementById('search-water').value.toLowerCase();
    const sort = document.getElementById('sort-water').value;

    if (q) data = data.filter(d => String(d.season_year).includes(q) || d.quota_id.toLowerCase().includes(q) || (d.deed_id && d.deed_id.toLowerCase().includes(q)));
    if (sort === 'gallons_desc') data.sort((a,b) => b.gallons_remaining - a.gallons_remaining);
    if (sort === 'gallons_asc') data.sort((a,b) => a.gallons_remaining - b.gallons_remaining);

    data.forEach(r => {
        const date = new Date(r.created_at).toLocaleString();
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 cursor-pointer transition-colors";
        tr.onclick = () => inspectParcel(r.lat, r.lng, r.parcel_id);
        tr.innerHTML = `
            <td class="px-6 py-4 font-mono text-xs text-white">
                <div>${r.quota_id.substring(0,8)}...</div>
                <div class="text-[9px] text-slate-500 mt-0.5">Deed: ${r.deed_id ? r.deed_id.substring(0,8) + '...' : 'N/A'}</div>
            </td>
            <td class="px-6 py-4 text-white">${r.season_year}</td>
            <td class="px-6 py-4 text-blue-400 font-bold">${r.gallons_remaining}</td>
            <td class="px-6 py-4 text-xs font-mono">${date}</td>
        `;
        tbody.appendChild(tr);
    });

    // Update dynamic metric
    const waterCard = document.getElementById('card-water-allocation');
    const stressCard = document.getElementById('card-water-stress');
    if (waterCard) {
        const totalGallons = globalWater.reduce((sum, r) => sum + (parseFloat(r.gallons_remaining) || 0), 0);
        waterCard.innerHTML = `${totalGallons.toLocaleString()} <span class="text-lg text-slate-500">Gallons</span>`;
        if (stressCard) {
            const stress = (totalGallons < 50000) ? 2.8 : (totalGallons < 150000) ? 1.8 : 1.2;
            const status = (stress >= 2.0) ? "Critical" : (stress >= 1.5) ? "Warning" : "Nominal";
            const color = (stress >= 2.0) ? "text-red-400" : (stress >= 1.5) ? "text-amber-400" : "text-emerald-400";
            stressCard.className = `text-3xl font-bold ${color}`;
            stressCard.innerHTML = `${status} <span class="text-lg text-slate-500">(${stress})</span>`;
        }
    }

    refreshOverview();
}

async function refreshOwnership() {
    try {
        const res = await fetch('/api/owners/detailed');
        globalOwnership = await res.json();
        renderOwnership();
    } catch (e) {}
}

function renderOwnership() {
    const tbody = document.getElementById('ownership-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    let data = [...globalOwnership];
    const q = document.getElementById('search-ownership').value.toLowerCase();
    const sort = document.getElementById('sort-ownership').value;

    if (q) data = data.filter(d => d.owner_name.toLowerCase().includes(q) || d.deed_id.toLowerCase().includes(q));
    if (sort === 'violations_desc') data.sort((a,b) => parseInt(b.violations) - parseInt(a.violations));
    if (sort === 'name_asc') data.sort((a,b) => a.owner_name.localeCompare(b.owner_name));

    data.forEach(r => {
        const date = new Date(r.issue_date).toLocaleString();
        const isRed = parseInt(r.violations) > 0;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-800/50 cursor-pointer transition-colors";
        tr.onclick = () => inspectParcel(r.lat, r.lng, r.parcel_id);
        
        tr.innerHTML = `
            <td class="px-6 py-4 font-mono text-xs text-white">${r.deed_id.substring(0,8)}...</td>
            <td class="px-6 py-4 text-white font-bold">${r.owner_name}</td>
            <td class="px-6 py-4 text-slate-300 text-xs uppercase tracking-widest">${r.entity_type}</td>
            <td class="px-6 py-4 font-bold ${isRed ? 'text-red-500' : 'text-emerald-500'}">
                ${isRed ? r.violations + ' Violations' : 'Clean'}
            </td>
            <td class="px-6 py-4 text-xs font-mono">${date}</td>
            <td class="px-6 py-4">
                <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-purple-100/10 text-purple-400">
                    ${r.status}
                </span>
            </td>
        `;
        tbody.appendChild(tr);
    });

    refreshOverview();
}

// ==========================================
// REGISTRATION TRANSACTION
// ==========================================
async function commitNewParcel(lat, lng) {
    const feature_type = document.getElementById('reg-feature').value;
    const capacity = document.getElementById('reg-capacity').value;
    const description = document.getElementById('reg-reasoning').value;
    
    // Ownership Fields
    const owner_name = document.getElementById('reg-owner').value;
    const entity_type = document.getElementById('reg-entity').value;
    const contact_info = document.getElementById('reg-contact').value;

    if (!capacity) {
        alert("Please explicitly enter an Estimated Capacity based on the Asset Type.");
        return;
    }

    if (!owner_name || !contact_info) {
        alert("Please provide the Owner's Name and Contact Info to issue a Title Deed.");
        return;
    }

    try {
        const res = await fetch('/api/spatial/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng, feature_type, capacity, description, owner_name, entity_type, contact_info })
        });
        
        const data = await res.json();
        if (res.ok) {
            alert("Success! Multi-Table ACID Transaction Committed to Database.");
            refreshLedger(); 
            activeParcelId = data.parcel_id;
            
            // Re-trigger the spatial map click flow to load the newly registered parcel into the Inspector UI
            window.gdlrMap.fire('click', { latlng: { lat: lat, lng: lng } });
        } else {
            alert("Database Error: " + data.error);
        }
    } catch (err) {
        alert("Server communication failed.");
    }
}

// ==========================================
// ENTERPRISE ROUTINES
// ==========================================
async function runEnterpriseRoutine(action) {
    try {
        const res = await fetch('/api/enterprise/routine', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✅ DB Routine Execution Success:\n\n${data.message}`);
            // Visually prove it by switching to the Audit Ledger
            switchView('audit');
            refreshLedger();
        } else {
            alert(`❌ DB Error:\n\n${data.error}`);
        }
    } catch (err) {
        alert("Server Error");
    }
}