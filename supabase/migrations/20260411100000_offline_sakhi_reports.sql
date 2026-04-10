-- Persisted Offline Sakhi validation reports (admin uploads) for any admin session / device.
CREATE TABLE IF NOT EXISTS public.offline_sakhi_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  file_name text NOT NULL DEFAULT '',
  summary jsonb NOT NULL,
  csv_headers jsonb NOT NULL,
  results jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_offline_sakhi_reports_created_at ON public.offline_sakhi_reports (created_at DESC);

COMMENT ON TABLE public.offline_sakhi_reports IS 'Offline Sakhi Add CSV validation snapshots; API-only (admin credentials).';
