-- Booth-level aggregates in an MV so summary APIs never scan the raw voters table.

DROP MATERIALIZED VIEW IF EXISTS public.mv_voter_booth_summary;

CREATE MATERIALIZED VIEW public.mv_voter_booth_summary AS
SELECT
  trim(e_assemblyname) AS assembly,
  trim(boothid) AS booth,
  COUNT(*)::bigint AS vote_count
FROM public.voters
WHERE e_assemblyname IS NOT NULL AND btrim(e_assemblyname) <> ''
  AND boothid IS NOT NULL AND btrim(boothid::text) <> ''
GROUP BY trim(e_assemblyname), trim(boothid);

CREATE UNIQUE INDEX mv_voter_booth_summary_asm_booth_key ON public.mv_voter_booth_summary (assembly, booth);

CREATE OR REPLACE FUNCTION public.admin_refresh_voter_assembly_summary()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_voter_booth_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_voter_assembly_summary;
END;
$$;

-- Paginated booth list: reads only mv_voter_booth_summary (indexed by assembly).
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
  asm AS (SELECT trim(p_assembly) AS a),
  tot AS (
    SELECT count(*)::int AS c
    FROM public.mv_voter_booth_summary v
    CROSS JOIN asm
    WHERE v.assembly = asm.a
  ),
  page AS (
    SELECT v.booth, v.vote_count
    FROM public.mv_voter_booth_summary v
    CROSS JOIN asm
    WHERE v.assembly = asm.a
    ORDER BY v.booth
    LIMIT (SELECT l FROM lim) OFFSET (SELECT o FROM lim)
  )
  SELECT jsonb_build_object(
    'rows', coalesce(
      (SELECT jsonb_agg(jsonb_build_object('booth', booth, 'votes', vote_count) ORDER BY booth) FROM page),
      '[]'::jsonb
    ),
    'hasMore',
      (SELECT o FROM lim) + coalesce((SELECT count(*)::int FROM page), 0) < (SELECT c FROM tot),
    'limit', (SELECT l FROM lim),
    'offset', (SELECT o FROM lim),
    'totalBooths', (SELECT c FROM tot)
  );
$$;

-- Upload stats page: O(assemblies) + O(booth rows in MV), not O(voters).
CREATE OR REPLACE FUNCTION public.admin_voter_upload_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT coalesce(sum(vote_count), 0)::bigint FROM public.mv_voter_assembly_summary),
    'assemblyWise', coalesce(
      (
        SELECT jsonb_agg(jsonb_build_object('assembly', assembly, 'count', vote_count) ORDER BY assembly)
        FROM public.mv_voter_assembly_summary
      ),
      '[]'::jsonb
    ),
    'boothDistinct', (SELECT count(*)::bigint FROM public.mv_voter_booth_summary)
  );
$$;
