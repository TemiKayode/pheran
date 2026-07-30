-- ─────────────────────────────────────────────────────────────
-- PHERAN — Supabase database setup
-- Run this once in: Supabase Dashboard → SQL Editor → New query
-- ─────────────────────────────────────────────────────────────

-- 1. Products table
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

-- 2. Row-level security: public read, service_role write
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read products" ON products;
CREATE POLICY "Public can read products"
  ON products FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service role full access" ON products;
CREATE POLICY "Service role full access"
  ON products FOR ALL USING (auth.role() = 'service_role');

-- 3. Orders table
CREATE TABLE IF NOT EXISTS orders (
  id            text PRIMARY KEY,
  user_id       uuid REFERENCES auth.users ON DELETE SET NULL,
  user_email    text,
  items         jsonb    DEFAULT '[]',
  shipping      jsonb    DEFAULT '{}',
  subtotal      numeric  DEFAULT 0,
  delivery_fee  numeric  DEFAULT 0,
  total         numeric  DEFAULT 0,
  status        text     DEFAULT 'confirmed',
  delivery_method text   DEFAULT 'standard',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users see own orders" ON orders;
CREATE POLICY "Users see own orders"
  ON orders FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access orders" ON orders;
CREATE POLICY "Service role full access orders"
  ON orders FOR ALL USING (auth.role() = 'service_role');

-- 4. Seed initial products
INSERT INTO products (id, title, category, price, old_price, rating, count, fabric, availability, description, images, sizes, colors, video)
VALUES
  (
    'silk-wrap-001', 'Linen Bow-Strap Co-ord Set', 'Dresses',
    78000, 95000, 4.6, 128, 'Premium Linen', 'In Stock',
    'Effortless linen co-ord set featuring a bow-strap button-down top paired with wide-leg trousers.',
    '["img-grey-linen-front.jpg","img-grey-linen-side.jpg"]',
    '["XS","S","M","L","XL"]', '["Grey Blue","Slate"]',
    '../videos/04351cfe-f9c7-4fd2-aaad-e9dbd19cc3a8.mp4'
  ),
  (
    'cotton-blouse-002', 'Pearl-Strap Ribbed Cami', 'Tops',
    42000, NULL, 4.4, 74, 'Ribbed Cotton', 'In Stock',
    'A luxurious ribbed cotton cami elevated with hand-threaded pearl and gold bead straps.',
    '["img-pink-cami.jpg"]',
    '["XS","S","M","L"]', '["Dusty Rose","Ivory","Sage"]',
    '../videos/0f8bca99-0b59-4816-8cd2-678f26093d1d.mp4'
  ),
  (
    'tailored-trousers-003', 'Pinstripe Wide-Leg Set', 'Bottoms',
    95000, 115000, 4.5, 92, 'Linen Blend', 'In Stock',
    'The power set. A relaxed pinstripe shirt-jacket paired with matching high-waist wide-leg trousers.',
    '["img-wine-pinstripe.jpg","img-grey-linen-front.jpg"]',
    '["S","M","L","XL"]', '["Burgundy","Wine","Dusty Rose"]',
    '../videos/103456c2-e4d0-4963-a132-c2fe6e2d7b81.mp4'
  ),
  (
    'linen-dress-004', 'Linen Co-ord — Slate', 'Dresses',
    72000, NULL, 4.4, 56, 'Washed Linen', 'In Stock',
    'The same signature silhouette in a classic slate wash.',
    '["img-grey-linen-side.jpg","img-grey-linen-front.jpg"]',
    '["XS","S","M","L"]', '["Slate Blue","Mist","Ash"]',
    '../videos/15627b52-c2c7-4166-b2fd-06e0312fa43d.mp4'
  ),
  (
    'evening-gown-005', 'Red Beaded Off-Shoulder Gown', 'Dresses',
    189000, 220000, 4.9, 12, 'Charmeuse Silk', 'Made to Order',
    'The showpiece. An off-shoulder beaded bodice flows into a ruched mermaid skirt with a dramatic cathedral train.',
    '["img-red-gown-front.jpg","img-red-gown-side.jpg"]',
    '["S","M","L"]', '["Scarlet Red"]',
    '../videos/157429e1-509d-4512-b99a-e32e2ca5bcf5.mp4'
  ),
  (
    'summer-short-006', 'Strap Top', 'Tops',
    20000, 38000, 4.3, 34, 'Ribbed Cotton', 'In Stock',
    'A refined take on the classic cami. Adjustable bow straps, ribbed texture, and a cropped fit.',
    '["img-pink-cami.jpg","img-grey-linen-front.jpg"]',
    '["XS","S","M","L"]', '["Dusty Rose","White","Ivory"]',
    '../videos/1a4c9961-93c9-4fc2-ba6d-40ae9a30e7d2.mp4'
  )
ON CONFLICT (id) DO NOTHING;
