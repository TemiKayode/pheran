# PHERAN Storefront — How to Run

## Quickest way (no server needed)

Just open any HTML file directly in your browser:

```
mvp/homepage.html   ← start here
```

Double-click the file in File Explorer, or drag it into Chrome/Edge/Firefox. All pages link to each other and work offline — no build step required.

---

## Recommended way (with mock API server)

The mock server serves `data.json` over HTTP so the product pages load correctly in all browsers (avoids CORS issues with `fetch()` on `file://`).

**Prerequisites:** Node.js installed ([nodejs.org](https://nodejs.org))

**Steps:**

```powershell
# 1. Open a terminal in the mock-server folder
cd "C:\Users\Ayo\Downloads\Pheran\mvp\mock-server"

# 2. Install dependencies (first time only)
npm install

# 3. Start the server
npm start
```

The server runs at **http://localhost:3000**

Then open your browser and go to:

```
http://localhost:3000/homepage.html
```

> If the server doesn't serve HTML files, open `mvp/homepage.html` directly in your browser while the server is running — the JS will fetch from `localhost:3000`.

---

## Pages

| File | Description |
|------|-------------|
| `homepage.html` | Landing page with video hero, collections, editorial |
| `category.html` | Shop / product grid with filters |
| `product.html?id=silk-wrap-001` | Product detail — images + video player |
| `cart.html` | Shopping cart |
| `checkout.html` | Checkout flow |
| `confirmation.html` | Order confirmed |
| `account.html` | Account / orders |
| `wishlist.html` | Saved items |
| `gallery.html` | Lookbook gallery + video lightbox |
| `about.html` | Brand story |
| `custom.html` | Bespoke / custom order |
| `support.html` | Help & FAQs |

---

## Project structure

```
mvp/
├── homepage.html, product.html, ...   HTML pages
├── styles.css                         Base styles
├── styles-upgrade.css                 Luxury UI layer (loads after styles.css)
├── icons.js                           SVG icon library (ICONS global object)
├── script.js                          All page logic + data rendering
├── data.json                          Product catalogue (6 products)
├── img-*.jpg                          Real product photos
├── css/
│   └── variables.css                  Design tokens (colors, fonts, spacing)
└── mock-server/
    ├── server.js                      Express API server
    └── package.json
```

State is stored in `localStorage` — no backend required for the full shopping flow (cart, wishlist, recently viewed, orders).
