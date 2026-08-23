REVOKE ALL ON FUNCTION public.can_view_location(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_related_user(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_profile_by_email(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_location(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_related_user(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.find_profile_by_email(text) TO authenticated, service_role;