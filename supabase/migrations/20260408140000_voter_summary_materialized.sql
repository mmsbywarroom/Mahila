-- Lightweight reads at scale: assembly-level aggregates in MV; booth queries are per-assembly + paginated.

-- RDS / vanilla Postgres: Supabase role service_role does not exist by default
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_voters_assembly_booth ON public.voters (e_assemblyname, boothid);

DROP MATERIALIZED VIEW IF EXISTS public.mv_voter_assembly_summary;

CREATE MATERIALIZED VIEW public.mv_voter_assembly_summary AS
SELECT
  trim(e_assemblyname) AS assembly,
  COUNT(*)::bigint AS vote_count,
  COUNT(DISTINCT NULLIF(trim(boothid), ''))::bigint AS booth_count
FROM public.voters
WHERE e_assemblyname IS NOT NULL AND btrim(e_assemblyname) <> ''
GROUP BY trim(e_assemblyname);

CREATE UNIQUE INDEX mv_voter_assembly_summary_assembly_key ON public.mv_voter_assembly_summary (assembly);

CREATE OR REPLACE FUNCTION public.admin_refresh_voter_assembly_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_voter_assembly_summary;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_refresh_voter_assembly_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_refresh_voter_assembly_summary() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_voter_assembly_list(p_filter text, p_limit int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object('assembly', assembly, 'vote_count', vote_count, 'booth_count', booth_count)
        ORDER BY assembly
      )
      FROM (
        SELECT assembly, vote_count, booth_count
        FROM public.mv_voter_assembly_summary
        WHERE p_filter IS NULL
          OR trim(p_filter) = ''
          OR assembly ILIKE '%' || trim(p_filter) || '%'
        ORDER BY assembly
        LIMIT least(greatest(coalesce(nullif(p_limit, 0), 200), 1), 500)
      ) s
    ),
    '[]'::jsonb
  );
$$;

REVOKE ALL ON FUNCTION public.admin_voter_assembly_list(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_voter_assembly_list(text, int) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_voter_booths_page(p_assembly text, p_limit int, p_offset int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lim AS (
    SELECT least(greatest(coalesce(nullif(p_limit, 0), 100), 1), 500) AS l,
           greatest(coalesce(p_offset, 0), 0) AS o
  ),
  grp AS (
    SELECT trim(boothid) AS booth, COUNT(*)::bigint AS votes
    FROM public.voters
    WHERE trim(e_assemblyname) = trim(p_assembly)
      AND boothid IS NOT NULL
      AND btrim(boothid::text) <> ''
    GROUP BY trim(boothid)
  ),
  tot AS (SELECT count(*)::int AS c FROM grp),
  page AS (
    SELECT booth, votes FROM grp ORDER BY booth LIMIT (SELECT l FROM lim) OFFSET (SELECT o FROM lim)
  )
  SELECT jsonb_build_object(
    'rows', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('booth', booth, 'votes', votes) ORDER BY booth) FROM page),
      '[]'::jsonb
    ),
    'hasMore',
      (SELECT o FROM lim) + coalesce((SELECT count(*)::int FROM page), 0) < (SELECT c FROM tot),
    'limit', (SELECT l FROM lim),
    'offset', (SELECT o FROM lim),
    'totalBooths', (SELECT c FROM tot)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_voter_booths_page(text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_voter_booths_page(text, int, int) TO service_role;
