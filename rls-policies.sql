-- Supabase RLS Policies for PHERAN
-- Run this in: Supabase Dashboard → SQL Editor → New query → Run
-- These add WITH CHECK clauses so even the service key can't insert rows that violate policy.

-- ── Enable RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.orders   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Drop old policies first so this script is idempotent
DROP POLICY IF EXISTS "users_read_own_orders"   ON public.orders;
DROP POLICY IF EXISTS "users_insert_own_orders" ON public.orders;
DROP POLICY IF EXISTS "service_role_all_orders" ON public.orders;
DROP POLICY IF EXISTS "public_read_products"    ON public.products;
DROP POLICY IF EXISTS "service_role_all_products" ON public.products;

-- ── Orders ────────────────────────────────────────────────────────────────────

-- Authenticated users may only read their own orders
CREATE POLICY "users_read_own_orders"
  ON public.orders
  FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated users may only insert orders where user_id matches their own identity
-- WITH CHECK prevents row-level forgery even if the service key tries to insert a wrong user_id
CREATE POLICY "users_insert_own_orders"
  ON public.orders
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR user_id IS NULL  -- guest checkout: no authenticated user
  );

-- Service role (server-side only) has full access for admin operations
-- auth.jwt() ->> 'role' = 'service_role' is set by Supabase when the service key is used
CREATE POLICY "service_role_all_orders"
  ON public.orders
  FOR ALL
  USING     (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK(auth.jwt() ->> 'role' = 'service_role');

-- ── Products ──────────────────────────────────────────────────────────────────

-- Anyone can read products (public catalogue)
CREATE POLICY "public_read_products"
  ON public.products
  FOR SELECT
  USING (true);

-- Only the service role (admin panel) can insert/update/delete products
CREATE POLICY "service_role_all_products"
  ON public.products
  FOR ALL
  USING     (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK(auth.jwt() ->> 'role' = 'service_role');
