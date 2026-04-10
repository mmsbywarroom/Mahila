-- Performance indexes for heavy admin/user queries.
-- Safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- submissions: common filters are deleted_at, user_id, assembly, created_at, mobile
CREATE INDEX IF NOT EXISTS idx_submissions_active_user_created
  ON public.submissions (user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_active_created
  ON public.submissions (created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_submissions_active_mobile
  ON public.submissions (sakhi_mobile)
  WHERE deleted_at IS NULL;

-- Expression index to match trim(assembly) predicates/groups in API SQL
CREATE INDEX IF NOT EXISTS idx_submissions_active_trim_assembly
  ON public.submissions ((trim(assembly)))
  WHERE deleted_at IS NULL
    AND assembly IS NOT NULL
    AND btrim(assembly) <> '';

-- Trigram for ILIKE/contains search on assembly in dashboards/filters
CREATE INDEX IF NOT EXISTS idx_submissions_active_assembly_trgm
  ON public.submissions USING gin (assembly gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- voters: assembly/booth aggregations and lookups
CREATE INDEX IF NOT EXISTS idx_voters_trim_assembly
  ON public.voters ((trim(e_assemblyname)))
  WHERE e_assemblyname IS NOT NULL
    AND btrim(e_assemblyname) <> '';

CREATE INDEX IF NOT EXISTS idx_voters_trim_assembly_booth
  ON public.voters ((trim(e_assemblyname)), (trim(boothid)))
  WHERE e_assemblyname IS NOT NULL
    AND btrim(e_assemblyname) <> ''
    AND boothid IS NOT NULL
    AND btrim(boothid) <> '';

CREATE INDEX IF NOT EXISTS idx_voters_assembly_trgm
  ON public.voters USING gin (e_assemblyname gin_trgm_ops)
  WHERE e_assemblyname IS NOT NULL
    AND btrim(e_assemblyname) <> '';

-- users/incharge list search
CREATE INDEX IF NOT EXISTS idx_users_name_trgm
  ON public.users USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_users_mobile
  ON public.users (mobile);

