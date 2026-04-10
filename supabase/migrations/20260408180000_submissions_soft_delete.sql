ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_active ON public.submissions (deleted_at)
  WHERE deleted_at IS NULL;

-- Duplicate mobile check ignores soft-deleted rows.
CREATE OR REPLACE FUNCTION public.submission_mobile_taken(p_ten_digits text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.submissions s
    WHERE s.deleted_at IS NULL
      AND length(regexp_replace(coalesce(s.sakhi_mobile, ''), '\D', '', 'g')) >= 10
      AND right(regexp_replace(coalesce(s.sakhi_mobile, ''), '\D', '', 'g'), 10) = trim(p_ten_digits)
  );
$$;
