# PHERAN — Premium Nigerian Fashion Storefront

A full-storefront e-commerce prototype for **PHERAN**, a luxury Nigerian fashion label based in Ibadan. Handcrafted gowns, co-ord sets, and bespoke pieces for the modern African woman.

---

## What's inside

| Area | Detail |
|------|--------|
| **14 HTML pages** | Homepage, shop, product detail, cart, checkout, order confirmation, account, gallery, custom orders, about, admin, support, policies |
| **Hero Carousel** | 3-video crossfade carousel with 10 s auto-advance, animated progress dots, and per-slide text animation |
| **Product catalogue** | 6 products in `data.json` with images, video, sizes, colours, fabric, ratings |
| **Production auth** | bcrypt password hashing · JWT in httpOnly cookies · register / login / me / logout / profile routes |
| **Admin panel** | Full product management — add, edit, delete, image upload |
| **Mock API server** | Express.js on port 4000 — products, search, facets, cart, orders, session tracking |
| **Mobile nav** | Slide-out hamburger drawer on every page |
| **PWA** | Web app manifest + service worker |

---

## Quick start

**Prerequisites:** [Node.js](https://nodejs.org) 18+

```bash
# 1. Install server dependencies
cd mvp/mock-server
npm install

# 2. Start the server
npm start
# → Running on http://localhost:4000

# 3. Open the site
# http://localhost:4000/mvp/homepage.html
```

---

## Pages

| URL | Page |
|-----|------|
| `/mvp/homepage.html` | Landing — video carousel, collections, editorial |
| `/mvp/category.html` | Shop — product grid with filters + facets |
| `/mvp/product.html?id=<id>` | Product detail — images, video, size picker, cart |
| `/mvp/cart.html` | Shopping cart |
| `/mvp/checkout.html` | Checkout flow |
| `/mvp/confirmation.html` | Order confirmed |
| `/mvp/account.html` | Sign in · Sign up · Dashboard · Orders · Wishlist |
| `/mvp/gallery.html` | Lookbook gallery + video lightbox |
| `/mvp/about.html` | Brand story + founder |
| `/mvp/custom.html` | Bespoke / made-to-order form |
| `/mvp/support.html` | Help & FAQs |
| `/mvp/admin/` | Admin panel — product management |

---

## Auth API

All routes on `localhost:4000`:

| Method | Route | Action |
|--------|-------|--------|
| `POST` | `/api/auth/register` | Create account (bcrypt hash, JWT cookie) |
| `POST` | `/api/auth/login` | Sign in, receive 30-day cookie |
| `GET` | `/api/auth/me` | Return current user from cookie |
| `POST` | `/api/auth/logout` | Clear cookie |
| `PATCH` | `/api/auth/profile` | Update name / phone |

Users are stored in `mvp/users.json` (gitignored — never committed).

---

## Project structure

```
Pheran/
├── mvp/
│   ├── homepage.html … support.html   14 pages
│   ├── styles.css                     Base styles
│   ├── styles-upgrade.css             Luxury UI layer + CSS variables
│   ├── mobile-menu.js                 Hamburger drawer (injected on every page)
│   ├── script.js                      Page logic, cart, wishlist, search
│   ├── icons.js                       Inline SVG library
│   ├── data.json                      Product catalogue
│   ├── img-*.jpg  owner.jpg           Product photos + founder image
│   ├── admin/                         Admin panel
│   └── mock-server/
│       ├── server.js                  Express API
│       └── package.json
├── css/
│   └── variables.css                  Design tokens (colours, fonts, spacing)
├── videos/                            6 product + hero videos
├── manifest.json                      PWA manifest
└── sw.js                              Service worker
```

---

## Tech stack

- **Frontend** — Vanilla HTML / CSS / JS, no framework
- **Server** — Node.js · Express 4 · multer (image upload)
- **Auth** — bcryptjs · jsonwebtoken · cookie-parser
- **Data** — JSON flat files (`data.json`, `users.json`)
- **Fonts** — Cormorant Garamond · DM Sans · Playfair Display (Google Fonts)

---

## Roadmap

- [ ] Migrate products + orders to Supabase (PostgreSQL)
- [ ] Replace file-based auth with Supabase Auth
- [ ] Paystack payment integration
- [ ] Deploy to Railway + custom domain (pheran.ng via Cloudflare)

---

© 2026 PHERAN. All rights reserved.
