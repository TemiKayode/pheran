PHERAN MVP Mock Server

This small Node/Express mock server serves `/api/products` using the local `../data.json` dataset.

Install and run:

```bash
cd mvp/mock-server
npm install
npm start
```

API contract `/api/products` supports query params:
- `size` (comma-separated values)
- `color` (comma-separated)
- `fabric` (comma-separated)
- `min` and `max` (price)
- `page` and `perPage` (pagination)
- `cursor` (base64 encoded start index) — if provided the server returns `nextCursor` for the next page
- `sort` (`popular`|`price_asc`|`price_desc`|`rating_desc`)

Response shape:
```
{
  products: [...],
  facets: { sizes: {...}, colors: {...}, fabrics: {...} },
  total: <int>,
  page: <int>?,
  perPage: <int>?,
  cursor: <string>?,
  nextCursor: <string>?
}
```

Use this server during local development and the front-end will prefer server responses but gracefully fall back to client-side filtering when not available.