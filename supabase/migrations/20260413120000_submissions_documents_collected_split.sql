-- Separate physical-collection confirmation for Aadhaar vs Voter ID (Sakhi form).
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS documents_collected_aadhaar text;

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS documents_collected_voter text;

COMMENT ON COLUMN public.submissions.documents_collected_aadhaar IS 'yes/no: Aadhaar card physically collected';
COMMENT ON COLUMN public.submissions.documents_collected_voter IS 'yes/no: Voter ID card physically collected';
