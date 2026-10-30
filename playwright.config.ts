import { defineConfig } from '@playwright/test';

const baseURL = process.env.API_BASE_URL;

if (!baseURL) {
  throw new Error(
    'API_BASE_URL is not set. Run `npm run test:api` to auto-discover the ' +
      'LocalStack API, or set API_BASE_URL explicitly.'
  );
}

export default defineConfig({
  testDir: './test/api',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    // The trailing slash is required to keep the LocalStack API path prefix.
    baseURL: baseURL.endsWith('/') ? baseURL : `${baseURL}/`,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  },
});
