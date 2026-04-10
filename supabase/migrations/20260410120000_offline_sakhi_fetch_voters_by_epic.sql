-- Batch lookup voters by normalized EPIC (vcardid) for offline Sakhi CSV validation.
CREATE OR REPLACE FUNCTION public.admin_offline_sakhi_fetch_voters(p_epics text[])
RETURNS TABLE (
  vcardid text,
  e_first_name text,
  e_middle_name text,
  sex text,
  age integer,
  boothid text,
  full_name text,
  e_assemblyname text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.vcardid::text,
    v.e_first_name::text,
    v.e_middle_name::text,
    v.sex::text,
    v.age,
    v.boothid::text,
    v.full_name::text,
    v.e_assemblyname::text
  FROM voters v
  WHERE upper(regexp_replace(btrim(coalesce(v.vcardid, '')), '\s+', '', 'g')) = ANY(
    SELECT upper(regexp_replace(btrim(coalesce(x, '')), '\s+', '', 'g')) FROM unnest(p_epics) AS x
  );
$$;

-- Edge / server use service role only; do not expose to anon.
GRANT EXECUTE ON FUNCTION public.admin_offline_sakhi_fetch_voters(text[]) TO service_role;
