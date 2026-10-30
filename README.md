# TargetDMS API test suite

Playwright + TypeScript tests for the TargetDMS API. The tests call the API over HTTP and judge **correct behavior**: when the API answers wrongly, the test fails, and a test for a known problem is labelled `[known defect]`.

Request chain under test: this suite -> TargetDMS API (.NET) -> Everest API -> IDEAL reverse proxy. The TargetDMS API forwards most calls to Everest with the caller's token. Its own validation errors are 400; failures from Everest or other external services come back as 502.

## Where the code lives

This project is kept in two git repositories. Both hold the same `main` branch.

| Repository | Address | Git remote name |
|---|---|---|
| Azure DevOps (the team's test repo) | `https://dev.azure.com/ConstellationDealer/Ideal%20Agile/_git/TargetService.TestAutomation` (project `Ideal Agile`, repo `TargetService.TestAutomation`) | `ado` |
| GitHub | `https://github.com/IffahMuz/TargetDMS-ApiTesting` | `origin` |

To publish a change, commit it and push `main` to both:

```
git push ado main
git push origin main
```

Pull the remote README first if the push is refused (`git fetch ado`, then merge). Never commit `.env`: it holds the logins and the Azure DevOps token.

The defects created from the dashboard go to the Azure DevOps board of project `TargetDMS` (see "Reading the results"), which is a different project from the code repo above.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (`.env` is git-ignored, never commit it). It needs the API base URL, the Swagger basic-auth user, the dealer GUID, the dealer id, the DMS location id, a test customer id and the app login.
3. Dealer data (a stocked part, a warrantor, a wholegood unit, ...) lives in `testdata/dealers/<dealerId>.json`. A new dealer needs its own file there.

Nothing dealer-specific is hard-coded. The locations of the company are read from `Dealer/Locations` at run time; set `SECOND_LOCATION_DEALER_ID` to choose which other location the multi-location tests compare with.

## Running the tests

Start the live runner (the app does this for you when you ask it to run):

```
npm run dashboard
```

Open **http://localhost:9000/runner** and click a module. The live dashboard opens in a new tab for that module:

- The module's tests are listed straight away as "waiting". Nothing is sent to the API yet, and no earlier run is shown.
- **Run** starts the module. The page updates as each test finishes: counts, the test being run, and the requests and responses of every test.
- **Stop** stops the run. Tests that never ran are shown as skipped.
- **Reset** clears the page back to the waiting list and the Run button.
- Saved runs are listed as `Module - date - time - day` and can be reopened from the "Saved runs" list. The header shows when the run started, when it ended and how long it took.
- Modules that check orders out ask for confirmation when you click Run.

Every failed or known-defect row starts with a **What went wrong** box that explains the reason in plain words (for example "the connection to the test server was cut, that is a network problem and not a fault in the API"). The technical error stays below it.

Plain `npm test` also works while the dashboard is running, and the results stream into it. Do not pass `--reporter`: that bypasses the dashboard.

### Logging in

The suite logs in **once per run**. If the saved token is still valid (more than 10 minutes left), the runner reuses it and makes no login call at all. The login tests are the only ones that log in again, and they are skipped unless `SINGLE_LOGIN=false` (the "Login and tokens" module sets it). Never run with a wrong password: it can lock the account.

### Switches (environment variables)

| Variable | Effect |
|---|---|
| `RUN_CHECKOUT=true` | Runs the tests that really check orders out. This finalizes orders, uses stock and leaves payments behind. Off by default. |
| `ALLOW_WRITES=true` / `METHODS=GET,POST` | The generic Swagger-driven tests only send GET unless this is set. |
| `SINGLE_LOGIN=true` | Only global setup calls `Auth/Login`; the tests that log in again are skipped. |
| `SKIP_TOKEN_REVOKE=true` | Skips the revoke test (a revoked token keeps working, which is a known defect). |
| `REUSE_TOKEN=true` | Set by the runner when it passes a valid `API_TOKEN`: global setup makes no login call. |
| `LIST_ONLY=true` | Set by the runner when it only lists a module's tests: the report files and the dashboard reporter are switched off, so listing changes nothing. |
| `DASHBOARD_PORT` | Port of the dashboard (default 9000). |
| `WORK_DIR` | Where the token cache, saved runs and Playwright output go (default: the system temp folder, outside OneDrive). |

### Rate limits

The API allows 100 requests per 3 minutes per user and 150 per IP. The suite throttles itself to 80 per 3 minutes (`src/fixtures.ts`), so a long run may pause. Login and a few user endpoints allow only 5 calls per 3 minutes per path, so avoid repeated login runs.

## What is covered

| Module | Files |
|---|---|
| Read-only endpoint checks | `tests/get`, `tests/api.spec.ts` (every GET in the Swagger file) |
| Login and tokens | `tests/flows/auth.flow.spec.ts` |
| Customers | `tests/flows/customer.flow.spec.ts`, `tests/post/customer.post.spec.ts` |
| Work orders and sales orders | `tests/flows/order*.ts`, `work-order.flow.spec.ts` (lines, tags, wholegoods) |
| Inspections | `inspection*.ts` (templates, inspections on work orders, per-location rules, negatives) |
| Locations | `location.flow.spec.ts`, `location-negative.spec.ts` |
| Payment deposits (cash, $10) | `payment-deposit*.spec.ts` (split deposits, negatives, checkout with deposits and overpay) |
| Warranty | `tests/flows/warranty*` |
| Inventory, purchase orders, time clock, receipts, notifications, dealer, user | `tests/flows`, `tests/post` |
| Known server defects | `tests/defects/server-defects.spec.ts` |

The module list of the runner is `scripts/modules.js` (each module names its test files, an optional title filter and any switches it needs). Add new test files there so they appear on the runner page. The runner starts Playwright itself without a shell, so a title filter such as `Deposit|PAY-DEF` is passed on unchanged.

Not covered yet: card payments (they need the card gateway), the three warranty checkout groups unless `RUN_CHECKOUT=true`, and the inventory count flow.

## Reading the results

- **Green** passed. **Purple** known server defect (the test asserts the correct behavior and still fails). **Red** unexpected failure. **Amber** skipped (the reason is shown on the row).
- Known defects and failures can be sent to Azure DevOps: the **Create a defect on ADO** button on a row opens a page that shows the bug exactly as it will be created (title `[Automated API Defect] ...`, steps to reproduce, payloads, environment) and only creates it when you click. A **Delete** button removes the work item again (it goes to the Recycle Bin). Set `ADO_ORG_URL`, `ADO_PROJECT`, `ADO_AREA_PATH` and `ADO_PAT` in `.env`.
- Reports are written to `reports/` (`api-report.html|json|csv`). `npm run report:detail` builds the detailed report.

## Writing tests

- A test judges correct behavior. If the API is wrong, add the test to `tests/defects/` with `[known defect]` in the title instead of changing the expectation.
- Orders that have a payment cannot be deleted through the API, so payment tests reuse two standing orders (ids kept in the work folder) instead of creating new ones every run.
- Connection drops (`ECONNRESET`, timeouts) happen against the test environment. Use `transient()` from `src/payment-helpers.ts` only for reads and for requests that must be refused. Never use it for a request that records money.
- Shared setup lives in `src/*-helpers.ts`. Keep specs short and put repeated steps in a helper.

## Source repos (read only)

The TargetDMS front end (`TargetDMS.Web`) and backend (`TargetDMS.Backend`) are in Azure DevOps, project `Ideal Agile`. They are read for request bodies and validation rules only. Never copy them into this repo.
