-- Store Offline Sakhi / Google Form imported fields in submissions.
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS source_name text;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS epic text;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS aadhaar_number text;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS dob text;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS gender text;

COMMENT ON COLUMN public.submissions.source_name IS 'Data source e.g. Googleform, SakhiApp';
COMMENT ON COLUMN public.submissions.epic IS 'EPIC/Voter ID (when available), normalized';
COMMENT ON COLUMN public.submissions.aadhaar_number IS '12-digit Aadhaar (when available)';
COMMENT ON COLUMN public.submissions.dob IS 'Date of birth (raw string or YYYY-MM-DD)';
COMMENT ON COLUMN public.submissions.gender IS 'Gender/sex (raw string)';

CREATE INDEX IF NOT EXISTS idx_submissions_source_name ON public.submissions (source_name);
CREATE INDEX IF NOT EXISTS idx_submissions_epic ON public.submissions (epic) WHERE deleted_at IS NULL;
