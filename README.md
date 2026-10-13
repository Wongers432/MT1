# TapTrack web draft

A working web version of the TapTrack iPhone app, built from the developer brief (13 Oct 2026).
Plain HTML, CSS and JavaScript with no build step. Data is saved in the browser (localStorage) only.

## What works
- **Today**: safe to spend today, status pill, budget ring, streak, nudge card, last 5 transactions (tap to edit, swipe left to delete with Undo), "No spend today"
- **Spending**: Week / Month / Year, daily bars (tap a bar to filter), category breakdown, search, category filter, list grouped by day
- **+ Quick log**: big keypad (keyboard works too), category bubbles with a best guess, note, date
- **Goals**: savings jars (add money, confetti when complete) and monthly category limits
- **Plan**: budget card, month's effective balance, inflows, outflows, Monthly Committed
- **Settings**: Plus card, quick capture setup guides, theme (System / Dark / Light), budgets, categories, reminders, CSV export, sample data, Reset (type RESET)
- **Onboarding** (5 screens) and a **Paywall** that switches on Plus in demo mode (no payment)
- Free vs Plus limits from the brief: 1 jar, 1 limit, 5 flows, 3 custom categories, current period only

Not possible on the web: Back Tap, Apple Pay auto-log, widgets, Siri, iCloud. Those screens explain the iPhone setup instead.

## Run locally
```
cd web
python3 -m http.server 8000
```
Then open http://localhost:8000.

## Deploy on Vercel
1. Put this `web` folder in a GitHub repo (it can be the whole repo, or a folder inside one).
2. Go to vercel.com → Add New → Project → import the repo.
3. Framework Preset: **Other**. Root Directory: the `web` folder (leave blank if it is the repo root). No build command, no output directory.
4. Click Deploy.

Or without GitHub: `npm i -g vercel`, then run `vercel` inside this folder and accept the defaults (`vercel --prod` for the live URL).
