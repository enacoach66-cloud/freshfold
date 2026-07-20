# FreshFold Laundry Quotation System

A static quotation builder with a Supabase/PostgreSQL backend, Vercel Functions, and a protected owner dashboard. The public quotation page remains at `/`; the private dashboard is at `/orders` and is not linked publicly.

## Architecture

- `index.html`, `styles.css`, `app.js`: framework-free public quotation interface.
- `data/services.js`: single price-list source.
- `api/index.js`: Vercel API gateway. It validates input, recalculates totals, checks authentication/roles, and uses the service role only on the server.
- `orders/`: login and responsive owner dashboard. Supabase Auth sessions are sent to the API as bearer tokens.
- `supabase/migrations/001_initial_schema.sql`: PostgreSQL schema, indexes, triggers, grants, and RLS policies.
- Local storage is retained only for temporary drafts, backward-compatible local copies, and the explicit one-time import tool.

Money is stored as `numeric`, rounded to two decimal places on the server, and never accepted from browser-submitted totals.

## Environment variables

Copy `.env.example` to `.env.local` for local Vercel development.

| Variable | Exposure | Purpose |
|---|---|---|
| `SUPABASE_URL` | Public-safe | Supabase project URL |
| `SUPABASE_ANON_KEY` | Public-safe | Browser authentication; RLS still applies |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Privileged API database operations |
| `OWNER_EMAIL` | Server only | Additional owner-dashboard allowlist |
| `APP_TIMEZONE` | Server | Set to `Africa/Nairobi` |
| `ALLOWED_ORIGIN` | Server | Production application origin |

Never place the service-role key in `app.js`, any `orders` file, or a `PUBLIC_`/`VITE_` variable.

## Supabase setup

1. Create a Supabase project and save its URL, anon key, and service-role key securely.
2. Open **SQL Editor**, paste `supabase/migrations/001_initial_schema.sql`, and run it once.
3. In **Authentication → Providers**, enable Email/Password. Disable public sign-ups unless operators will be provisioned through a controlled process.
4. In **Authentication → Users**, create the owner with the same email that will be used for `OWNER_EMAIL`.
5. Assign the owner profile in SQL, replacing the placeholders:

   ```sql
   insert into public.profiles (id, email, role, full_name)
   select id, email, 'owner', 'Business Owner'
   from auth.users
   where lower(email) = lower('owner@example.com')
   on conflict (id) do update set role = 'owner', email = excluded.email;
   ```

6. For an operator, use the same statement with role `operator`. Operators do not pass the owner checks used by `/api/admin/*`.
7. Confirm RLS is enabled on every public table. Do not add anonymous read policies.

### Authentication flow

`/orders/login` loads only the public Supabase URL and anon key from `/api/config`, signs in through Supabase Auth, and redirects to `/orders`. The dashboard verifies the session by calling an admin endpoint. Every admin endpoint independently validates the JWT, loads the profile, requires role `owner`, and matches the authenticated email to `OWNER_EMAIL`. Missing sessions return 401; non-owner sessions return 403. Signing out clears the Supabase session.

To reset the owner password, use **Supabase Dashboard → Authentication → Users → Send password recovery**, or the configured Supabase recovery flow. Never edit a password in source files.

## Vercel deployment

1. Import this repository into the existing Vercel project.
2. Add all variables from `.env.example` under **Project Settings → Environment Variables** for Production and Preview as appropriate.
3. Set `ALLOWED_ORIGIN` to the exact production origin and `APP_TIMEZONE` to `Africa/Nairobi`.
4. Deploy. Vercel installs `package.json` dependencies and deploys `api/index.js` as a function.
5. Verify `/`, `/orders/login`, `/orders`, and `/api/health`.
6. Visit `/orders` in a private window: it must redirect to `/orders/login`. Sign in with an operator: admin APIs must return 403. Sign in with the owner: the dashboard should load.
7. Browser refreshes work through the rewrites in `vercel.json`.

Run locally with:

```sh
npm install
npx vercel dev
```

Opening `index.html` directly still displays the UI, but database and authentication features require `vercel dev` or a deployment.

## Quotation persistence and events

