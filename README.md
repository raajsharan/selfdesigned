# Infrastructure Inventory Management Tool

IT asset inventory platform built with React (Ant Design 5), Node.js/Express and PostgreSQL. It combines four asset inventories, a decommission lifecycle, VMware vSphere and Proxmox VE discovery, a VMware-to-Proxmox migration tracker, and Tenable, Nessus, ManageEngine and Microsoft Teams integrations in one application.

## You design the pages

Nothing is pre-built. There are no fixed "Assets", "Servers" or "Beijing" screens: every page in the menu is one an administrator created in **Admin → Page Designer**, laid out exactly as they want it. Two kinds of page:

| Kind | What it is |
|---|---|
| **Records page** | Holds its own data. You choose its **fields**, then arrange the **form** (sections, 1 to 3 columns, field widths, conditional fields) and the **table** (which columns, in what order, widths, filter drop-downs, default sort) by dragging. |
| **View page** | A table that pulls rows from whichever records pages you tick, for example **All records**. Columns can map differently named fields (`server_name` on one page, `device` on another) into one column. Read-only; clicking a row opens it on its own page. |

**Field types:** text, long text, number, yes/no, date, choice list (custom options or a shared Dropdown Master list), **IP address** (IPv4 `x.x.x.x`, e.g. `192.168.1.1`, validated in the form and on the server) and password (AES-256-GCM encrypted, never returned, reveal is permission-gated and audited). On first start after upgrading, existing fields whose meaning is *IP address* are converted to the IP address type once; change one back in the designer if you need free text there (records holding a non-IPv4 value are rejected on their next edit).

**Dependent dropdowns.** A choice-list field that uses a Dropdown Master list can *depend on* another choice-list field, so it only offers the values linked to the parent's current choice (for example OS Version by OS Type). Set it on the Fields tab ("Depends on"), and give each value its **Parent value** in Admin → Dropdown Master. Changing the parent clears the dependent field. Starter `os_version` values for Windows, Linux, VMware ESXi and Proxmox VE are seeded; the OS Version field must use the `os_version` category and the OS Type values must match the parents exactly.

**Form designer.** *Sort by field order* rearranges each form section to follow the order on the Fields tab. Table-layout columns wrap onto the next row instead of running off the edge.

**Field meanings.** A field can be given a meaning: Name, Hostname, IP address, MAC address, Asset tag, Status, Operating system, Department, Location, Owner, Patching type or Last patched. Meanings are how features that span pages find the right field without caring what you called it:

| Feature | Uses |
|---|---|
| Duplicate checks (tag and IP unique across *all* pages) | Asset tag, IP address |
| Decommission frees tag and IP; reactivation reclaims them | Asset tag, IP address |
| Tag ranges per department, "Assign tags" bulk action | Asset tag, Department |
| Weekly report, with *NA* and *Not in Scope* excluded | Status, Last patched, OS, Department, Location |
| Reconcile and discovery drift; Tenable, Nessus and Endpoint Central matching | IP address, MAC address, Name, Hostname |
| "All records" automatic column building | any meaning |

**Department Tag Ranges** (Admin) lists each range with its Sort position, Total, Used (live tags on every page), Free, a utilisation bar and an Active switch; inactive ranges are not enforced on asset tags.

Changing a field's meaning later re-maps existing records automatically. Field **keys** are fixed once saved (records already use them).

### Also included

* **Per-page records**: encrypted password fields, required and unique flags, conditional fields, Excel import with create / merge / error preview, CSV export (never includes passwords), bulk status / tags / delete, soft delete with recycle bin, global search across every field of every page
* **Decommission lifecycle**: immutable log (a database trigger blocks edits and deletes), reactivation refused if the tag or IP was reused meanwhile
* **Migration tracker**: projects start with **no predefined tabs** (add your own, including custom ones), typed custom fields, inline editing, column show/hide and reorder, summary cards, overview, multi-sheet Excel import, sync from VMware discovery
* **Discovery**: vSphere (REST) and Proxmox VE (API token): VM list, dashboard, drift, topology, stale VMs, MAC lookup, scheduled runs, one-click add to **any records page you choose**
* **Integrations**: Tenable report, Nessus agent status with SSH install, ManageEngine Endpoint Central (API key or credentials + TOTP), Teams Adaptive Card notifications
* **Administration**: roles and custom roles, per-user page overrides, dropdowns, tag ranges, compliance config, branding, audit log, backup/restore, Swagger at `/api/docs`

