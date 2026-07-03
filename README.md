# Kanziy Operations — Internal Operations PWA

Mobile-first internal operations system for Nigerian COD businesses (Kanziy furniture + Toy Store), built as a Progressive Web App.

## Features

- **Multi-business support** — Kanziy + Toy Store (add more without rebuild)
- **Phone + PIN login** — fast, mobile-friendly, no email friction
- **Role-based access** — CEO, Operations Manager, Customer Support, Fulfillment, Waybill, Inventory
- **Order management** — intake → fulfillment → waybill → payment with full timeline
- **Waybill module** — batch creation, courier tracking, warehouse receipt confirmation
- **Inventory** — per-warehouse stock tracking, transfers, low stock alerts
- **Accounting** — sales, expenses (admin-only + operational), profit per order
- **Documents** — invoice, receipt, delivery note PDF generation
- **Customer management** — phone-keyed profiles, order history, failed delivery tracking
- **Reports** — orders, sales, expenses, profit, inventory, staff performance
- **PWA + offline** — add to home screen, offline queueing syncs when connected
- **Naira formatting** — Nigeria-appropriate currency and date/time

## Tech Stack

- React 19 + Vite 8
- TailwindCSS v4
- Supabase (PostgreSQL + Auth + Storage)
- TanStack Query (server state)
- Zustand (client state)
- React Router v7
- vite-plugin-pwa + Workbox
- jsPDF (PDF generation)
- idb (offline queue via IndexedDB)
- Lucide React (icons)

## Setup

### 1. Create Supabase project

Go to [supabase.com](https://supabase.com), create a new project.

### 2. Run database schema

In Supabase SQL Editor, run:
1. `supabase/schema.sql` — tables, indexes, seed data
2. `supabase/functions.sql` — counter function, triggers, RLS

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Install & run

```bash
npm install
npm run dev
```

### 5. Deploy to Netlify

Connect to GitHub repo. Netlify will auto-detect `netlify.toml` config.

Set environment variables in Netlify dashboard:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## Default Login (Demo)

- Phone: `08000000000`
- PIN: `1234`
- Role: CEO / Super Admin

## Adding a New Business

1. Settings → Businesses → Add Business
2. Set name, short code (e.g. `KZY`), invoice prefix
3. The business immediately appears across order intake, products, reports, and dashboards

## Order Status Flow

```
New Order
  → Awaiting Waybill
  → Waybilled
  → Received at Warehouse
  → Processing
  → Delivered
  → Partially Paid / Paid
  → (or) Failed Delivery / Cancelled / Returned
```

## Role Permissions Summary

| Feature | CEO | Ops Mgr | Support | Fulfillment | Waybill | Inventory |
|---------|-----|---------|---------|-------------|---------|-----------|
| Create Orders | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| View All Orders | ✅ | ✅ | Own only | ✅ | ✅ | ❌ |
| Waybill | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Inventory | ✅ | View | ❌ | ❌ | ❌ | ✅ |
| Accounting | ✅ | Ops | ❌ | ❌ | ❌ | ❌ |
| Admin Expenses | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Staff Mgmt | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Reports | ✅ | Ops | ❌ | ❌ | ❌ | ❌ |
| Documents | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
