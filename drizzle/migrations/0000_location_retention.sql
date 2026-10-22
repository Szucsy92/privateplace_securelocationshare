CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.purge_old_locations()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE removed bigint;
BEGIN
  DELETE FROM public.locations WHERE recorded_at < now() - interval '7 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_old_locations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_old_locations() TO service_role;

CREATE OR REPLACE FUNCTION public.delete_my_location_data()
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE removed bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  DELETE FROM public.locations WHERE user_id = auth.uid();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_my_location_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_location_data() TO authenticated;

CREATE INDEX IF NOT EXISTS locations_retention_idx ON public.locations(recorded_at);
DO $$
BEGIN
  PERFORM cron.schedule('purge-old-locations', '0 * * * *', 'SELECT public.purge_old_locations();');
END;
$$;