-- Drop existing tables/views if any to allow fresh seed
DROP MATERIALIZED VIEW IF EXISTS MV_SUSTAINABILITY_METRICS;
DROP TABLE IF EXISTS AUDIT_LOG CASCADE;
DROP TABLE IF EXISTS TITLE_DEED CASCADE;
DROP TABLE IF EXISTS LAND_OWNERS CASCADE;
DROP TABLE IF EXISTS COMPLIANCE_RECORDS CASCADE;
DROP TABLE IF EXISTS RENEWABLE_ASSETS CASCADE;
DROP TABLE IF EXISTS WATER_QUOTA CASCADE;
DROP TABLE IF EXISTS LAND_PARCEL CASCADE;

-- 1. Enable Professional Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Land Parcel Table
CREATE TABLE LAND_PARCEL (
    parcel_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    geo_boundary GEOMETRY(Polygon, 4326) NOT NULL,
    area_sqm NUMERIC(12,2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Spatial Index
CREATE INDEX idx_parcel_geometry ON LAND_PARCEL USING GIST (geo_boundary);

-- Prevent Overlap Trigger .
CREATE OR REPLACE FUNCTION prevent_parcel_overlap()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM LAND_PARCEL 
        WHERE parcel_id != NEW.parcel_id 
        AND ST_Intersects(geo_boundary, NEW.geo_boundary)
        AND NOT ST_Touches(geo_boundary, NEW.geo_boundary)
    ) THEN
        RAISE EXCEPTION 'Spatial Integrity Violation: Parcel overlaps with an existing registered parcel.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_overlap
BEFORE INSERT OR UPDATE ON LAND_PARCEL
FOR EACH ROW EXECUTE FUNCTION prevent_parcel_overlap();

-- 3. Ownership System (New DB Heavy Architecture)
CREATE TABLE LAND_OWNERS (
    owner_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_name VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50) NOT NULL, -- 'Government', 'Corporate', 'Private'
    contact_info VARCHAR(255)
);

CREATE TABLE TITLE_DEED (
    deed_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_id UUID REFERENCES LAND_PARCEL(parcel_id) NOT NULL,
    owner_id UUID REFERENCES LAND_OWNERS(owner_id) NOT NULL,
    issue_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'ACTIVE' -- 'ACTIVE' or 'TRANSFERRED'
);

