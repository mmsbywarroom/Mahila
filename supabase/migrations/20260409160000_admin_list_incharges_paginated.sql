-- Paginated incharge list + filtered stats (avoids loading entire users table into the API/browser)

CREATE OR REPLACE FUNCTION public.admin_list_incharges_page(
  p_search text DEFAULT NULL,
  p_designation text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  name text,
  mobile text,
  preferred_assembly text,
  profile_data jsonb,
  is_verified boolean,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH lim AS (
    SELECT
      LEAST(50000, GREATEST(1, COALESCE(NULLIF(p_limit, 0), 50)))::int AS l,
      GREATEST(0, COALESCE(p_offset, 0))::int AS o
  ),
  filtered AS (
    SELECT
      u.id,
      u.name,
      u.mobile,
      u.preferred_assembly,
      u.profile_data,
      u.is_verified,
      u.created_at
    FROM users u
    WHERE
      (
        p_search IS NULL OR btrim(p_search) = '' OR
        u.name ILIKE '%' || btrim(p_search) || '%' OR
        u.mobile ILIKE '%' || btrim(p_search) || '%' OR
        (u.profile_data IS NOT NULL AND u.profile_data::text ILIKE '%' || btrim(p_search) || '%')
      )
      AND (
        p_designation IS NULL OR btrim(p_designation) = '' OR lower(btrim(p_designation)) = 'all designations' OR
        COALESCE(
          NULLIF(trim(both FROM u.profile_data->>'Designation'), ''),
          NULLIF(trim(both FROM u.profile_data->>'designation'), '')
        ) = btrim(p_designation)
      )
  ),
  counted AS (
    SELECT
      f.id,
      f.name,
      f.mobile,
      f.preferred_assembly,
      f.profile_data,
      f.is_verified,
      f.created_at,
      count(*) OVER () AS total_count
    FROM filtered f
  )
  SELECT c.id, c.name, c.mobile, c.preferred_assembly, c.profile_data, c.is_verified, c.created_at, c.total_count
  FROM counted c
  CROSS JOIN lim
  ORDER BY c.name ASC
  LIMIT (SELECT l FROM lim) OFFSET (SELECT o FROM lim);
$$;

CREATE OR REPLACE FUNCTION public.admin_incharge_filtered_stats(
  p_search text DEFAULT NULL,
  p_designation text DEFAULT NULL
)
RETURNS TABLE (
  total bigint,
  by_designation jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT u.profile_data
    FROM users u
    WHERE
      (
        p_search IS NULL OR btrim(p_search) = '' OR
        u.name ILIKE '%' || btrim(p_search) || '%' OR
        u.mobile ILIKE '%' || btrim(p_search) || '%' OR
        (u.profile_data IS NOT NULL AND u.profile_data::text ILIKE '%' || btrim(p_search) || '%')
      )
      AND (
        p_designation IS NULL OR btrim(p_designation) = '' OR lower(btrim(p_designation)) = 'all designations' OR
        COALESCE(
          NULLIF(trim(both FROM u.profile_data->>'Designation'), ''),
          NULLIF(trim(both FROM u.profile_data->>'designation'), '')
        ) = btrim(p_designation)
      )
  ),
  labeled AS (
    SELECT
      COALESCE(
        NULLIF(trim(both FROM f.profile_data->>'Designation'), ''),
        NULLIF(trim(both FROM f.profile_data->>'designation'), ''),
        'Other'
      ) AS d
    FROM filtered f
  ),
  agg AS (
    SELECT d, count(*)::bigint AS cnt FROM labeled GROUP BY d
  )
  SELECT
    COALESCE((SELECT sum(cnt) FROM agg), 0)::bigint AS total,
    COALESCE((SELECT jsonb_object_agg(d, cnt) FROM agg), '{}'::jsonb) AS by_designation;
$$;

REVOKE ALL ON FUNCTION public.admin_list_incharges_page(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_incharge_filtered_stats(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_incharges_page(text, text, int, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_incharge_filtered_stats(text, text) TO service_role;
