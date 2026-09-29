CREATE OR REPLACE PROCEDURE public.register_new_parcel(IN p_lat double precision, IN p_lng double precision, IN p_solar_kw integer, IN p_trees integer)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    new_parcel_id UUID;
BEGIN
    -- 1. Create the land parcel as a spatial polygon (square around the point).
    INSERT INTO LAND_PARCEL (geo_boundary, area_sqm)
    VALUES (ST_SetSRID(ST_MakeEnvelope(p_lng - 0.0005, p_lat - 0.0005, p_lng + 0.0005, p_lat + 0.0005), 4326), 1000)
    RETURNING parcel_id INTO new_parcel_id;

    -- 2. Register the Solar Asset
    IF p_solar_kw > 0 THEN
        INSERT INTO RENEWABLE_ASSETS (parcel_id, asset_type, capacity_kw)
        VALUES (new_parcel_id, 'Solar', p_solar_kw);
    END IF;

    -- 3. Log it in the 3NF Ledger
    -- Cast to jsonb instead of text
    INSERT INTO audit_log (parcel_id, action_type, new_value)
    VALUES (new_parcel_id, 'NEW_LAND_REGISTERED', json_build_object('solar', p_solar_kw, 'trees', p_trees)::jsonb);
END;
$procedure$;