### Sign-in, lock screen and profile

* **Login and lock screens** with an animated infrastructure background (nodes, links, data packets; static when the browser asks for reduced motion). The screen **locks automatically after 5 minutes without activity** (also from the user menu → *Lock screen*); the user unlocks with their password, or chooses *Not you? Sign in* to switch account.
* **Light / dark theme**: a toggle in the header (between the date and the profile menu). The choice is remembered per browser and defaults to the operating system setting. Colours come from CSS variables in `frontend/src/styles.css`; use them (`var(--surface)`, `var(--text)`, `var(--muted)`, `var(--border)`) rather than hard-coded greys in new UI.
* **Records open in popups**: *Add / Edit record* is a modal over the same page, and the eye icon opens a detail popup with summary cards, form sections and a password reveal / copy (permission-gated and audited).
* **My profile** (`/profile`, user menu → *My profile*, available to every signed-in user) is the Account Settings page: **General** (user name, name, email, company, profile photo up to 800 kB, cropped and shrunk to 256 px in the browser), **Change Password**, **Info** (job title, phone, location, about) and **Notifications** (switches, stored for future use; nothing sends email yet). The header shows the photo and a clock with the date. API: `PUT /api/auth/me/profile` changes only the sections sent; user name and email must be unique.

### Access to designed pages

Each page gets a permission key `page:<address>`. Admin, Asset Manager and Viewer roles can open every page (Viewer read-only); custom roles and per-user overrides can allow or block individual pages. A view page only shows rows from source pages the signed-in user may open.

## Stack

React 18 + Vite + Ant Design 5 · Node.js 20+ + Express 4 · PostgreSQL 14+ · ExcelJS · node-ssh · AES-256-GCM via Node `crypto` · bcrypt · JWT (HS256)

## Quick start (development)

```bash
# 1. Database
createdb infrastructure_inventory

# 2. Backend
cd backend
cp .env.example .env        # set DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD, JWT_SECRET, ENCRYPTION_KEY, SUPERADMIN_*
npm install
npm run dev                 # http://localhost:4000  (creates every table on first start)

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev                 # http://localhost:5173  (proxies /api to :4000)
```

Generate secrets with `openssl rand -hex 32` (one each for `JWT_SECRET` and `ENCRYPTION_KEY`; the encryption key must be exactly 64 hex characters). The superadmin account is created on first start from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.

> **Back up `ENCRYPTION_KEY`.** Stored asset passwords, iDRAC passwords, API tokens and the Teams webhook cannot be decrypted without it.

Schema is applied automatically on every start (`backend/src/bootstrap/ensureSchema.js` runs the idempotent files in `db/`). You can also apply them by hand with `psql -f db/schema.sql` etc.

### Production (single port)

```bash
cd frontend && npm ci && npm run build      # outputs frontend/dist
cd ../backend && npm ci --omit=dev && NODE_ENV=production node server.js
```

The backend serves the compiled UI and the API on `PORT`. For systemd and nginx see `deploy/`.

## Tests

`backend/test/smoke.test.js` is an end-to-end API suite (19 scenarios). It designs its own pages through the API first, then exercises RBAC, page-design validation, cross-page uniqueness, encryption, the combined view, the decommission lifecycle, import, migration, reports, backup and page deletion. Run it against a **throw-away database**:

```bash
cd backend
RATE_LIMIT_LOGIN=1000 npm run dev &        # the suite logs in many times
BASE_URL=http://localhost:4000 TEST_EMAIL=you@example.com TEST_PASSWORD='...' npm test
```

`e2e/designer.mjs` is a browser test (Playwright) that designs pages by clicking and dragging: fields, form layout, table layout, saving, adding records, and building an "All records" view. It needs a **fresh** database; see the header of the file.

## Roles

| Role | Access |
|---|---|
| Superadmin | God access: every page, write access and password reveal, whatever the role settings say. A **hidden account**: never listed in Users, User Page Control or Roles (not even to itself), and cannot be edited, deleted or assigned through the UI or API. Created at startup from `SUPERADMIN_*`; it manages its own name and password on the profile page |
| Admin | Everything except superadmin management |
| Asset Manager | All operational pages, read/write; no Administration pages |
| Viewer | Read-only inventory, discovery, migration, reports |
| Custom roles | Pick pages and whether the role can change data |

