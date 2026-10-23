import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    // Todas las pruebas comparten una base de datos real: se ejecutan una a la vez.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgres://parcero:parcero_dev_only@127.0.0.1:15432/parcero_test',
      JWT_SECRET: 'test-secret-test-secret-test-secret-123456',
    },
  },
})
