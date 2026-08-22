CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TYPE public.follow_status AS ENUM ('pending','accepted','rejected');

CREATE TABLE public.follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.follow_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.follows TO authenticated;
GRANT ALL ON public.follows TO service_role;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.locations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy double precision,
  speed double precision,
  heading double precision,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX locations_user_time_idx ON public.locations (user_id, recorded_at DESC);
GRANT SELECT, INSERT, DELETE ON public.locations TO authenticated;
GRANT ALL ON public.locations TO service_role;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_view_location(_viewer uuid, _target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _viewer = _target OR EXISTS (
    SELECT 1 FROM public.follows f
    WHERE f.follower_id = _viewer
      AND f.followed_id = _target
      AND f.status = 'accepted'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_related_user(_me uuid, _other uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _me = _other OR EXISTS (
    SELECT 1 FROM public.follows f
    WHERE (f.follower_id = _me AND f.followed_id = _other)
       OR (f.follower_id = _other AND f.followed_id = _me)
  );
$$;

CREATE OR REPLACE FUNCTION public.find_profile_by_email(_email text)
RETURNS TABLE (id uuid, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE lower(p.email) = lower(trim(_email))
  LIMIT 1;
$$;

CREATE POLICY "profiles_select_related" ON public.profiles FOR SELECT TO authenticated
  USING (public.is_related_user(auth.uid(), id));
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "follows_select_involved" ON public.follows FOR SELECT TO authenticated
  USING (auth.uid() = follower_id OR auth.uid() = followed_id);
CREATE POLICY "follows_insert_own" ON public.follows FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = follower_id);
CREATE POLICY "follows_update_target" ON public.follows FOR UPDATE TO authenticated
  USING (auth.uid() = followed_id) WITH CHECK (auth.uid() = followed_id);
CREATE POLICY "follows_delete_involved" ON public.follows FOR DELETE TO authenticated
  USING (auth.uid() = follower_id OR auth.uid() = followed_id);

CREATE POLICY "locations_select_allowed" ON public.locations FOR SELECT TO authenticated
  USING (public.can_view_location(auth.uid(), user_id));
CREATE POLICY "locations_insert_own" ON public.locations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "locations_delete_own" ON public.locations FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

ALTER TABLE public.locations REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.locations;
ALTER TABLE public.follows REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.follows;