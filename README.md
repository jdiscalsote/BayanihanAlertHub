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

### 4. Offline-First Resilience, Auto-Sync & Battery-Saver Mode
- Caches live hazard reports, evacuation center capacities, official advisories, and family safety check-ins locally via **IndexedDB** and **`localStorage`**.
- Hazard reports and family check-ins submitted offline are queued on-device and automatically synced to **Supabase** once connectivity returns, with manual **Sync** and **Test Connection** controls.
- Includes a **Simulate Offline** toggle in the feed toolbar and a **Battery-Saver Mode** toggle in the top bar that switches to a high-contrast, low-glare dark surface (including dark hover, focus, and alert states) and pauses background polling, realtime subscriptions, and interactive map tiles to conserve phone battery.

### 5. Evacuation Centers Directory & Responder Console
- Nationwide directory of evacuation centers showing live occupancy progress bars, status badges, contact details, and one-tap **Find Safe Route** / **Google Maps** links.
- Authenticated **Responder / Moderator Console** (Supabase Auth) scoped to assigned municipalities with role-based management tabs (permanent **Delete** actions and **CSV Data Exports** across all tabs are restricted to **Admin** accounts only):
  - **Data Management (Admin Only):** Dedicated card to export current hazard reports, evacuation center data, and family safety check-ins (scoped to the active Municipality filter or nationwide) as spreadsheet-safe UTF-8 CSV files with individual category **Export CSV** buttons, a **Download All** option, and a **Status Summary** pie-chart modal visualizing Pending, Verified, and Dismissed report distributions.
  - **Report Triage:** Moderators can verify, resolve, restore, or dismiss/archive hazard reports and inspect any report's **Details & Timeline** log (exact creation, last updated, and moderator verification/dismissal audit trail); Admins can also permanently **Delete** reports.
  - **Evacuation Capacity:** Moderators can add shelters and update status & headcount; Admins can also permanently **Delete** shelters.
  - **Official Advisories:** Moderators can publish LGU advisories and deactivate/archive old bulletins; Admins can also permanently **Delete** them.
  - **Family Check-Ins:** Search and monitor Family *"I'm Safe"* check-in records across live database and local queues (**Delete** restricted to Admins).
  - **Responders (Admin Only):** View all assigned responders across every municipality, create new responder/admin accounts with an auto-generated temporary default password, modify municipality/role/office assignments, reset default passwords, or delete responder accounts.
  - **Account & Password (All Accounts):** Every responder and admin account can view their assigned jurisdiction and change their own password at any time.

### 6. SOS & Check-In Tools, Go-Bag Checklist & Emergency Hotlines
- **One-Tap SOS SMS & Safe Location Card:** Formats an SMS with GPS coordinates, street/landmark, headcount, and special rescue needs for **911**, **Red Cross 143**, **QC 122**, **Marikina 161**, or custom family numbers even with zero mobile data.
- **Family "I'm Safe" Check-In & Person Finder:** Residents can log their safety status and shelter location to the live Supabase `safety_checkins` database (with offline fallback, realtime updates, and schema/sync diagnostics) so relatives can search and verify them across devices.
- **Interactive Go-Bag Checklist:** Bilingual (English & Tagalog) pre-evacuation checklist persisted locally on-device.
- **Bayanihan AI Assistant & Emergency Hotlines:** Floating bilingual (**English, Tagalog, Taglish**) chat drawer grounded in live Supabase data and Google Search, plus a dedicated **Emergency Hotlines** tab covering national rescue lines, local LGU DRRMOs, power/water utilities, and direct official **PAGASA / NDRRMC / MMDA** portal links.

---

## Local Development & Deployment Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables** (see `.env.example`):
   - `VITE_SUPABASE_URL` & `VITE_SUPABASE_ANON_KEY` — Supabase project URL and public anon key (protected by Row Level Security).
   - `SUPABASE_SERVICE_ROLE_KEY` — Server-only Supabase secret key (`service_role` or `sb_secret_...`, never the `anon`/`publishable` key and never prefixed with `VITE_`) used by `/api/admin/responders` so verified admins can create responder Auth accounts, generate/reset default passwords, and delete accounts.
   - `VITE_GOOGLE_MAPS_API_KEY` & `GOOGLE_MAPS_API_KEY` — Google Maps Platform key (Maps JS, Routes, Places New, Geocoding).
   - `GEMINI_API_KEY` — Server-side Gemini API key for the Bayanihan Assistant chat endpoint.

3. **Set up the Supabase database:**
   - Run the schema, indexes, triggers, `GRANT` permissions, and RLS policies in `supabase/schema.sql` inside your Supabase SQL Editor (creates `moderator_profiles`, `evacuation_centers`, `hazard_reports`, `advisories`, and `safety_checkins`).

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
| **Frontend (Web App)** | **React 19**, **TypeScript**, **Vite 8**, **Tailwind CSS v4**, **Lucide React** | Primary responsive SPA (`src/`), accessible mobile-first emergency UI, Battery-Saver dark mode, utility styling, and static build output (`dist/`). |
| **Frontend (Angular Workspace)** | **Angular** (`angular/`) | Companion Angular source structure included in the repository alongside the primary React/Vite build. |
| **Backend & Serverless API** | **Node.js**, **Express**, **tsx**, **Vercel Serverless Functions** (`api/`) | Local Express + Vite middleware server (`server.ts`) and production Vercel `/api/*` endpoints (`/api/health`, `/api/assistant/chat`, `/api/geocode/reverse`, `/api/admin/responders`). |
| **Database, Auth & Realtime** | **Supabase (Free Tier)** — PostgreSQL, Supabase Auth, Supabase Realtime, Row Level Security (RLS) | Stores hazard reports, evacuation centers, advisories, family safety check-ins (`safety_checkins`), and responder/admin profiles (`moderator_profiles`) with live updates, self-service password updates, and admin-managed municipal access. |
| **Maps & Geolocation** | **Google Maps Platform** (`@vis.gl/react-google-maps`, Routes API, Places API New, Geocoding API) + Browser Geolocation API | Interactive shelter/hazard map, driving routes & ETA, nearby hospitals/barangay halls, and map pin reverse geocoding. |
| **Philippine Geo Data** | **PSGC API** (`psgc.gitlab.io/api`) + Local Fallback Cache | Cascading Region → City/Municipality → Barangay selectors across the Philippines. |
| **AI Assistant** | **Google Gemini API** (`@google/genai`) with Google Search Grounding | Server-side bilingual (English/Tagalog/Taglish) emergency guidance grounded in live Supabase context. |
| **Offline Persistence** | **IndexedDB** + **`localStorage`** | Offline snapshot caching for alerts/shelters/advisories/check-ins, Go-Bag checklist persistence, and automatic background sync queue. |
| **SEO & Metadata** | **OpenGraph**, **Twitter Cards**, **Schema.org JSON-LD** (`WebApplication`) | Search engine indexing, canonical URL resolution, and rich social link previews (`index.html`). |
| **Source Control & Hosting** | **GitHub** + **Vercel** | Version control, continuous GitHub-to-Vercel deployments, static CDN hosting, and serverless `/api/*` execution at `https://bayanihan-alert-hub.vercel.app/`. |
