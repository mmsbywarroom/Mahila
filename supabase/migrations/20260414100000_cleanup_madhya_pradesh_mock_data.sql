-- Punjab-only cleanup: remove legacy/mock Madhya Pradesh data.

-- 1) Remove MP-tagged location masters.
DELETE FROM public.locations
WHERE lower(trim(coalesce(state, ''))) = 'madhya pradesh';

-- 2) Remove submissions explicitly tagged as MP state.
DELETE FROM public.submissions
WHERE lower(trim(coalesce(state, ''))) = 'madhya pradesh';

-- 3) Remove MP zone marker from user profile_data (keep user accounts).
UPDATE public.users
SET profile_data = profile_data - 'Zone'
WHERE lower(trim(coalesce(profile_data->>'Zone', ''))) = 'madhya pradesh';
