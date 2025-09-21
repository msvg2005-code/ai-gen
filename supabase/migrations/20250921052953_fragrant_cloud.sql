/*
  # Location Management Tables

  1. New Tables
    - `states` - Indian states
    - `districts` - Districts within states
    - `areas` - Areas within districts
    - `departments` - Government departments
    - `issue_assignments` - Track issue assignments

  2. Security
    - Enable RLS on all tables
    - Add appropriate policies
*/

-- Create states table
CREATE TABLE IF NOT EXISTS states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  code text NOT NULL UNIQUE,
  country text DEFAULT 'India',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create districts table
CREATE TABLE IF NOT EXISTS districts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id uuid REFERENCES states(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(state_id, code)
);

-- Create areas table
CREATE TABLE IF NOT EXISTS areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id uuid REFERENCES districts(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  code text NOT NULL,
  description text,
  population integer,
  area_sq_km decimal(10, 2),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(district_id, code)
);

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  category text NOT NULL CHECK (category IN ('administration', 'public_works', 'utilities', 'environment', 'safety', 'parks', 'planning', 'finance')),
  description text,
  head_official_id uuid,
  contact_email text,
  contact_phone text,
  office_address text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create issue assignments table
CREATE TABLE IF NOT EXISTS issue_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid REFERENCES issues(id) ON DELETE CASCADE NOT NULL,
  assigned_by uuid REFERENCES profiles(id) ON DELETE SET NULL NOT NULL,
  assigned_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  assignment_type text NOT NULL CHECK (assignment_type IN ('user', 'department', 'contractor')),
  assignment_notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE states ENABLE ROW LEVEL SECURITY;
ALTER TABLE districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_assignments ENABLE ROW LEVEL SECURITY;

-- Location tables policies (public read access)
CREATE POLICY "Anyone can read states"
  ON states FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Anyone can read districts"
  ON districts FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Anyone can read areas"
  ON areas FOR SELECT TO authenticated
  USING (is_active = true);

CREATE POLICY "Anyone can read departments"
  ON departments FOR SELECT TO authenticated
  USING (is_active = true);

-- Assignment policies
CREATE POLICY "Anyone can read assignments"
  ON issue_assignments FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can create assignments"
  ON issue_assignments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND user_type IN ('admin', 'area_super_admin', 'department_admin')
    )
  );

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_districts_state_id ON districts(state_id);
CREATE INDEX IF NOT EXISTS idx_areas_district_id ON areas(district_id);
CREATE INDEX IF NOT EXISTS idx_departments_category ON departments(category);
CREATE INDEX IF NOT EXISTS idx_issue_assignments_issue_id ON issue_assignments(issue_id);

-- Insert Indian states
INSERT INTO states (name, code) VALUES
('Andhra Pradesh', 'AP'),
('Arunachal Pradesh', 'AR'),
('Assam', 'AS'),
('Bihar', 'BR'),
('Chhattisgarh', 'CG'),
('Goa', 'GA'),
('Gujarat', 'GJ'),
('Haryana', 'HR'),
('Himachal Pradesh', 'HP'),
('Jharkhand', 'JH'),
('Karnataka', 'KA'),
('Kerala', 'KL'),
('Madhya Pradesh', 'MP'),
('Maharashtra', 'MH'),
('Manipur', 'MN'),
('Meghalaya', 'ML'),
('Mizoram', 'MZ'),
('Nagaland', 'NL'),
('Odisha', 'OR'),
('Punjab', 'PB'),
('Rajasthan', 'RJ'),
('Sikkim', 'SK'),
('Tamil Nadu', 'TN'),
('Telangana', 'TG'),
('Tripura', 'TR'),
('Uttar Pradesh', 'UP'),
('Uttarakhand', 'UK'),
('West Bengal', 'WB'),
('Delhi', 'DL'),
('Jammu and Kashmir', 'JK'),
('Ladakh', 'LA'),
('Chandigarh', 'CH'),
('Dadra and Nagar Haveli and Daman and Diu', 'DN'),
('Lakshadweep', 'LD'),
('Puducherry', 'PY'),
('Andaman and Nicobar Islands', 'AN')
ON CONFLICT (code) DO NOTHING;

