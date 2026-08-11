-- ─────────────────────────────────────────────────────────────
-- PHERAN — staging database setup
-- Run once in the NEW staging Supabase project: Dashboard → SQL Editor → New query → Run
-- Consolidates mvp/mock-server/supabase-setup.sql + rls-policies.sql (which had
-- diverged — this uses the hardened WITH CHECK version) plus custom_config,
-- which was never in either file despite being a live table in production.
-- ─────────────────────────────────────────────────────────────

-- 1. Products
CREATE TABLE IF NOT EXISTS products (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  category      text,
  price         numeric,
  old_price     numeric,
  rating        numeric  DEFAULT 4.5,
  count         integer  DEFAULT 0,
  fabric        text,
  availability  text     DEFAULT 'In Stock',
  description   text,
  images        jsonb    DEFAULT '[]',
  sizes         jsonb    DEFAULT '[]',
  colors        jsonb    DEFAULT '[]',
  video         text,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public_read_products"      ON products;
DROP POLICY IF EXISTS "service_role_all_products"  ON products;
CREATE POLICY "public_read_products" ON products FOR SELECT USING (true);
CREATE POLICY "service_role_all_products" ON products FOR ALL
  USING     (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK(auth.jwt() ->> 'role' = 'service_role');

-- 2. Orders
CREATE TABLE IF NOT EXISTS orders (
  id              text PRIMARY KEY,
  user_id         uuid REFERENCES auth.users ON DELETE SET NULL,
  user_email      text,
  items           jsonb    DEFAULT '[]',
  shipping        jsonb    DEFAULT '{}',
  subtotal        numeric  DEFAULT 0,
  delivery_fee    numeric  DEFAULT 0,
  total           numeric  DEFAULT 0,
  status          text     DEFAULT 'pending_payment',
  delivery_method text     DEFAULT 'standard',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_read_own_orders"    ON orders;
DROP POLICY IF EXISTS "users_insert_own_orders"  ON orders;
DROP POLICY IF EXISTS "service_role_all_orders"  ON orders;
CREATE POLICY "users_read_own_orders" ON orders FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_orders" ON orders FOR INSERT
  WITH CHECK (auth.uid() = user_id OR user_id IS NULL); -- guest checkout
CREATE POLICY "service_role_all_orders" ON orders FOR ALL
  USING     (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK(auth.jwt() ->> 'role' = 'service_role');

-- 3. Custom-order config (garments/fabrics/pricing for the bespoke builder) —
-- single row, id=1. Only ever read/written through the server's service_role
-- client (see getCustomConfig() in server.js), so RLS here is defense-in-depth
-- rather than load-bearing, but it was missing from both prior SQL files.
CREATE TABLE IF NOT EXISTS custom_config (
  id          integer PRIMARY KEY DEFAULT 1,
  garments    jsonb    DEFAULT '[]',
  fabrics     jsonb    DEFAULT '[]',
  delivery    jsonb    DEFAULT '{}',
  updated_at  timestamptz DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);
ALTER TABLE custom_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_custom_config" ON custom_config;
CREATE POLICY "service_role_all_custom_config" ON custom_config FOR ALL
  USING     (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK(auth.jwt() ->> 'role' = 'service_role');

-- 4. Seed products — same catalog shape as supabase-setup.sql, image paths
-- point at local /img-*.jpg files served by the app itself, not Storage, so
-- staging renders correctly without needing product images re-uploaded.
INSERT INTO products (id, title, category, price, old_price, rating, count, fabric, availability, description, images, sizes, colors)
VALUES
  ('silk-wrap-001', 'Linen Bow-Strap Co-ord Set', 'Dresses', 78000, 95000, 4.6, 128, 'Premium Linen', 'In Stock',
    'Effortless linen co-ord set featuring a bow-strap button-down top paired with wide-leg trousers.',
    '["/img-grey-linen-front.jpg","/img-grey-linen-side.jpg"]', '["XS","S","M","L","XL"]', '["Grey Blue","Slate"]'),
  ('tailored-trousers-003', 'Pinstripe Wide-Leg Set', 'Bottoms', 95000, 115000, 4.5, 92, 'Linen Blend', 'In Stock',
    'The power set. A relaxed pinstripe shirt-jacket paired with matching high-waist wide-leg trousers.',
    '["/img-wine-pinstripe.jpg"]', '["S","M","L","XL"]', '["Burgundy","Wine","Dusty Rose"]'),
  ('linen-dress-004', 'Linen Co-ord — Slate', 'Dresses', 72000, NULL, 4.4, 56, 'Washed Linen', 'In Stock',
    'The same signature silhouette in a classic slate wash.',
    '["/img-grey-linen-side.jpg"]', '["XS","S","M","L"]', '["Slate Blue","Mist","Ash"]'),
  ('evening-gown-005', 'Red Beaded Off-Shoulder Gown', 'Dresses', 189000, 220000, 4.9, 12, 'Charmeuse Silk', 'Made to Order',
    'The showpiece. An off-shoulder beaded bodice flows into a ruched mermaid skirt with a dramatic cathedral train.',
    '["/img-red-gown-front.jpg","/img-red-gown-side.jpg"]', '["S","M","L"]', '["Scarlet Red"]')
ON CONFLICT (id) DO NOTHING;

-- 5. Default custom-order config so the bespoke builder isn't empty
INSERT INTO custom_config (id, garments, fabrics, delivery)
VALUES (1,
  '[{"key":"dress","label":"Dress","basePrice":60000},{"key":"two-piece","label":"Two-Piece Set","basePrice":75000}]',
  '[{"key":"linen","label":"Linen","priceAdd":0},{"key":"silk","label":"Silk","priceAdd":25000}]',
  '{"rushPercent":40}'
)
ON CONFLICT (id) DO NOTHING;
