-- Sakhi confirms physical Aadhaar + Voter ID were collected before submission ('yes' | 'no').
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS documents_collected_consent text;

COMMENT ON COLUMN public.submissions.documents_collected_consent IS
  'Consent: applicant''s Aadhaar and Voter ID cards physically collected — yes or no';
