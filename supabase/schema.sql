-- ============================================================================
-- BAYANIHAN ALERT HUB — SUPABASE FREE-TIER SCHEMA, RLS POLICIES & SEED DATA
-- Target: Philippine Barangay / LGU Typhoon, Flood & Evacuation Tracker
-- Safe to run in Supabase SQL Editor (idempotent where possible).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TABLES
-- ----------------------------------------------------------------------------

-- Verified Barangay Moderators & DRRMO Responders (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.moderator_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  role TEXT NOT NULL CHECK (role IN ('moderator', 'admin')) DEFAULT 'moderator',
  barangay_assigned TEXT NOT NULL DEFAULT 'Quezon City DRRMO',
  municipality_assigned TEXT NOT NULL DEFAULT 'All Municipalities',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Local Evacuation Centers (Schools, Covered Courts, Barangay Halls)
CREATE TABLE IF NOT EXISTS public.evacuation_centers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 3 AND 160),
  region TEXT NOT NULL DEFAULT 'National Capital Region (NCR)',
  barangay TEXT NOT NULL CHECK (char_length(barangay) BETWEEN 2 AND 100),
  city TEXT NOT NULL DEFAULT 'Quezon City',
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Open', 'Near Full', 'Full', 'Closed')) DEFAULT 'Open',
  current_occupancy INTEGER NOT NULL DEFAULT 0 CHECK (current_occupancy >= 0),
  max_capacity INTEGER NOT NULL CHECK (max_capacity > 0),
  notes TEXT NOT NULL DEFAULT '',
  contact_info TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Community & Verified Hazard / Flood Reports
CREATE TABLE IF NOT EXISTS public.hazard_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (
    category IN ('Flooded Roads', 'Power/Comms', 'Evacuation Update', 'Relief/Rescue Needed')
  ),
  severity TEXT NOT NULL CHECK (severity IN ('Low', 'Moderate', 'Severe', 'Critical')),
  region TEXT NOT NULL DEFAULT 'National Capital Region (NCR)',
  municipality TEXT NOT NULL DEFAULT 'Quezon City',
  barangay TEXT NOT NULL CHECK (char_length(barangay) BETWEEN 2 AND 100),
  street_or_landmark TEXT NOT NULL CHECK (char_length(street_or_landmark) BETWEEN 2 AND 200),
  description TEXT NOT NULL CHECK (char_length(description) BETWEEN 5 AND 600),
  flood_level TEXT NOT NULL DEFAULT 'Not Applicable' CHECK (
    flood_level IN ('Not Applicable', 'Ankle-deep', 'Knee-deep', 'Waist-deep', 'Chest-deep+')
  ),
  contact_optional TEXT DEFAULT NULL CHECK (contact_optional IS NULL OR char_length(contact_optional) <= 40),
  is_verified BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved', 'dismissed')) DEFAULT 'active',
  confirmations_count INTEGER NOT NULL DEFAULT 1 CHECK (confirmations_count >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ DEFAULT NULL,
  verified_by UUID REFERENCES public.moderator_profiles(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION DEFAULT NULL,
  longitude DOUBLE PRECISION DEFAULT NULL
);

-- Official LGU / Barangay Advisories
CREATE TABLE IF NOT EXISTS public.advisories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 4 AND 160),
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 10 AND 800),
  severity TEXT NOT NULL CHECK (severity IN ('Advisory', 'Warning', 'Critical')) DEFAULT 'Advisory',
  region TEXT NOT NULL DEFAULT 'National Capital Region (NCR)',
  municipality TEXT NOT NULL DEFAULT 'All Municipalities',
  barangay TEXT NOT NULL DEFAULT 'Citywide',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.moderator_profiles(id) ON DELETE SET NULL
);

-- Idempotent column upgrades for existing deployments
ALTER TABLE public.moderator_profiles
  ADD COLUMN IF NOT EXISTS municipality_assigned TEXT NOT NULL DEFAULT 'All Municipalities';