-- Insert sample districts for major states
DO $$
DECLARE
  state_record RECORD;
BEGIN
  -- Maharashtra districts
  SELECT id INTO state_record FROM states WHERE code = 'MH';
  IF FOUND THEN
    INSERT INTO districts (state_id, name, code) VALUES
    (state_record.id, 'Mumbai', 'MUM'),
    (state_record.id, 'Pune', 'PUN'),
    (state_record.id, 'Nagpur', 'NAG'),
    (state_record.id, 'Nashik', 'NAS'),
    (state_record.id, 'Aurangabad', 'AUR')
    ON CONFLICT (state_id, code) DO NOTHING;
  END IF;

  -- Delhi districts
  SELECT id INTO state_record FROM states WHERE code = 'DL';
  IF FOUND THEN
    INSERT INTO districts (state_id, name, code) VALUES
    (state_record.id, 'Central Delhi', 'CD'),
    (state_record.id, 'North Delhi', 'ND'),
    (state_record.id, 'South Delhi', 'SD'),
    (state_record.id, 'East Delhi', 'ED'),
    (state_record.id, 'West Delhi', 'WD')
    ON CONFLICT (state_id, code) DO NOTHING;
  END IF;

  -- Karnataka districts
  SELECT id INTO state_record FROM states WHERE code = 'KA';
  IF FOUND THEN
    INSERT INTO districts (state_id, name, code) VALUES
    (state_record.id, 'Bangalore Urban', 'BU'),
    (state_record.id, 'Mysore', 'MYS'),
    (state_record.id, 'Hubli-Dharwad', 'HD'),
    (state_record.id, 'Mangalore', 'MAN'),
    (state_record.id, 'Belgaum', 'BEL')
    ON CONFLICT (state_id, code) DO NOTHING;
  END IF;
END $$;

-- Insert sample areas for major districts
DO $$
DECLARE
  district_record RECORD;
BEGIN
  -- Mumbai areas
  SELECT id INTO district_record FROM districts WHERE code = 'MUM';
  IF FOUND THEN
    INSERT INTO areas (district_id, name, code, description) VALUES
    (district_record.id, 'Andheri', 'AND', 'Western suburb area'),
    (district_record.id, 'Bandra', 'BAN', 'Central Mumbai area'),
    (district_record.id, 'Colaba', 'COL', 'South Mumbai area'),
    (district_record.id, 'Dadar', 'DAD', 'Central Mumbai area'),
    (district_record.id, 'Malad', 'MAL', 'Western suburb area')
    ON CONFLICT (district_id, code) DO NOTHING;
  END IF;

  -- Delhi areas
  SELECT id INTO district_record FROM districts WHERE code = 'CD';
  IF FOUND THEN
    INSERT INTO areas (district_id, name, code, description) VALUES
    (district_record.id, 'Connaught Place', 'CP', 'Central business district'),
    (district_record.id, 'Karol Bagh', 'KB', 'Commercial area'),
    (district_record.id, 'Paharganj', 'PG', 'Tourist area'),
    (district_record.id, 'Rajouri Garden', 'RG', 'Residential area'),
    (district_record.id, 'Lajpat Nagar', 'LN', 'Market area')
    ON CONFLICT (district_id, code) DO NOTHING;
  END IF;

  -- Bangalore areas
  SELECT id INTO district_record FROM districts WHERE code = 'BU';
  IF FOUND THEN
    INSERT INTO areas (district_id, name, code, description) VALUES
    (district_record.id, 'Koramangala', 'KOR', 'IT hub area'),
    (district_record.id, 'Indiranagar', 'IND', 'Upscale residential area'),
    (district_record.id, 'Whitefield', 'WHI', 'IT corridor'),
    (district_record.id, 'Jayanagar', 'JAY', 'Traditional residential area'),
    (district_record.id, 'Electronic City', 'EC', 'IT park area')
    ON CONFLICT (district_id, code) DO NOTHING;
  END IF;
END $$;

