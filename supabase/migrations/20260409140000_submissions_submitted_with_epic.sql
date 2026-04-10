-- How the sakhi entry was captured: EPIC/roll lookup vs without-EPIC (voter ID upload path).
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS submitted_with_epic boolean;

COMMENT ON COLUMN public.submissions.submitted_with_epic IS
  'true = submitted via EPIC/electoral roll lookup; false = without EPIC search (voter ID upload). NULL = legacy row.';
