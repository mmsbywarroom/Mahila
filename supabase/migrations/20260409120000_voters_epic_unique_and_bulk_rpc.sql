-- Ensures UNIQUE(vcardid) for upsert ON CONFLICT + fast EPIC lookups.
-- Safe if 20260408150000 already ran (replaces index idempotently).

-- RDS / vanilla Postgres: Supabase role service_role does not exist by default
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

UPDATE public.voters SET vcardid = NULL WHERE vcardid IS NOT NULL AND BTRIM(vcardid) = '';
UPDATE public.voters SET vcardid = UPPER(BTRIM(vcardid)) WHERE vcardid IS NOT NULL;

DELETE FROM public.voters a
WHERE a.vcardid IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.voters b
    WHERE b.vcardid = a.vcardid AND b.id < a.id
  );

DROP INDEX IF EXISTS idx_voters_vcardid;

CREATE UNIQUE INDEX idx_voters_vcardid ON public.voters (vcardid);

-- Single DB round-trip per chunk; raises statement_timeout for large tables.
CREATE OR REPLACE FUNCTION public.admin_voters_upsert_chunk(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  SET LOCAL statement_timeout = '600s';

  INSERT INTO public.voters (
    e_first_name,
    e_middle_name,
    sex,
    age,
    vcardid,
    house_no,
    part_no,
    srno,
    boothid,
    familyid,
    full_name,
    e_assemblyname
  )
  SELECT
    nullif(btrim(elem->>'e_first_name'), ''),
    nullif(btrim(elem->>'e_middle_name'), ''),
    nullif(btrim(elem->>'sex'), ''),
    CASE
      WHEN nullif(btrim(elem->>'age'), '') IS NULL THEN NULL
      WHEN btrim(elem->>'age') ~ '^-?[0-9]+' THEN trunc(btrim(elem->>'age')::numeric)::int
      ELSE NULL
    END,
    UPPER(btrim(elem->>'vcardid')),
    nullif(btrim(elem->>'house_no'), ''),
    nullif(btrim(elem->>'part_no'), ''),
    nullif(btrim(elem->>'srno'), ''),
    nullif(btrim(elem->>'boothid'), ''),
    nullif(btrim(elem->>'familyid'), ''),
    nullif(btrim(elem->>'full_name'), ''),
    nullif(btrim(elem->>'e_assemblyname'), '')
  FROM jsonb_array_elements(p_rows) AS elem
  WHERE btrim(elem->>'vcardid') <> ''
  ON CONFLICT (vcardid) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_voters_upsert_chunk(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_voters_upsert_chunk(jsonb) TO service_role;

ANALYZE public.voters;