-- Insert departments
INSERT INTO departments (name, code, category, description, contact_email, contact_phone) VALUES
('Public Works Department', 'PWD', 'public_works', 'Roads, bridges, and infrastructure maintenance', 'pwd@city.gov', '+1-555-0201'),
('Water and Utilities Department', 'WUD', 'utilities', 'Water supply, sewage, and utility services', 'water@city.gov', '+1-555-0202'),
('Parks and Recreation Department', 'PRD', 'parks', 'Parks, gardens, and recreational facilities', 'parks@city.gov', '+1-555-0203'),
('Environmental Services Department', 'ESD', 'environment', 'Waste management and environmental protection', 'environment@city.gov', '+1-555-0204'),
('Public Safety Department', 'PSD', 'safety', 'Public safety and emergency services', 'safety@city.gov', '+1-555-0205'),
('Urban Planning Department', 'UPD', 'planning', 'City planning and development', 'planning@city.gov', '+1-555-0206'),
('Finance Department', 'FIN', 'finance', 'Budget and financial management', 'finance@city.gov', '+1-555-0207'),
('Administration Department', 'ADM', 'administration', 'General administration and governance', 'admin@city.gov', '+1-555-0208')
ON CONFLICT (code) DO NOTHING;

-- Add workflow_stage and current_assignee_id columns to issues if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issues' AND column_name = 'workflow_stage'
  ) THEN
    ALTER TABLE issues ADD COLUMN workflow_stage text DEFAULT 'reported' CHECK (workflow_stage IN ('reported', 'area_review', 'department_assigned', 'contractor_assigned', 'in_progress', 'department_review', 'resolved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issues' AND column_name = 'current_assignee_id'
  ) THEN
    ALTER TABLE issues ADD COLUMN current_assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issues' AND column_name = 'assigned_area_id'
  ) THEN
    ALTER TABLE issues ADD COLUMN assigned_area_id uuid REFERENCES areas(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issues' AND column_name = 'assigned_department_id'
  ) THEN
    ALTER TABLE issues ADD COLUMN assigned_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'issues' AND column_name = 'final_resolution_notes'
  ) THEN
    ALTER TABLE issues ADD COLUMN final_resolution_notes text;
  END IF;
END $$;

-- Add department_id to tenders if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenders' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE tenders ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenders' AND column_name = 'source_issue_id'
  ) THEN
    ALTER TABLE tenders ADD COLUMN source_issue_id uuid REFERENCES issues(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Update profiles table to support new admin types and assignments
DO $$
BEGIN
  -- Update user_type check constraint
  ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_type_check;
  ALTER TABLE profiles ADD CONSTRAINT profiles_user_type_check 
    CHECK (user_type IN ('citizen', 'user', 'admin', 'area_super_admin', 'department_admin', 'contractor', 'tender'));

  -- Add assignment columns if they don't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'assigned_area_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN assigned_area_id uuid REFERENCES areas(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'assigned_department_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN assigned_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'level'
  ) THEN
    ALTER TABLE profiles ADD COLUMN level integer DEFAULT 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'badges'
  ) THEN
    ALTER TABLE profiles ADD COLUMN badges text[] DEFAULT ARRAY[]::text[];
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_districts_state_id ON districts(state_id);
CREATE INDEX IF NOT EXISTS idx_areas_district_id ON areas(district_id);
CREATE INDEX IF NOT EXISTS idx_departments_category ON departments(category);
CREATE INDEX IF NOT EXISTS idx_issue_assignments_issue_id ON issue_assignments(issue_id);
CREATE INDEX IF NOT EXISTS idx_profiles_assigned_area ON profiles(assigned_area_id);
CREATE INDEX IF NOT EXISTS idx_profiles_assigned_department ON profiles(assigned_department_id);

-- Create triggers for updated_at
CREATE TRIGGER update_states_updated_at BEFORE UPDATE ON states FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_districts_updated_at BEFORE UPDATE ON districts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_areas_updated_at BEFORE UPDATE ON areas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_issue_assignments_updated_at BEFORE UPDATE ON issue_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();