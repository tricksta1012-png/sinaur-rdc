-- Migration 019: Convert JSONB geometry columns to PostGIS GEOMETRY
-- Applies only when PostGIS is available and columns are still JSONB type.
-- Safe to run multiple times (checks column type before converting).

DO $$
BEGIN
  -- admin_divisions
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_divisions' AND column_name = 'geometry' AND udt_name = 'jsonb'
  ) AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'st_geomfromgeojson') THEN
    ALTER TABLE admin_divisions
      ALTER COLUMN geometry TYPE GEOMETRY(MultiPolygon, 4326)
        USING CASE WHEN geometry IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_GeomFromGeoJSON(geometry::text), 4326) END,
      ALTER COLUMN centroid TYPE GEOMETRY(Point, 4326)
        USING CASE WHEN centroid IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_GeomFromGeoJSON(centroid::text), 4326) END;
    CREATE INDEX IF NOT EXISTS admin_divisions_geometry_idx ON admin_divisions USING GIST (geometry);
    CREATE INDEX IF NOT EXISTS admin_divisions_centroid_idx ON admin_divisions USING GIST (centroid);
    RAISE NOTICE 'admin_divisions: geometry columns converted to PostGIS';
  END IF;

  -- disaster_events
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'disaster_events' AND column_name = 'location_point' AND udt_name = 'jsonb'
  ) AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'st_geomfromgeojson') THEN
    ALTER TABLE disaster_events
      ALTER COLUMN location_point TYPE GEOMETRY(Point, 4326)
        USING CASE WHEN location_point IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_GeomFromGeoJSON(location_point::text), 4326) END;
    DROP INDEX IF EXISTS disaster_events_location_point_idx;
    CREATE INDEX disaster_events_location_point_idx ON disaster_events USING GIST (location_point);
    RAISE NOTICE 'disaster_events: location_point converted to PostGIS';
  END IF;

  -- cap_alerts
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cap_alerts' AND column_name = 'target_geometry' AND udt_name = 'jsonb'
  ) AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'st_geomfromgeojson') THEN
    ALTER TABLE cap_alerts
      ALTER COLUMN target_geometry TYPE GEOMETRY(MultiPolygon, 4326)
        USING CASE WHEN target_geometry IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_GeomFromGeoJSON(target_geometry::text), 4326) END;
    DROP INDEX IF EXISTS cap_alerts_target_geom_idx;
    CREATE INDEX cap_alerts_target_geom_idx ON cap_alerts USING GIST (target_geometry);
    RAISE NOTICE 'cap_alerts: target_geometry converted to PostGIS';
  END IF;

  -- beneficiaries
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beneficiaries' AND column_name = 'location_point' AND udt_name = 'jsonb'
  ) AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'st_geomfromgeojson') THEN
    ALTER TABLE beneficiaries
      ALTER COLUMN location_point TYPE GEOMETRY(Point, 4326)
        USING CASE WHEN location_point IS NULL THEN NULL
                   ELSE ST_SetSRID(ST_GeomFromGeoJSON(location_point::text), 4326) END;
    DROP INDEX IF EXISTS beneficiaries_location_point_idx;
    CREATE INDEX beneficiaries_location_point_idx ON beneficiaries USING GIST (location_point);
    RAISE NOTICE 'beneficiaries: location_point converted to PostGIS';
  END IF;
END $$;
