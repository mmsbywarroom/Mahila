-- Per-row storage for Offline Sakhi reports (chunked API saves; avoids huge JSON + HTTP 413 on proxies).
CREATE TABLE IF NOT EXISTS public.offline_sakhi_report_rows (
  id bigserial PRIMARY KEY,
  report_id uuid NOT NULL REFERENCES public.offline_sakhi_reports (id) ON DELETE CASCADE,
  row_index int NOT NULL,
  status text NOT NULL,
  epic text NOT NULL DEFAULT '',
  mismatched_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  csv jsonb NOT NULL,
  roll jsonb,
  extra_cells jsonb,
  CONSTRAINT offline_sakhi_report_rows_report_row UNIQUE (report_id, row_index)
);

CREATE INDEX IF NOT EXISTS idx_offline_sakhi_report_rows_report ON public.offline_sakhi_report_rows (report_id);

COMMENT ON TABLE public.offline_sakhi_report_rows IS 'Offline Sakhi validation rows; parent offline_sakhi_reports holds summary + headers; results jsonb may be [] when rows live here.';
