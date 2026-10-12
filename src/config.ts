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
  staticToken: process.env.API_TOKEN ?? '',
  // Safe by default: generic tests only run GET unless ALLOW_WRITES=true (or METHODS is set explicitly).
  methods: list(process.env.METHODS).length
    ? list(process.env.METHODS).map((m) => m.toUpperCase())
    : process.env.ALLOW_WRITES === 'true' ? [] : ['GET'],
  exclude: list(process.env.EXCLUDE),
  timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 30000),
  passStatuses: [200, 201, 204],
};

export const cacheDir = path.resolve(__dirname, '..', '.cache');
export const specPath = path.join(cacheDir, 'spec.json');
export const tokenPath = path.join(cacheDir, 'token.json');
