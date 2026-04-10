-- Normalize to last 10 digits so +91 / spaces still match.

-- RDS / vanilla Postgres: Supabase role service_role does not exist by default
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

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
    WHERE length(regexp_replace(coalesce(s.sakhi_mobile, ''), '\D', '', 'g')) >= 10
      AND right(regexp_replace(coalesce(s.sakhi_mobile, ''), '\D', '', 'g'), 10) = trim(p_ten_digits)
  );
$$;

REVOKE ALL ON FUNCTION public.submission_mobile_taken(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submission_mobile_taken(text) TO service_role;