ALTER TABLE public.evacuation_centers
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'National Capital Region (NCR)';
ALTER TABLE public.hazard_reports
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'National Capital Region (NCR)',
  ADD COLUMN IF NOT EXISTS municipality TEXT NOT NULL DEFAULT 'Quezon City',
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION DEFAULT NULL;
ALTER TABLE public.advisories
  ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT 'National Capital Region (NCR)',
  ADD COLUMN IF NOT EXISTS municipality TEXT NOT NULL DEFAULT 'All Municipalities';

-- ----------------------------------------------------------------------------
-- 2. INDEXES FOR LIGHTWEIGHT FREE-TIER QUERIES
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_hazard_reports_feed
  ON public.hazard_reports (status, created_at DESC)
  WHERE status <> 'dismissed';

CREATE INDEX IF NOT EXISTS idx_hazard_reports_municipality
  ON public.hazard_reports (municipality, status, created_at DESC)
  WHERE status <> 'dismissed';

CREATE INDEX IF NOT EXISTS idx_hazard_reports_category_verified
  ON public.hazard_reports (category, is_verified, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hazard_reports_barangay
  ON public.hazard_reports (barangay);

CREATE INDEX IF NOT EXISTS idx_evacuation_centers_status_barangay
  ON public.evacuation_centers (city, status, barangay);

CREATE INDEX IF NOT EXISTS idx_advisories_active_recent
  ON public.advisories (is_active, municipality, created_at DESC)
  WHERE is_active = true;

-- ----------------------------------------------------------------------------
-- 3. SECURITY HELPERS & TRIGGERS
-- ----------------------------------------------------------------------------

-- Check whether current authenticated user is a registered moderator
CREATE OR REPLACE FUNCTION public.is_verified_moderator()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.moderator_profiles mp
    WHERE mp.id = auth.uid()
      AND mp.role IN ('moderator', 'admin')
  );
$$;

-- Check whether current moderator/admin is allowed to manage a specific municipality
CREATE OR REPLACE FUNCTION public.can_manage_municipality(target_municipality TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.moderator_profiles mp
    WHERE mp.id = auth.uid()
      AND mp.role IN ('moderator', 'admin')
      AND (
        mp.role = 'admin'
        OR mp.municipality_assigned = 'All Municipalities'
        OR lower(mp.municipality_assigned) = lower(coalesce(target_municipality, ''))
      )
  );
$$;

-- Enforce safe defaults on public anonymous report inserts (cannot spoof verified status)
CREATE OR REPLACE FUNCTION public.enforce_anon_hazard_report_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_verified_moderator() THEN
    NEW.is_verified := false;
    NEW.status := 'active';
    NEW.confirmations_count := 1;
    NEW.verified_at := NULL;
    NEW.verified_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_anon_hazard_report_defaults ON public.hazard_reports;
CREATE TRIGGER trg_enforce_anon_hazard_report_defaults
  BEFORE INSERT ON public.hazard_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_anon_hazard_report_defaults();

-- Auto-update updated_at on evacuation_centers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evacuation_centers_updated_at ON public.evacuation_centers;
CREATE TRIGGER trg_evacuation_centers_updated_at
  BEFORE UPDATE ON public.evacuation_centers
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_updated_at();