**Editing roles** (Admin → Roles): every role has an *Edit* button. Custom roles are fully editable. **Asset Manager** and **Viewer** can be customised (pages and *can change data*, stored in `builtin_role_overrides`) and put back with *Reset*; once customised, pages designed later must be ticked by hand. **Admin** and **Superadmin** are fixed so nobody can be locked out. A custom role cannot be deleted while users still have it.

Per-user overrides (User Page Control) can force a page on or off and grant `can_view_passwords`. Access is re-read from the database on every request, so revoking takes effect immediately.

## Security notes

* Passwords: bcrypt (12 rounds); strength rule 8+ chars with upper, lower and digit; login limited to 20 attempts / 15 min / IP (`RATE_LIMIT_LOGIN` overrides for tests), password change 5 / 15 min
* Asset, iDRAC, Endpoint Central, Nessus key and Teams webhook secrets are AES-256-GCM encrypted at rest and never returned by the API; reveal endpoints are audited and gated by `can_view_passwords`
* Helmet + CSP, explicit CORS allow-list, parameterised SQL everywhere, express-validator on routes, upload extension + MIME allow-list and size limits, generic 500s in production
* Branding logos accept PNG/JPEG/WebP only (SVG can carry script)
* Nessus SSH install uses trust-on-first-use host-key pinning and builds commands only from validated config values; SSH credentials are used once and not stored
* `pg_dump` receives the DB password through its environment, not the command line
* CSV backups exclude password / token / hash columns; use the database dump for a complete restore

## Known limits (read before relying on it)

**Page design**

* Only one field per page can have a given meaning, and password fields cannot have one.
* Field keys cannot be renamed after saving. Removing a field hides it; the stored values stay in the records.
* Deleting a page deletes its records (you must type its address to confirm, and it must not feed a view). The decommission log is kept.
* Write access is global per role (read-only vs can change data), not per page; page access can be granted or blocked per page.
* There is no migration from the four fixed inventories of the earlier scaffold: this build starts empty. Import existing data into pages you design.
* The designer uses native browser drag-and-drop; every drag also has a button alternative (arrows, remove) for keyboards.

**Integrations**


These were verified by running the code against PostgreSQL and a real browser, but **the integrations could not be tested against live third-party systems** from the build environment:

* **vSphere** discovery uses the vSphere Automation REST API (vCenter / ESXi 7.0U2+). That API does not expose **snapshots**, so VMware snapshot data is not collected (the page says so). Guest IPs need VMware Tools.
* **Endpoint Central**: endpoint paths and field names follow the public v1.4 REST API but vary between builds, and the credential/TOTP handshake is implemented from the documented flow. Expect to adjust `backend/src/services/endpointCentralService.js` once you test against your server.
* **Proxmox**: written against the documented `/api2/json` endpoints with API-token auth; guest IPs need the QEMU guest agent.
* **Teams**: sends Adaptive Cards in the Workflows-webhook format; verified that a dead webhook never slows or breaks the triggering request, not against a real channel.
* **Nessus install** over SSH is untested against a real host. Configure package URLs and the linking key under Nessus Agent Status → Install settings.
* Scheduled discovery/backup run in-process (checked every minute). Run a single backend instance, or move them to cron if you scale out.
* Menu order and migration column preferences are stored per browser (`localStorage`), by design.

## Layout

```
backend/   server.js, src/{bootstrap,config,controllers,middleware,routes,services,utils}, test/
frontend/  src/{api,components,context,pages,utils}; pages/Admin/Designer is the page designer
e2e/       browser test of the designer (Playwright)
db/        schema.sql, vmware_schema.sql, proxmox_schema.sql, tenable_schema.sql, vmware_asset_edits.sql
deploy/    inventory-backend.service, nginx-inventory.conf
```

## Upgrading

New columns on `users` (user name, company, photo, profile) and on `dropdown_values` (parent value) are added automatically on start, so restart the backend after pulling.

```bash
git pull
cd backend && npm ci --omit=dev
cd ../frontend && npm ci && npm run build
sudo systemctl restart inventory-backend      # schema changes apply automatically
```