CREATE TABLE COMPLIANCE_RECORDS (
    record_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES LAND_OWNERS(owner_id) NOT NULL,
    violation_type VARCHAR(100) NOT NULL,
    severity_score INT CHECK (severity_score >= 1 AND severity_score <= 10),
    incident_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Stored Procedure to Transfer Ownership (ACID Compliant)
CREATE OR REPLACE PROCEDURE transfer_ownership(p_parcel_id UUID, p_new_owner_id UUID)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Lock row securely to prevent deadlocks
    PERFORM *
    FROM TITLE_DEED
    WHERE parcel_id = p_parcel_id AND status = 'ACTIVE'
    FOR UPDATE;

    -- Invalidate current active deed
    UPDATE TITLE_DEED 
    SET status = 'TRANSFERRED' 
    WHERE parcel_id = p_parcel_id AND status = 'ACTIVE';

    -- Issue new deed
    INSERT INTO TITLE_DEED (parcel_id, owner_id, status)
    VALUES (p_parcel_id, p_new_owner_id, 'ACTIVE');

    COMMIT;

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE NOTICE 'Transfer failed';
END;
$$;


-- 4. Water Quota Table
CREATE TABLE WATER_QUOTA (
    quota_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_id UUID REFERENCES LAND_PARCEL(parcel_id) UNIQUE,
    deed_id UUID REFERENCES TITLE_DEED(deed_id),
    season_year INT NOT NULL,
    gallons_remaining NUMERIC(12,2) CHECK (gallons_remaining >= 0),
    description TEXT,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Renewable Energy Assets
CREATE TABLE RENEWABLE_ASSETS (
    asset_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_id UUID REFERENCES LAND_PARCEL(parcel_id),
    deed_id UUID REFERENCES TITLE_DEED(deed_id),
    asset_type VARCHAR(50), 
    capacity_kw NUMERIC(12,2) DEFAULT 0.00,
    carbon_credits_available NUMERIC(12,2) DEFAULT 0.00,
    description TEXT
);

-- 6. Audit Log Table (Enterprise Partitioning)
CREATE TABLE AUDIT_LOG (
    log_id UUID DEFAULT uuid_generate_v4(),
    table_name VARCHAR(50),
    record_id UUID,
    deed_id UUID,
    action_type VARCHAR(10),
    old_value JSONB,
    new_value JSONB,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hash VARCHAR(64),
    previous_hash VARCHAR(64),
    PRIMARY KEY (log_id, changed_at)
) PARTITION BY RANGE (changed_at);

-- Create Partitions
CREATE TABLE AUDIT_LOG_Y2026 PARTITION OF AUDIT_LOG FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE AUDIT_LOG_Y2027 PARTITION OF AUDIT_LOG FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- Window Function View (Analytics)
CREATE OR REPLACE VIEW VW_ENERGY_RANKINGS AS
SELECT 
    asset_id,
    asset_type,
    capacity_kw,
    RANK() OVER (PARTITION BY asset_type ORDER BY capacity_kw DESC) as regional_rank,
    AVG(capacity_kw) OVER () as global_avg_capacity
FROM RENEWABLE_ASSETS;

-- Automated Audit Trigger
CREATE OR REPLACE FUNCTION log_transaction()
RETURNS TRIGGER AS $$
DECLARE
    v_old_data JSONB;
    v_new_data JSONB;
    v_prev_hash VARCHAR(64);
    v_new_hash VARCHAR(64);
    v_record_id UUID;
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        v_old_data := row_to_json(OLD)::JSONB;
        v_new_data := row_to_json(NEW)::JSONB;
        BEGIN
            v_record_id := NEW.parcel_id;
        EXCEPTION WHEN OTHERS THEN
            v_record_id := NULL;
        END;
    ELSIF (TG_OP = 'DELETE') THEN
        v_old_data := row_to_json(OLD)::JSONB;
        BEGIN
            v_record_id := OLD.parcel_id;
        EXCEPTION WHEN OTHERS THEN
            v_record_id := NULL;
        END;
    ELSIF (TG_OP = 'INSERT') THEN
        v_new_data := row_to_json(NEW)::JSONB;
        BEGIN
            v_record_id := NEW.parcel_id;
        EXCEPTION WHEN OTHERS THEN
            v_record_id := NULL;
        END;
    END IF;

    -- For TITLE_DEED, we might want to log deed_id
    IF TG_TABLE_NAME = 'title_deed' THEN
        IF TG_OP = 'INSERT' THEN v_record_id := NEW.deed_id; END IF;
        IF TG_OP = 'UPDATE' THEN v_record_id := NEW.deed_id; END IF;
    END IF;

    -- Get previous hash
    SELECT hash INTO v_prev_hash FROM AUDIT_LOG ORDER BY changed_at DESC LIMIT 1;
    IF v_prev_hash IS NULL THEN
        v_prev_hash := encode(digest('GENESIS', 'sha256'), 'hex');
    END IF;

    -- Calculate new hash
    v_new_hash := encode(digest(
        COALESCE(v_prev_hash, '') || 
        TG_TABLE_NAME || 
        TG_OP || 
        COALESCE(v_old_data::TEXT, '') || 
        COALESCE(v_new_data::TEXT, '') || 
        CURRENT_TIMESTAMP::TEXT, 
        'sha256'
    ), 'hex');

    INSERT INTO AUDIT_LOG (table_name, record_id, action_type, old_value, new_value, hash, previous_hash)
    VALUES (TG_TABLE_NAME, v_record_id, TG_OP, v_old_data, v_new_data, v_new_hash, v_prev_hash);

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_land_parcel AFTER INSERT OR UPDATE OR DELETE ON LAND_PARCEL FOR EACH ROW EXECUTE FUNCTION log_transaction();
CREATE TRIGGER audit_water_quota AFTER INSERT OR UPDATE OR DELETE ON WATER_QUOTA FOR EACH ROW EXECUTE FUNCTION log_transaction();
CREATE TRIGGER audit_renewable_assets AFTER INSERT OR UPDATE OR DELETE ON RENEWABLE_ASSETS FOR EACH ROW EXECUTE FUNCTION log_transaction();
CREATE TRIGGER audit_title_deed AFTER INSERT OR UPDATE OR DELETE ON TITLE_DEED FOR EACH ROW EXECUTE FUNCTION log_transaction();
CREATE TRIGGER audit_compliance_records AFTER INSERT OR UPDATE OR DELETE ON COMPLIANCE_RECORDS FOR EACH ROW EXECUTE FUNCTION log_transaction();

-- 7. Materialized View for Dashboard Metrics
CREATE MATERIALIZED VIEW MV_SUSTAINABILITY_METRICS AS
SELECT 
    COUNT(p.parcel_id) as total_parcels,
    SUM(p.area_sqm) as total_registered_area_sqm,
    SUM(w.gallons_remaining) as total_water_reserves,
    SUM(r.capacity_kw) as total_renewable_capacity_kw,
    SUM(r.carbon_credits_available) as total_carbon_credits
FROM LAND_PARCEL p
LEFT JOIN WATER_QUOTA w ON p.parcel_id = w.parcel_id
LEFT JOIN RENEWABLE_ASSETS r ON p.parcel_id = r.parcel_id;

-- Seed Data

-- Create Owners
INSERT INTO LAND_OWNERS (owner_id, owner_name, entity_type, contact_info) VALUES 
('11111111-1111-1111-1111-111111111111', 'State Government', 'Government', 'gov@state.gov'),
('22222222-2222-2222-2222-222222222222', 'GreenTech Corp', 'Corporate', 'contact@greentech.io'),
('33333333-3333-3333-3333-333333333333', 'Private Citizen A', 'Private', 'citizen.a@email.com');

-- Create Parcels
INSERT INTO LAND_PARCEL (parcel_id, geo_boundary, area_sqm)
VALUES (
    '381cb099-0ba9-43ca-acda-a2e1b5828790', 
    ST_GeomFromText('POLYGON((0 0, 0 0.0001, 0.0001 0.0001, 0.0001 0, 0 0))', 4326),
    100.00
);

INSERT INTO LAND_PARCEL (parcel_id, geo_boundary, area_sqm)
VALUES (
    '9be4a7da-bad8-4f53-820e-88a35820f4a0', 
    ST_GeomFromText('POLYGON((0 0.0001, 0 0.0002, 0.0001 0.0002, 0.0001 0.0001, 0 0.0001))', 4326),
    100.00
);

-- Create Deeds
INSERT INTO TITLE_DEED (deed_id, parcel_id, owner_id, status) VALUES 
('44444444-4444-4444-4444-444444444444', '381cb099-0ba9-43ca-acda-a2e1b5828790', '11111111-1111-1111-1111-111111111111', 'ACTIVE'),
('55555555-5555-5555-5555-555555555555', '9be4a7da-bad8-4f53-820e-88a35820f4a0', '33333333-3333-3333-3333-333333333333', 'ACTIVE');

-- Create Assets
INSERT INTO WATER_QUOTA (parcel_id, deed_id, season_year, gallons_remaining, description)
VALUES ('381cb099-0ba9-43ca-acda-a2e1b5828790', '44444444-4444-4444-4444-444444444444', 2026, 50000.00, 'Critical water reservoir for local district. High conservation priority.');

INSERT INTO WATER_QUOTA (parcel_id, deed_id, season_year, gallons_remaining, description)
VALUES ('9be4a7da-bad8-4f53-820e-88a35820f4a0', '55555555-5555-5555-5555-555555555555', 2026, 10000.00, 'Residential rainwater harvesting quota limit.');

INSERT INTO RENEWABLE_ASSETS (parcel_id, deed_id, asset_type, capacity_kw, carbon_credits_available, description)
VALUES ('381cb099-0ba9-43ca-acda-a2e1b5828790', '44444444-4444-4444-4444-444444444444', 'Solar', 500.00, 100.00, 'High potential for solar hub due to minimal shading.');

INSERT INTO RENEWABLE_ASSETS (parcel_id, deed_id, asset_type, capacity_kw, carbon_credits_available, description)
VALUES ('9be4a7da-bad8-4f53-820e-88a35820f4a0', '55555555-5555-5555-5555-555555555555', 'Wind', 200.00, 50.00, 'Secondary wind mill installation on residential border.');

-- Create Compliance Records
INSERT INTO COMPLIANCE_RECORDS (owner_id, violation_type, severity_score, description)
VALUES ('22222222-2222-2222-2222-222222222222', 'ILLEGAL_DUMPING', 8, 'Found dumping chemical waste into the adjacent river system.');

-- ==========================================
-- ENTERPRISE ROADMAP FEATURES
-- ==========================================

-- 1. CARBON_CREDITS Table & Procedure (Loops & Cursors)
DROP TABLE IF EXISTS CARBON_CREDITS CASCADE;
CREATE TABLE CARBON_CREDITS (
    credit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES RENEWABLE_ASSETS(asset_id),
    credits_earned NUMERIC(12,2),
    issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE PROCEDURE distribute_carbon_credits()
LANGUAGE plpgsql AS $$
DECLARE
    asset_record RECORD;
    v_credits NUMERIC;
BEGIN
    FOR asset_record IN SELECT asset_id, capacity_kw FROM RENEWABLE_ASSETS LOOP
        v_credits := asset_record.capacity_kw * 0.75;
        INSERT INTO CARBON_CREDITS(asset_id, credits_earned, issued_at)
        VALUES (asset_record.asset_id, v_credits, CURRENT_TIMESTAMP);
    END LOOP;
END;
$$;

-- 2. Recursive Illegal Encroachment Detection (CTE View)
CREATE OR REPLACE VIEW VW_OVERLAP_CHAIN AS
WITH RECURSIVE overlap_chain AS (
    SELECT parcel_id, geo_boundary, 1 as chain_depth
    FROM LAND_PARCEL
    WHERE parcel_id = (SELECT parcel_id FROM LAND_PARCEL LIMIT 1) -- Arbitrary start for testing
    UNION
    SELECT lp.parcel_id, lp.geo_boundary, oc.chain_depth + 1
    FROM LAND_PARCEL lp
    INNER JOIN overlap_chain oc ON ST_Intersects(lp.geo_boundary, oc.geo_boundary)
    WHERE lp.parcel_id != oc.parcel_id AND oc.chain_depth < 5
)
SELECT * FROM overlap_chain;

-- 3. Trigger-Based Sustainability Score Auto-Update
ALTER TABLE LAND_PARCEL ADD COLUMN IF NOT EXISTS sustainability_score NUMERIC(10,2) DEFAULT 0;

CREATE OR REPLACE FUNCTION update_esg_score() RETURNS TRIGGER AS $$
DECLARE
    v_solar NUMERIC := 0;
    v_trees NUMERIC := 0;
BEGIN
    SELECT COALESCE(SUM(capacity_kw), 0) INTO v_solar FROM RENEWABLE_ASSETS WHERE parcel_id = NEW.parcel_id AND asset_type ILIKE '%Solar%';
    SELECT COALESCE(SUM(capacity_kw), 0) INTO v_trees FROM RENEWABLE_ASSETS WHERE parcel_id = NEW.parcel_id AND asset_type ILIKE '%Forest%';
    
    UPDATE LAND_PARCEL
    SET sustainability_score = (v_trees * 2) + (v_solar * 5)
    WHERE parcel_id = NEW.parcel_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_esg ON RENEWABLE_ASSETS;
CREATE TRIGGER trg_update_esg
AFTER INSERT OR UPDATE ON RENEWABLE_ASSETS
FOR EACH ROW EXECUTE FUNCTION update_esg_score();

-- 5. Bulk Data Validation Using Cursors
DROP TABLE IF EXISTS ERROR_LOG CASCADE;
CREATE TABLE ERROR_LOG (
    log_id SERIAL PRIMARY KEY,
    parcel_id UUID,
    error_message TEXT,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE PROCEDURE validate_parcels()
LANGUAGE plpgsql AS $$
DECLARE
    parcel_cursor CURSOR FOR SELECT parcel_id, geo_boundary FROM LAND_PARCEL;
    v_parcel RECORD;
BEGIN
    OPEN parcel_cursor;
    LOOP
        FETCH parcel_cursor INTO v_parcel;
        EXIT WHEN NOT FOUND;
        IF ST_Area(v_parcel.geo_boundary) <= 0 THEN
            INSERT INTO ERROR_LOG(parcel_id, error_message) VALUES(v_parcel.parcel_id, 'Invalid Area <= 0');
        END IF;
    END LOOP;
    CLOSE parcel_cursor;
END;
$$;

-- 6. Fraud Detection Trigger
CREATE OR REPLACE FUNCTION detect_fraud() RETURNS TRIGGER AS $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM TITLE_DEED
    WHERE owner_id = NEW.owner_id AND parcel_id = NEW.parcel_id AND status = 'ACTIVE';

    IF v_count > 0 THEN
        RAISE EXCEPTION 'Fraudulent duplicate ownership detected';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_detect_fraud ON TITLE_DEED;
CREATE TRIGGER trg_detect_fraud
BEFORE INSERT ON TITLE_DEED
FOR EACH ROW EXECUTE FUNCTION detect_fraud();

-- 7. Dynamic SQL Report Generator
ALTER TABLE LAND_PARCEL ADD COLUMN IF NOT EXISTS region TEXT DEFAULT 'Global Node';

CREATE OR REPLACE FUNCTION generate_region_report(p_region TEXT)
RETURNS TABLE(parcel_id UUID, area NUMERIC)
LANGUAGE plpgsql AS $$
DECLARE
    sql_query TEXT;
BEGIN
    sql_query := 'SELECT parcel_id, area_sqm FROM LAND_PARCEL WHERE region = ' || quote_literal(p_region);
    RETURN QUERY EXECUTE sql_query;
END;
$$;

-- ==========================================
-- ENTERPRISE EXTENSION (ACTIVE MODULES)
-- ==========================================

-- 1. Carbon Credit Engine
CREATE TABLE SUSTAINABILITY_METRICS (
    metric_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_id UUID,
    carbon_tons NUMERIC(10,2),
    water_saved_liters NUMERIC(12,2),
    biodiversity_index NUMERIC(5,2),
    energy_generated_kwh NUMERIC(12,2),
    calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. AI/ML Prediction Tables
CREATE TABLE ML_PREDICTIONS (
    prediction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_id UUID,
    model_name VARCHAR(50),
    predicted_value NUMERIC,
    confidence_score NUMERIC(5,2),
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Materialized Sustainability Dashboards
CREATE MATERIALIZED VIEW MV_STATE_SUSTAINABILITY AS
SELECT 
    COUNT(metric_id) as total_metrics,
    SUM(carbon_tons) as total_carbon_offset,
    AVG(biodiversity_index) as avg_biodiversity
FROM SUSTAINABILITY_METRICS;
