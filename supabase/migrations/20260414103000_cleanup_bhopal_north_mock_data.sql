-- Remove legacy/mock Bhopal North data so All Submissions and Assembly Report stay aligned.

DELETE FROM public.submissions
WHERE lower(trim(coalesce(assembly, ''))) = 'bhopal north';

DELETE FROM public.locations
WHERE lower(trim(coalesce(assembly, ''))) = 'bhopal north'
   OR lower(trim(coalesce(halka, ''))) = 'bhopal north';

DELETE FROM public.voters
WHERE lower(trim(coalesce(e_assemblyname, ''))) = 'bhopal north';
