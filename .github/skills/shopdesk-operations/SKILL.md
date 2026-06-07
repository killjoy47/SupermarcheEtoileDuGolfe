---
name: shopdesk-operations
user-invocable: true
description: "Use when working on Supermarche Etoile du Golfe operations: barcode label printing issues, frontend cache/PWA stale UI, launcher behavior on Windows, delivery package sync, and roadmap notes (margin/profit/peremption). Keywords: code barre, impression, telecharger PDF, print-labels, service worker, start-shopdesk, livraison, marge, benefice, peremption, promotion."
---

# ShopDesk Operations Skill

## Purpose

This skill packages the practical workflow used in this repository to:

1. Diagnose and fix barcode label printing regressions.
2. Eliminate stale UI caused by service worker/browser cache.
3. Keep launcher and delivery package behavior aligned.
4. Preserve roadmap decisions in repo memory for later implementation.

## Repository Facts

- Runtime backend serves static frontend from `frontend/dist`.
- Launcher path from desktop shortcut goes to `launch-supermarche.vbs`, then `start-shopdesk.cmd`.
- Active API route for direct barcode printing is `/api/articles/print-labels` with auth.
- Delivery mirror exists under `delivery/SupermarcheEtoileDuGolfe/` and must stay in sync.

## Primary Workflows

### 1) Barcode Printing Regression (PDF shown instead of direct print)

When user says printing is broken, or modal still shows "Telecharger PDF":

1. Confirm backend route exists in `backend/dist/routes/articles.js`.
2. Confirm frontend interception exists in `frontend/dist/index.html`.
3. Ensure request sends bearer token from `shopdesk_token` and targets `/api/articles/print-labels`.
4. Keep fallback endpoint `/articles/print-labels` only as compatibility fallback.
5. Ensure same fix is mirrored to `delivery/SupermarcheEtoileDuGolfe/frontend/dist/index.html`.

### 2) Stale UI / Old behavior persists

If user still sees old labels/text after patch:

1. Assume service worker cache first.
2. Ensure `registerSW.js` unregisters service workers and clears caches.
3. Ensure `sw.js` is self-removing and clears caches on activate.
4. Remove service worker registration script from `index.html` when necessary.
5. Add runtime cleanup in `index.html` to unregister SW and clear caches on load.
6. Verify served content via HTTP request against `http://localhost:8080/` and `http://localhost:8080/sw.js`.

### 3) Launcher hardening

When app opens stale windows/content:

1. In `start-shopdesk.cmd`, force URL cache busting with query string.
2. Launch browser with `--new-window --app=...`.
3. Keep backend startup detached and readiness probe intact.
4. Mirror the same launcher behavior into delivery launcher.

### 4) Delivery package parity

Any production fix under root runtime files should be copied to delivery mirror if equivalent files exist:

- `frontend/dist/index.html`
- `frontend/dist/sw.js`
- `start-shopdesk.cmd`
- any other runtime-critical script changed for launch/print path

## Verification Checklist

After changes, verify in this order:

1. No syntax errors in touched files.
2. Backend serves patched frontend (`Invoke-WebRequest http://localhost:8080/`).
3. Backend serves patched SW (`Invoke-WebRequest http://localhost:8080/sw.js`).
4. Desktop shortcut target still points to project launcher.
5. User-visible test: open barcode modal and confirm direct print flow.

## Commands (Windows PowerShell)

```powershell
# check desktop shortcut target
$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
Get-ChildItem $desktop -Filter *.lnk | ForEach-Object {
  $sc = $shell.CreateShortcut($_.FullName)
  [PSCustomObject]@{ Name=$_.Name; TargetPath=$sc.TargetPath; WorkingDirectory=$sc.WorkingDirectory }
}

# inspect served HTML/SW quickly
(Invoke-WebRequest -UseBasicParsing http://localhost:8080/ -TimeoutSec 8).Content
(Invoke-WebRequest -UseBasicParsing http://localhost:8080/sw.js -TimeoutSec 8).Content
```

## Roadmap Notes Captured

Keep these as pending decisions unless user explicitly asks to implement:

1. Add purchase price and real-time margin/profit tracking in sales flow.
2. Add consumable flag and expiration tracking only for consumables.
3. Add expiry alerts and promotion suggestions to reduce losses.
4. Decide costing model (last purchase, weighted average, FIFO).
5. Decide promotion policy windows (example: J-30, J-15, J-7).

## Guardrails

1. Do not assume source files exist; this repo may run from dist/runtime files.
2. Do not revert unrelated user changes.
3. Apply minimal targeted edits and validate immediately.
4. If behavior differs between localhost and desktop app, validate shortcut target and launcher chain first.
