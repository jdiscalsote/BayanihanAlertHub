# Bayanihan Alert Hub

**Live App:** [https://bayanihan-alert-hub.vercel.app/](https://bayanihan-alert-hub.vercel.app/)

**Bayanihan Alert Hub** is a community-driven typhoon, flood, and evacuation tracker built for Philippine barangays, municipalities, and LGUs nationwide. Designed for low-bandwidth mobile devices and unstable disaster connectivity, it allows residents to report hazards without creating an account, locate open evacuation shelters on an interactive map, compute safe routes, and access verified responder updates even when offline.

---

## Key Features

### 1. Live Community Alert Feed (List & Map Views)
- Real-time stream of **Flooded Roads**, **Power/Comms**, **Evacuation Updates**, and **Relief/Rescue Needed** reports.
- Filter alerts by **Municipality**, **Status** (`All Statuses`, `Active`, `Resolved`, `Pending Review`, `Queued Offline`), **Category**, and keyword search.
- Residents can tap **"Mark Still Active"** to crowd-confirm ongoing hazards, while verified barangay/DRRMO posts are clearly distinguished from unverified community reports.

### 2. Nationwide Interactive Map & Safe Routing (Google Maps Platform)
- Color-coded markers for **Evacuation Centers** (`Open` = Green, `Near Full` = Amber, `Full/Closed` = Red) and **Active Hazard Reports** by severity.
- **Find Safe Route** calculates driving directions and distance/ETA from the resident's GPS location—or a manually dropped **"Pick Start on Map"** pin anywhere in the Philippines—using the Google Maps **Routes API**.
- Highlights nearby **hospitals** and **barangay/municipal halls** around the active shelter or location via the **Google Places API (New)**.

### 3. Zero-Friction Hazard Reporting & PSGC Location Selector
- Residents can submit reports immediately without signing in.
- Supports **Use My GPS** (with network-location fallback), interactive **Pick on Map**, and automatic **Reverse Geocoding** (`/api/geocode/reverse`) to prefill street/landmark, barangay, municipality, and region.
- Cascading Philippine Standard Geographic Code (**PSGC**) selector for all **Regions**, **Cities/Municipalities**, and **Barangays** nationwide, with local caching and offline fallback.

### 4. Offline-First Resilience & Auto-Sync Queue
- Caches live hazard reports, evacuation center capacities, and official advisories locally via **IndexedDB** and **`localStorage`**.
- Reports submitted offline are queued on-device and automatically synced to **Supabase** once connectivity returns.
- Includes a **Simulate Offline** toggle in the toolbar to test offline readiness at any time.

### 5. Evacuation Centers Directory & Responder Console
- Nationwide directory of evacuation centers showing live occupancy progress bars, status badges, contact details, and one-tap **Find Safe Route** / **Google Maps** links.
- Authenticated **Responder / Moderator Console** (Supabase Auth) scoped to assigned municipalities to verify or resolve reports, broadcast LGU advisories, add new shelters, and update evacuation occupancy counts.

### 6. Bayanihan AI Assistant & One-Tap Emergency Hotlines
- Floating mobile-friendly chat drawer supporting **English, Tagalog, and Taglish**, grounded in live Supabase alerts/shelters and Google Search via server-side Gemini endpoints.
- Automatically surfaces one-tap **911**, **NDRRMC**, and **Red Cross 143** call buttons when rescue or urgent danger is detected, alongside a dedicated **Emergency Hotlines** tab.

---

## Local Development & Deployment Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables** (see `.env.example`):
   - `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` — Supabase project URL and public anon key (protected by Row Level Security).
   - `VITE_GOOGLE_MAPS_API_KEY` & `GOOGLE_MAPS_API_KEY` — Google Maps Platform key (Maps JS, Routes, Places New, Geocoding).
   - `GEMINI_API_KEY` — Server-side Gemini API key for the Bayanihan Assistant chat endpoint.

3. **Set up the Supabase database:**
   - Run the schema and RLS policies in `supabase/schema.sql` inside your Supabase SQL Editor.

4. **Run locally:**
   ```bash
   npm run dev
   ```

5. **Build for production:**
   ```bash
   npm run build
   ```

---

## Tech Stack

| Layer | Technology / Service | Role in Project |
| :--- | :--- | :--- |
| **Frontend (Web App)** | **React 19**, **TypeScript**, **Vite 8**, **Tailwind CSS v4**, **Lucide React** | Primary responsive SPA (`src/`), accessible mobile-first emergency UI, utility styling, and static build output (`dist/`). |
| **Frontend (Angular Workspace)** | **Angular** (`angular/`) | Companion Angular source structure included in the repository alongside the primary React/Vite build. |
| **Backend & Serverless API** | **Node.js**, **Express**, **tsx**, **Vercel Serverless Functions** (`api/`) | Local Express + Vite middleware server (`server.ts`) and production Vercel `/api/*` endpoints (`/api/health`, `/api/assistant/chat`, `/api/geocode/reverse`). |
| **Database, Auth & Realtime** | **Supabase (Free Tier)** — PostgreSQL, Supabase Auth, Supabase Realtime, Row Level Security (RLS) | Stores hazard reports, evacuation centers, advisories, and moderator profiles (`supabase/schema.sql`) with live updates and municipality-scoped responder access. |
| **Maps & Geolocation** | **Google Maps Platform** (`@vis.gl/react-google-maps`, Routes API, Places API New, Geocoding API) + Browser Geolocation API | Interactive shelter/hazard map, driving routes & ETA, nearby hospitals/barangay halls, and map pin reverse geocoding. |
| **Philippine Geo Data** | **PSGC API** (`psgc.gitlab.io/api`) + Local Fallback Cache | Cascading Region → City/Municipality → Barangay selectors across the Philippines. |
| **AI Assistant** | **Google Gemini API** (`@google/genai`) with Google Search Grounding | Server-side bilingual (English/Tagalog/Taglish) emergency guidance grounded in live Supabase context. |
| **Offline Persistence** | **IndexedDB** + **`localStorage`** | Offline snapshot caching for alerts/shelters/advisories and automatic background sync queue. |
| **SEO & Metadata** | **OpenGraph**, **Twitter Cards**, **Schema.org JSON-LD** (`WebApplication`) | Search engine indexing, canonical URL resolution, and rich social link previews (`index.html`). |
| **Source Control & Hosting** | **GitHub** + **Vercel** | Version control, continuous GitHub-to-Vercel deployments, static CDN hosting, and serverless `/api/*` execution at `https://bayanihan-alert-hub.vercel.app/`. |
