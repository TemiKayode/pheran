-- ============================================================
-- PHERAN — Supabase Security & Performance Fixes
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Enable Row Level Security on both tables
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders   ENABLE ROW LEVEL SECURITY;

-- 2. Drop ALL existing policies to eliminate "Multiple Permissive Policies" warnings
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'products'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.products', r.policyname); END LOOP;

  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'orders'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.orders', r.policyname); END LOOP;
END $$;

-- 3. Products policies
--    Storefront: anon + authenticated can read; only service_role (Express server) can write
CREATE POLICY "products_anon_read"
  ON public.products FOR SELECT TO anon
  USING (true);

CREATE POLICY "products_auth_read"
  ON public.products FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "products_service_all"
  ON public.products FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Orders policies
--    (SELECT auth.uid()) evaluated ONCE per query — fixes "Auth RLS Initialization Plan" warning
--    Anon users cannot touch orders at all
CREATE POLICY "orders_anon_deny"
  ON public.orders FOR ALL TO anon
  USING (false);

-- Authenticated users see only their own orders (column: user_id)
-- If your orders table uses a different column name, update 'user_id' below
CREATE POLICY "orders_auth_select"
  ON public.orders FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "orders_auth_insert"
  ON public.orders FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- Server (service_role) can manage all orders
CREATE POLICY "orders_service_all"
  ON public.orders FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. Performance indexes
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products (category);
CREATE INDEX IF NOT EXISTS idx_products_id       ON public.products (id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id    ON public.orders   (user_id);

-- 6. Hide internal tables from PostgREST/GraphQL schema to suppress
--    "Signed-In Users Can See Object in GraphQL" for tables that should
--    not be queryable via REST. Only needed for tables you want fully
--    hidden — skip this block if you want PostgREST access to products.
--
-- OPTIONAL: To restrict PostgREST exposure on orders (server manages all order
-- ops via service_role; clients never query orders via REST directly):
-- REVOKE SELECT ON public.orders FROM authenticated, anon;
-- ============================================================
