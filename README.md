# Prospect Pal

Internal prospecting and lead-management platform for an SEO and website-design agency.

## Foundation stack

- npm workspaces monorepo
- React, Vite, TypeScript, Tailwind CSS, and TanStack Query
- NestJS REST API with Zod request validation and Pino structured logging
- PostgreSQL with Prisma ORM and versioned migrations
- Persistent in-process discovery jobs with retries and exponential backoff
- Auth0 SPA login with NestJS JWT verification against Auth0 JWKS

## Local setup

Requirements: Node.js 22+, PostgreSQL, and (for real Maps discovery) Docker.

```bash
cp .env.example .env
# Set DATABASE_URL to your PostgreSQL connection string
# Set AUTH0_* and VITE_AUTH0_* (see Auth0 dashboard setup below)
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

`npm run dev` still starts the API + web app. If Docker is installed, it also starts the
Maps scraper on `http://localhost:8080` in the background.

The web app runs at `http://localhost:5173`, the API at `http://localhost:3000/api`,
and dependency health is available at `GET /api/health`.

### Business discovery (no Google Places API)

Local development defaults to `BUSINESS_DISCOVERY_PROVIDER=mock` (fake leads, free).

For real Google Maps listings, set in `.env`:

```bash
BUSINESS_DISCOVERY_PROVIDER=maps
MAPS_SCRAPER_URL=http://localhost:8080
```

Then `npm run dev` (with Docker) is enough. First scrapes often take a few minutes.
For heavier usage, set `MAPS_SCRAPER_PROXIES` to residential/SOCKS proxies.

### Auth0 dashboard setup

1. Create (or convert) an application as type **Single Page Application**.
2. Application settings:
   - Allowed Callback URLs: `http://localhost:5173`
   - Allowed Logout URLs: `http://localhost:5173`
   - Allowed Web Origins: `http://localhost:5173`
   - Token Endpoint Authentication Method: **None**
3. Under Application → Settings → Advanced → Grant Types, enable **Authorization Code**,
   **Refresh Token**, and (if shown) **Refresh Token Rotation**.
4. Create an API in Auth0:
   - Identifier: `https://api.prospect-pilot.local` (must match `AUTH0_AUDIENCE` / `VITE_AUTH0_AUDIENCE`)
   - Signing Algorithm: RS256
5. Copy Domain and Client ID into `.env` for both `AUTH0_*` and `VITE_AUTH0_*` values.

First successful login creates a local user + organization membership via `GET /api/auth/me`.

## Useful commands

```bash
npm run build
npm run lint
npm run test
npm run typecheck
```

## Scope

The repository currently contains:

- Milestone 1: workspace setup, Auth0 authentication, logging, and sign-in UI
- Milestone 2: search campaigns, Google Maps scraper discovery (gosom), a local mock provider,
  idempotent business storage, campaign-run history, and persistent local job processing

Local development uses `BUSINESS_DISCOVERY_PROVIDER=mock`. For real data, set the provider to
`maps` and `MAPS_SCRAPER_URL=http://localhost:8080`, then use `npm run dev` (Docker starts the
scraper). Run `POST /api/campaigns/:id/run`; the resulting businesses are available from
`GET /api/businesses`.
