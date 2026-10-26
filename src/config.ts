import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const list = (v?: string) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  baseUrl: (process.env.API_BASE_URL ?? '').replace(/\/$/, ''),
  swaggerUser: process.env.SWAGGER_USER ?? '',
  swaggerPassword: process.env.SWAGGER_PASSWORD ?? '',
  dealerGuid: process.env.DEALER_GUID ?? '',
  username: process.env.API_USERNAME ?? '',
  password: process.env.API_PASSWORD ?? '',
  dmsDealerId: Number(process.env.API_DMS_DEALER_ID ?? 0),
  // Dealer under test: location dealerId, its DMS location id (the login id is dmsDealerId above) and a customer to use in created orders.
  dealerId: Number(process.env.DEALER_ID ?? 0),
  locationDmsId: Number(process.env.LOCATION_DMS_ID ?? 0),
  customerId: Number(process.env.TEST_CUSTOMER_ID ?? 0),
  staticToken: process.env.API_TOKEN ?? '',
  // Safe by default: generic tests only run GET unless ALLOW_WRITES=true (or METHODS is set explicitly).
  methods: list(process.env.METHODS).length
    ? list(process.env.METHODS).map((m) => m.toUpperCase())
    : process.env.ALLOW_WRITES === 'true' ? [] : ['GET'],
  exclude: list(process.env.EXCLUDE),
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30000),
  // Revoking tokens can leave the shared test account unable to log in again (seen on dealer 10543), so those tests can be switched off.
  skipRevoke: process.env.SKIP_TOKEN_REVOKE === 'true' || process.env.SINGLE_LOGIN === 'true',
  // SINGLE_LOGIN=true: global setup is the only thing that calls Auth/Login, so the tests that log in again are skipped.
  singleLogin: process.env.SINGLE_LOGIN === 'true',
  passStatuses: [200, 201, 204],
};

export const cacheDir = path.resolve(__dirname, '..', '.cache');
export const specPath = path.join(cacheDir, 'spec.json');
export const tokenPath = path.join(cacheDir, 'token.json');
