import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://sinaur:sinaur_secret@localhost:5432/sinaur_rdc_test',
      DATABASE_POOL_MIN: '1',
      DATABASE_POOL_MAX: '5',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_SECRET: 'test_secret_min_32_characters_long_ok',
      JWT_EXPIRES_IN: '15m',
      JWT_REFRESH_EXPIRES_IN: '7d',
      NODE_ENV: 'test',
      API_PORT: '3099',
      API_HOST: '127.0.0.1',
      LOG_LEVEL: 'error',
      RELIEFWEB_APP_NAME: 'sinaur-rdc-test',
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
})
