# 🌱 Green Digital Land Registry (GDLR)

**An Enterprise-Grade, Spatial, and Sustainable Land Management Infrastructure**

The Green Digital Land Registry (GDLR) is a highly robust, high-performance web application designed to track, manage, and audit sustainable land assets. Built for massive scale and data integrity, GDLR integrates spatial geometries, ownership deeds, carbon credit distribution, and water/energy trading into a fully ACID-compliant system.

Unlike standard CRUD applications, GDLR pushes critical business logic directly into the PostgreSQL kernel using advanced **PL/pgSQL features, spatial indexing, materialized views, and DML triggers** to guarantee data integrity and performance at scale.

---

## 🚀 Key Features

*   **🌍 Spatial AI Geometries**: Land parcels are stored as exact geographical bounds using `PostGIS` `ST_GeomFromText` and indexed using GiST for lightning-fast spatial overlap/intersection checks.
*   **⚖️ ACID-Compliant Trading**: Ownership transfers and natural resource trading (Water Quotas, Energy) utilize Row-Level Locks (`SELECT ... FOR UPDATE`) and rigorous rollback procedures to ensure concurrent transactions never result in deadlocks or orphaned deeds.
*   **🛡️ Cryptographic Audit Ledger**: Every transaction (Insert/Update/Delete) fires a DML Trigger that generates an immutable `SHA-256` blockchain-style hash string, logging it into a Bitemporal 3NF Audit Ledger.
*   **⚙️ DB-Level Automation**: Carbon credit distribution and ESG (Environmental, Social, Governance) sustainability scores are calculated automatically via database Triggers and Cursor-based stored procedures without bottlenecking the Node.js API layer.
*   **📊 Materialized Telemetry**: A live dashboard powered by a Materialized View (`MV_STATE_SUSTAINABILITY`) performs deep aggregation over the environmental datasets, visualizing carbon offsets via Chart.js dynamically.
*   **🧠 AI-Ready Pipeline Architecture**: Includes schema infrastructure designed specifically to accept and render external Machine Learning predictions (e.g., Deforestation Risk, Carbon Yield).

---

## 🛠️ Technology Stack

**Frontend**
*   **HTML5 / Vanilla JS**: Lightweight, highly optimized component manipulation without framework overhead.
*   **Tailwind CSS**: Custom "Deep Forest" topological aesthetic for a modern, enterprise dashboard UI.
*   **Leaflet.js**: Interactive GIS mapping rendering GeoJSON representations.
*   **Chart.js**: Real-time canvas data visualization for carbon trajectories.

**Backend**
*   **Node.js & Express**: High-concurrency RESTful API routing.
*   **Gemini AI API**: Dynamic Gen AI context parsing and scouting rationales.

**Database Layer (The Core Engine)**
*   **PostgreSQL**: Primary relational data store.
*   **PostGIS**: Advanced geospatial routing and constraint enforcement.
*   **PL/pgSQL**: Custom Stored Procedures, Functions, Cursors, and Triggers.
*   **pgcrypto**: Native hashing and cryptographic auditing.

---

## 🏗️ Advanced Database Architecture

This application heavily leverages advanced database concepts to ensure it is research and enterprise-ready:

1.  **Spatial Indexing (GiST)**: `CREATE INDEX idx_parcel_geometry ON LAND_PARCEL USING GIST (geo_boundary);`
2.  **Concurrency Control**: `PERFORM * FROM TITLE_DEED ... FOR UPDATE;`
3.  **Recursive CTEs**: `WITH RECURSIVE` queries to detect complex land encroachment chains.
4.  **Declarative Partitioning**: The `AUDIT_LOG` is partitioned by Range (`changed_at`) for high-volume historical tracking.
5.  **Explicit Cursors**: Batch validation algorithms using `OPEN`, `LOOP`, and `FETCH` to validate spatial geometries in memory.

---

## 💻 Setup & Installation

### Prerequisites
*   Node.js (v16+)
*   PostgreSQL (v14+)
*   PostGIS Extension
*   Gemini API Key

### 1. Database Initialization
1. Ensure your PostgreSQL server is running.
2. Create the database: `CREATE DATABASE gdlr_engine;`
3. Connect to the database and run the schema:
   ```bash
   psql -U your_username -d gdlr_engine -f db/schema.sql
   ```
*(Note: The schema automatically enables the `uuid-ossp`, `postgis`, and `pgcrypto` extensions).*

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
PORT=5001
DATABASE_URL=postgres://your_username:your_password@localhost:5432/gdlr_engine
GEMINI_API_KEY=your_google_gemini_api_key
```

### 3. Start the Server
```bash
npm install
npm start
```
The application will be live at `http://localhost:5001`.

---

## 🗺️ Application Overview

*   **GIS Mapping**: Click on any land parcel to query its PostGIS footprint. Unregistered land acts as a "void" and triggers the Gemini AI to suggest the best sustainable use case.
*   **3NF Ledger**: An immutable view of all system actions, tracked by `pgcrypto` transaction hashes.
*   **Sustainable Markets**: Manage and trade resources within the Energy Grid, Solar Infrastructure, Water Quotas, and Forestry Conservation zones.
*   **Enterprise Telemetry**: A high-level architectural monitor detailing ML predictions and running Materialized View analytics.

---
*Architected for the future of sustainable land management.*
