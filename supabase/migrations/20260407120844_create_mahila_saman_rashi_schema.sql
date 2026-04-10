/*
  # Women Registration Program — application schema

  1. New Tables
    - `users`
      - `id` (uuid, primary key)
      - `name` (text)
      - `mobile` (text, unique)
      - `otp` (text, nullable)
      - `otp_created_at` (timestamptz, nullable)
      - `is_verified` (boolean, default false)
      - `created_at` (timestamptz)
    
    - `locations`
      - `id` (uuid, primary key)
      - `state` (text)
      - `district` (text)
      - `assembly` (text)
      - `halka` (text)
      - `village` (text)
      - `booth_number` (text, nullable)
      - `created_at` (timestamptz)
    
    - `submissions`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key)
      - `sakhi_name` (text)
      - `sakhi_mobile` (text)
      - `father_name` (text)
      - `husband_name` (text)
      - `state` (text)
      - `district` (text)
      - `assembly` (text)
      - `halka` (text)
      - `village` (text)
      - `booth_number` (text)
      - `aadhaar_front_url` (text, nullable)
      - `aadhaar_back_url` (text, nullable)
      - `voter_id_url` (text, nullable)
      - `live_photo_url` (text, nullable)
      - `ocr_data` (jsonb, nullable)
      - `status` (text, default 'pending')
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data

  Note (AWS RDS / vanilla Postgres): Supabase creates roles anon, authenticated, service_role; create them here if missing.
*/

-- Supabase-compatible roles — required before CREATE POLICY ... TO anon / authenticated; GRANT ... TO service_role
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mobile text UNIQUE NOT NULL,
  otp text,
  otp_created_at timestamptz,
  is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL,
  district text NOT NULL,
  assembly text NOT NULL,
  halka text NOT NULL,
  village text NOT NULL,
  booth_number text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  sakhi_name text NOT NULL,
  sakhi_mobile text NOT NULL,
  father_name text NOT NULL,
  husband_name text NOT NULL,
  state text NOT NULL,
  district text NOT NULL,
  assembly text NOT NULL,
  halka text NOT NULL,
  village text NOT NULL,
  booth_number text,
  aadhaar_front_url text,
  aadhaar_back_url text,
  voter_id_url text,
  live_photo_url text,
  ocr_data jsonb,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  TO authenticated
  USING (mobile = current_setting('app.current_user_mobile', true));

CREATE POLICY "Users can update own data"
  ON users FOR UPDATE
  TO authenticated
  USING (mobile = current_setting('app.current_user_mobile', true))
  WITH CHECK (mobile = current_setting('app.current_user_mobile', true));

CREATE POLICY "Anyone can insert users"
  ON users FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can read locations"
  ON locations FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Users can view own submissions"
  ON submissions FOR SELECT
  TO authenticated
  USING (user_id IN (SELECT id FROM users WHERE mobile = current_setting('app.current_user_mobile', true)));

CREATE POLICY "Users can insert own submissions"
  ON submissions FOR INSERT
  TO authenticated
  WITH CHECK (user_id IN (SELECT id FROM users WHERE mobile = current_setting('app.current_user_mobile', true)));

CREATE POLICY "Users can update own submissions"
  ON submissions FOR UPDATE
  TO authenticated
  USING (user_id IN (SELECT id FROM users WHERE mobile = current_setting('app.current_user_mobile', true)))
  WITH CHECK (user_id IN (SELECT id FROM users WHERE mobile = current_setting('app.current_user_mobile', true)));

CREATE POLICY "Users can delete own submissions"
  ON submissions FOR DELETE
  TO authenticated
  USING (user_id IN (SELECT id FROM users WHERE mobile = current_setting('app.current_user_mobile', true)));

INSERT INTO locations (state, district, assembly, halka, village, booth_number) VALUES
  ('Madhya Pradesh', 'Bhopal', 'Bhopal North', 'Halka 1', 'Village A', '101'),
  ('Madhya Pradesh', 'Bhopal', 'Bhopal North', 'Halka 1', 'Village B', '102'),
  ('Madhya Pradesh', 'Bhopal', 'Bhopal South', 'Halka 2', 'Village C', '201'),
  ('Madhya Pradesh', 'Indore', 'Indore 1', 'Halka 3', 'Village D', '301');
