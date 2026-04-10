CREATE TABLE IF NOT EXISTS voters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  e_first_name text,
  e_middle_name text,
  sex text,
  age integer,
  vcardid text,
  house_no text,
  part_no text,
  srno text,
  boothid text,
  familyid text,
  full_name text,
  e_assemblyname text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voters_vcardid ON voters (vcardid);
CREATE INDEX IF NOT EXISTS idx_voters_e_assemblyname ON voters (e_assemblyname);

ALTER TABLE voters ENABLE ROW LEVEL SECURITY;