Each new browser quotation receives a stable UUID and a 256-bit write capability token. The server stores only its SHA-256 hash. First save uses `POST /api/quotes`; subsequent saves use `PUT /api/quotes/:id`. Repeated clicks reuse the same UUID. The server recalculates each line, subtotal, discount, fees, total, balance, and payment status.

- **Save:** upserts the stable quotation and items; local draft is cleared only after success.
- **Print:** saves first, records `print_initiated`, opens the browser dialog, then records `print_dialog_closed` where `afterprint` is supported. It does not claim physical printing succeeded.
- **PDF:** saves first and records `pdf_generated`; the existing browser Save-as-PDF workflow remains.
- **WhatsApp:** saves first, records `whatsapp_shared`, then opens the share link.
- **Offline:** the draft is marked unsynced locally. Print/PDF/share stop instead of claiming a secure save. An `online` event retries the same UUID.

## Payments, revisions, and voiding

Payments are append-only records. Cash, M-Pesa, bank, card, and other methods are supported. M-Pesa, bank, and card require a reference unless an owner explicitly overrides through the API. Active payments recalculate paid amount, balance, and unpaid/partial/paid/overpaid status. Corrections reverse the original payment with a required reason; they do not edit it silently.

Finalised quotations cannot be silently changed through the public capability. Owner revisions increase `revision_number` and write event/audit records. Voiding requires a reason and preserves the quotation.

## Dashboard

The owner dashboard provides date ranges, quotation/payment reporting modes, summary cards, daily quoted/payment charts, payment-method and status charts, service charts, searchable/filterable/paginated history, details and activity, payment recording, revisions, voiding, print/PDF, WhatsApp, review warnings, and CSV export. Quoted value and received payments are labelled separately.

## Importing existing local quotations

1. Open `/orders` in the same browser profile that contains the old saved quotations.
2. Select **Scan this browser** under **Local quotation import**.
3. Review the displayed count and confirm explicitly.
4. The owner-only import endpoint validates every record, preserves usable quote numbers/dates, skips duplicates, sets `imported_from_local_storage`, and creates import/audit events.
5. No local record is uploaded automatically.

## Backup and restore

- Enable Supabase Point-in-Time Recovery on a supported plan, or take scheduled database backups from **Database → Backups**.
- For an additional logical backup, use `pg_dump` with the Supabase connection string stored outside the repository.
- Restore into a staging project first with `pg_restore`, verify counts and financial totals, then follow Supabase's documented production restore procedure.
- Never download or commit database credentials with a backup.

## Manual test checklist

- Create, save, recover, and synchronize a quotation.
- Repeat Save, Print, PDF, and WhatsApp; confirm a single quotation UUID and correct events.
- Manipulate totals in a request; confirm server-calculated totals win.
- Test fixed/percentage discounts and all fees.
- Record partial, full, and overpayments for every method.
- Confirm references are required for M-Pesa, bank, and card.
- Reverse a payment with a reason and verify both records remain.
- Finalise, revise, and void with audit/event records.
- Test today, payment-date, custom range, search, sorting, pagination, and CSV export.
- Compare chart totals with SQL/API totals.
- Confirm anonymous and operator sessions cannot use `/api/admin/*`.
- Confirm the service-role key never appears in browser source or network responses.
- Test public and dashboard layouts on mobile, tablet, and desktop.
- Run the local import twice and confirm the second run skips duplicates.

## Troubleshooting

- **503 Backend is not configured:** verify Vercel environment variables and redeploy.
- **401:** sign in again and check the Supabase session.
- **403:** ensure the profile role is `owner`, its email matches `OWNER_EMAIL`, and casing/whitespace are correct.
- **Database operation failed:** check Vercel function logs and Supabase logs without exposing errors to public users.
- **Dashboard charts empty:** confirm the selected range, Africa/Nairobi dates, and that quotations are not voided.
- **Offline draft does not sync:** restore connectivity and keep the quotation page open; the stable UUID prevents duplicate retry uploads.

## Limitations

- Browser print APIs cannot confirm a physical print or silently save a PDF.
- `afterprint` support varies by browser.
- Chart.js and Supabase browser clients currently load from jsDelivr; self-host these files if the dashboard must run without CDN access.
- Public quotation creation is intentionally write-only through a capability token; no anonymous history read is exposed.
