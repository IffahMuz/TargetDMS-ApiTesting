# Memory export

Source: stored memory files only (6 entries). Dates are the date each memory was written or last updated, or the date stated inside it.

## 1. Instructions

[2026-10-16] - TargetDMS source repos (TargetDMS.Web, TargetDMS.Backend) are "for reading/context only and must never be pushed to the current test repo". Never copy their files into the test project.
[2026-10-16] - Credentials live only in the git-ignored `.env`; never commit or echo them.
[2026-10-16] - Never add the nested `CRM Project/` repo to the test repo.
[2026-10-16] - User wants `README.md` kept local, not pushed. (Older note; the README was later committed, so this may be superseded.)
[2026-10-16] - Work one explicit call at a time, user supplies request bodies; never run write endpoints unless the user approves; default to GET-only.
[2026-10-19] - Real checkouts on throwaway work orders on the test dealer are approved; leaving closed orders behind is fine.
[2026-10-20] - Do not test User/RegisterEmail ("user said no").
[2026-10-20] - Do not do a real PurchaseOrder/Receive (permanent stock change, no undo); use only fake item id 999999999.
[2026-10-20] - Never send valid-shaped bodies to Notification send endpoints, SendPayByLinkEmail, or Transaction endpoints (they send real mail or create real tokens and pay links).
[2026-10-26] - Never retry login while it fails; wait for the user to say the account is unlocked, then make one attempt only.
[2026-10-27] - When asked to run the suite, start the live dashboard yourself first, then run the suite into it; do not make the user start either one. Do not use a dummy-token run to demo the dashboard (it overwrites `run-data.json` and the reports).
[2026-10-29] - Never create ADO bugs yourself from tests; the dashboard preview page plus the user's own Create click is the approval.
[2026-10-29] - Never pass `--reporter=...` when running the suite; restart the dashboard after changing `scripts/*.js`.
[2026-10-30] - When the user says "run", make sure the server is up and open `http://localhost:9000/runner` in the browser pane so they can pick a module; add new test files to `scripts/modules.js`.
[2026-10-30] - Payment tests: cash only, $10 amounts, leave the card payment out; put checkout with deposits and overpay behind `RUN_CHECKOUT=true`.

## 2. Identity

[unknown] - Name: Iffah Muzaffar (seen in Azure DevOps); work email iffah.muzaffar@constellationdealer.com.

## 3. Career

[unknown] - Works with Constellation Dealer (org `constellationdealer` in Azure DevOps), doing QA / API test automation for the TargetDMS product.

## 4. Projects

[2026-10-16] - TargetDMS API test suite: Playwright + TypeScript suite in `D:\OneDrive - PERSEUS MANAGEMENT GROUP INC\Desktop\api`, pushed to GitHub `IffahMuz/TargetDMS-ApiTesting` (main). Covers generic Swagger GETs, explicit GET/POST calls, chained flows, and known-defect tests. Rate limit 100 requests per 3 minutes per user, so runs are paced. Last full run on 2026-10-22: 358 tests, 301 pass, 38 fail (all known defects), 19 skipped. Many API quirks and open server defects are recorded in the memory file.
[2026-10-16] - TargetDMS source repos: Azure DevOps project `Ideal Agile`; front end `TargetDMS.Web` (React/Vite), backend `TargetDMS.Backend` (.NET 10). Read with the ADO tools to find request bodies and validation rules; read-only.
[2026-10-26] - Dealer 10543 setup: second test dealer (login 99203001 / Admin, location DMS id 199203001, test customer 107239). Dealer values come from `.env` and `testdata/dealers/<dealerId>.json`. The Admin login was locked out after repeated attempts on 2026-10-26.
[2026-10-27] - Live dashboard on run: local dashboard at localhost:9000 shows live counts, pass/fail and request and response payloads. On 2026-10-30 it became "Integration Tests Live Runner" with a module picker at `/runner`, backed by `scripts/modules.js`.
[2026-10-29] - Dashboard ADO bug buttons: each known-defect or failed row has a "Create a defect on ADO" button that opens `/bug?id=...` showing the exact bug, and creates it only on the user's click. Settings are in `.env` (`ADO_ORG_URL`, `ADO_PROJECT=TargetDMS`, `ADO_AREA_PATH`, `ADO_PAT`).
[2026-10-30] - Payment deposit tests: cash-only $10 deposit flows, negative cases and PAY-DEF known defects. Two standing orders (one work order, one sales order) are reused because orders with payments cannot be deleted. Checkout with deposits and overpay is still to do behind `RUN_CHECKOUT=true`.

## 5. Preferences

[2026-10-27] - Wants to watch test runs live (current scenario, counts, pass/fail, request and response payloads per test).
[2026-10-29] - Wanted one "Create a defect on ADO" button per row, with no bulk button and no modal.
[2026-10-30] - Prefers $10 test amounts over $1 for payments.