-- Safe RPC to increment confirmations_count without opening broad UPDATE RLS to anon
CREATE OR REPLACE FUNCTION public.confirm_hazard_report(report_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count INTEGER;
BEGIN
  UPDATE public.hazard_reports
  SET confirmations_count = confirmations_count + 1
  WHERE id = report_id
    AND status = 'active'
  RETURNING confirmations_count INTO new_count;

  IF new_count IS NULL THEN
    RAISE EXCEPTION 'Active report not found';
  END IF;

  RETURN new_count;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_hazard_report(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_hazard_report(UUID) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ----------------------------------------------------------------------------

ALTER TABLE public.moderator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evacuation_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hazard_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisories ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.moderator_profiles TO authenticated;
GRANT SELECT ON public.evacuation_centers, public.hazard_reports, public.advisories TO anon, authenticated;
GRANT INSERT ON public.hazard_reports TO anon, authenticated;
GRANT UPDATE, DELETE ON public.hazard_reports, public.evacuation_centers, public.advisories TO authenticated;
GRANT INSERT ON public.evacuation_centers, public.advisories TO authenticated;

-- moderator_profiles: users can only read their own moderator profile
DROP POLICY IF EXISTS "Moderators read own profile" ON public.moderator_profiles;
CREATE POLICY "Moderators read own profile"
  ON public.moderator_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- evacuation_centers: public read; moderators update/insert/delete
DROP POLICY IF EXISTS "Public read evacuation centers" ON public.evacuation_centers;
CREATE POLICY "Public read evacuation centers"
  ON public.evacuation_centers FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Moderators manage evacuation centers" ON public.evacuation_centers;
CREATE POLICY "Moderators manage evacuation centers"
  ON public.evacuation_centers FOR ALL
  TO authenticated
  USING (public.can_manage_municipality(city))
  WITH CHECK (public.can_manage_municipality(city));

-- hazard_reports: public read non-dismissed; public insert unverified active; moderators update/delete
DROP POLICY IF EXISTS "Public read active and resolved reports" ON public.hazard_reports;
CREATE POLICY "Public read active and resolved reports"
  ON public.hazard_reports FOR SELECT
  TO anon, authenticated
  USING (status <> 'dismissed' OR public.can_manage_municipality(municipality));

DROP POLICY IF EXISTS "Public insert unverified hazard reports" ON public.hazard_reports;
CREATE POLICY "Public insert unverified hazard reports"
  ON public.hazard_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    is_verified = false
    AND status = 'active'
    AND verified_at IS NULL
    AND verified_by IS NULL
  );

DROP POLICY IF EXISTS "Moderators update hazard reports" ON public.hazard_reports;
CREATE POLICY "Moderators update hazard reports"
  ON public.hazard_reports FOR UPDATE
  TO authenticated
  USING (public.can_manage_municipality(municipality))
  WITH CHECK (public.can_manage_municipality(municipality));

DROP POLICY IF EXISTS "Moderators delete hazard reports" ON public.hazard_reports;
CREATE POLICY "Moderators delete hazard reports"
  ON public.hazard_reports FOR DELETE
  TO authenticated
  USING (public.can_manage_municipality(municipality));

-- advisories: public read active advisories; moderators manage all
DROP POLICY IF EXISTS "Public read active advisories" ON public.advisories;
CREATE POLICY "Public read active advisories"
  ON public.advisories FOR SELECT
  TO anon, authenticated
  USING (is_active = true OR public.can_manage_municipality(municipality));

DROP POLICY IF EXISTS "Moderators manage advisories" ON public.advisories;
CREATE POLICY "Moderators manage advisories"
  ON public.advisories FOR ALL
  TO authenticated
  USING (public.can_manage_municipality(municipality))
  WITH CHECK (public.can_manage_municipality(municipality));

-- ----------------------------------------------------------------------------
-- 5. SELECTIVE REALTIME PUBLICATION (FREE-TIER FRIENDLY)
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'hazard_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.hazard_reports;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'evacuation_centers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.evacuation_centers;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'advisories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.advisories;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. SEED DATA (QUEZON CITY / METRO MANILA CONTEXT)
-- ----------------------------------------------------------------------------

INSERT INTO public.evacuation_centers
  (name, barangay, city, address, latitude, longitude, status, current_occupancy, max_capacity, notes, contact_info)
VALUES
  (
    'Bagong Silangan Covered Court & Multi-Purpose Hall',
    'Brgy. Bagong Silangan',
    'Quezon City',
    'JP Rizal St., Bagong Silangan, Quezon City',
    14.7002, 121.1141,
    'Near Full', 385, 450,
    'Elevated second-floor hall open. Hot meals and hygiene kits available; bring own drinking water containers if possible.',
    'Brgy. Desk: (02) 8932-4410'
  ),
  (
    'Rosa Susano Elementary School Evacuation Center',
    'Brgy. Novaliches Proper',
    'Quezon City',
    'Quirino Highway, Novaliches, Quezon City',
    14.7219, 121.0412,
    'Open', 142, 320,
    'Classrooms in Bldg. B & C open for families with infants and senior citizens. Medical triage desk on site.',
    'QCDRRMO Unit 4: (02) 8988-4242'
  ),
  (
    'Brgy. Roxas Covered Court',
    'Brgy. Roxas',
    'Quezon City',
    'Jasmin St. cor. Gumamela St., Roxas District, Quezon City',
    14.6295, 121.0189,
    'Full', 210, 210,
    'At full capacity. Overflow evacuees directed to Diosdado Macapagal Elementary School (400m north).',
    'Brgy. Roxas Hall: (02) 8374-1129'
  ),
  (
    'Diosdado Macapagal Elementary School',
    'Brgy. Tatalon',
    'Quezon City',
    'Kaliraya St., Tatalon, Quezon City',
    14.6261, 121.0138,
    'Open', 190, 500,
    'Accepting evacuees from Tatalon and Roxas low-lying creeks. Dry sleeping mats and generator power active.',
    'Tatalon Rescue: 0917-555-0148'
  ),
  (
    'Payatas B Annex Covered Court',
    'Brgy. Payatas',
    'Quezon City',
    'Ilang-Ilang St., Payatas B, Quezon City',
    14.7168, 121.0987,
    'Open', 96, 280,
    'High-ground shelter clear of landslide slope zones. Pet-friendly kennels set up near north gate.',
    'Payatas Command: (02) 8428-9102'
  ),
  (
    'Santo Domingo Parish Gymnasium',
    'Brgy. Santo Domingo',
    'Quezon City',
    'Quezon Ave. cor. Biak-na-Bato, Quezon City',
    14.6331, 121.0044,
    'Near Full', 265, 300,
    'Charging station active. Approach via Quezon Ave eastbound lane only due to knee-deep water on Biak-na-Bato.',
    'Parish Relief: (02) 8712-6271'
  ),
  (
    'Batasan Hills National High School',
    'Brgy. Batasan Hills',
    'Quezon City',
    'IBP Road, Batasan Hills, Quezon City',
    14.6836, 121.0942,
    'Open', 220, 650,
    'Large staging shelter with DSWD relief packs and Red Cross first-aid tent.',
    'Batasan DRRMO: (02) 8931-7721'
  ),
  (
    'Marikina Riverfront Staging Post (Loyola Border)',
    'Brgy. Loyola Heights',
    'Quezon City',
    'Katipunan Ext. near C5 Access Rd., Quezon City',
    14.6368, 121.0772,
    'Closed', 0, 180,
    'Temporarily closed for electrical inspection; proceed to Ateneo Grade School Gate 1 or Batasan Hills NHS.',
    'QC 122 Helpline'
  );

INSERT INTO public.advisories
  (title, message, severity, barangay, is_active)
VALUES
  (
    'Orange Rainfall Warning — Metro Manila & Rizal Watersheds',
    'PAGASA raises Orange Rainfall Warning over Metro Manila. Intense monsoon rain may cause rapid rise in San Juan River, Tullahan River, and Marikina River tributaries. Residents in low-lying creeks in Tatalon, Roxas, and Bagong Silangan are advised to prepare go-bags and evacuate early.',
    'Critical',
    'Citywide',
    true
  ),
  (
    'Pre-Emptive Evacuation: Tumana & Bagong Silangan Creekside',
    'Barangay Rescue Teams are conducting house-to-house announcements along creekside zones in Bagong Silangan. Covered Court shelter is open with hot meals and charging stations.',
    'Warning',
    'Brgy. Bagong Silangan',
    true
  ),
  (
    'Araneta Ave. Underpass & Biak-na-Bato Traffic Rerouting',
    'MMDA and QC Traffic advise light vehicles to avoid Gregorio Araneta Ave. near Maria Clara due to waist-deep floodwaters. Use E. Rodriguez Sr. Ave. elevated sections instead.',
    'Advisory',
    'Brgy. Tatalon',
    true
  );

INSERT INTO public.hazard_reports
  (category, severity, barangay, street_or_landmark, description, flood_level, contact_optional, is_verified, status, confirmations_count, created_at, verified_at)
VALUES
  (
    'Flooded Roads',
    'Critical',
    'Brgy. Tatalon',
    'G. Araneta Ave. cor. Maria Clara St.',
    'Impassable to sedans and tricycles. Floodwater rising rapidly from San Juan River backflow; MMDA truck en route.',
    'Waist-deep',
    NULL,
    true,
    'active',
    19,
    now() - interval '18 minutes',
    now() - interval '11 minutes'
  ),
  (
    'Relief/Rescue Needed',
    'Critical',
    'Brgy. Bagong Silangan',
    'Sitio Veterans Zone 3, near Chapel',
    'Senior citizen couple (both 74yo) on 2nd floor requesting rubber boat extraction as alley water reaches chest height.',
    'Chest-deep+',
    '0917-842-3910',
    true,
    'active',
    12,
    now() - interval '27 minutes',
    now() - interval '19 minutes'
  ),
  (
    'Flooded Roads',
    'Severe',
    'Brgy. Roxas',
    'Gumamela St. cor. Mother Ignacia Ave.',
    'Gutter-to-knee flooding across two lanes. Heavy trucks can still pass slowly; motorcycles advised to turn back.',
    'Knee-deep',
    NULL,
    true,
    'active',
    8,
    now() - interval '42 minutes',
    now() - interval '30 minutes'
  ),
  (
    'Power/Comms',
    'Severe',
    'Brgy. Payatas',
    'Molave St. near Payatas B Covered Court',
    'Transformer sparked and tripped feeder line; entire block without electricity. Globe/Smart signal intermittent.',
    'Not Applicable',
    NULL,
    false,
    'active',
    6,
    now() - interval '34 minutes',
    NULL
  ),
  (
    'Evacuation Update',
    'Moderate',
    'Brgy. Santo Domingo',
    'Quezon Ave. cor. Biak-na-Bato St.',
    'Santo Domingo Parish Gym still has space for ~35 individuals; drinking water and blankets requested from DSWD.',
    'Knee-deep',
    NULL,
    true,
    'active',
    11,
    now() - interval '55 minutes',
    now() - interval '48 minutes'
  ),
  (
    'Flooded Roads',
    'Moderate',
    'Brgy. Commonwealth',
    'Commonwealth Ave. northbound near Litex Market',
    'Rightmost lane submerged near drainage culvert. Traffic moving slowly on inner lanes.',
    'Ankle-deep',
    NULL,
    false,
    'active',
    4,
    now() - interval '1 hour 12 minutes',
    NULL
  ),
  (
    'Power/Comms',
    'Moderate',
    'Brgy. Batasan Hills',
    'San Mateo Rd. corner IBP Rd.',
    'Fallen acacia branch leaning on fiber telecom lines; passable on westbound lane with caution.',
    'Not Applicable',
    NULL,
    false,
    'active',
    3,
    now() - interval '1 hour 40 minutes',
    NULL
  ),
  (
    'Flooded Roads',
    'Low',
    'Brgy. Novaliches Proper',
    'Quirino Highway near Susano Market',
    'Drainage cleared by barangay crew; water receded back to gutter level and road is passable again.',
    'Ankle-deep',
    NULL,
    true,
    'resolved',
    7,
    now() - interval '3 hours',
    now() - interval '1 hour 5 minutes'
  );

-- ----------------------------------------------------------------------------
-- POST-SETUP INSTRUCTIONS FOR FIRST MODERATOR ACCOUNT:
-- 1. Create a user in Supabase Auth -> Users (e.g., responder@barangay.qc.gov.ph).
-- 2. Copy that user's UUID and insert their profile row:
--    INSERT INTO public.moderator_profiles (id, full_name, role, barangay_assigned)
--    VALUES ('<AUTH_USER_UUID>', 'Capt. Ramon Villanueva', 'admin', 'Brgy. Tatalon DRRMO');
-- ----------------------------------------------------------------------------
