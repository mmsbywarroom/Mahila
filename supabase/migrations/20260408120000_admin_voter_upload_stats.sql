-- Stats for admin voter list upload UI (total rows, per-assembly counts, distinct booths per AC)
-- RDS / vanilla Postgres: Supabase role service_role does not exist by default
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.admin_voter_upload_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*)::bigint FROM voters),
    'assemblyWise', COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('assembly', a_name, 'count', cnt))
        FROM (
          SELECT trim(e_assemblyname) AS a_name, COUNT(*)::bigint AS cnt
          FROM voters
          WHERE e_assemblyname IS NOT NULL AND btrim(e_assemblyname) <> ''
          GROUP BY trim(e_assemblyname)
          ORDER BY trim(e_assemblyname)
        ) s
      ),
      '[]'::jsonb
    ),
    'boothDistinct', (
      SELECT COUNT(*)::bigint
      FROM (
        SELECT DISTINCT trim(e_assemblyname) AS asm, trim(boothid) AS booth
        FROM voters
        WHERE boothid IS NOT NULL AND btrim(boothid::text) <> ''
          AND e_assemblyname IS NOT NULL AND btrim(e_assemblyname) <> ''
      ) d
    )
  );
$$;

REVOKE ALL ON FUNCTION public.admin_voter_upload_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_voter_upload_stats() TO service_role;
