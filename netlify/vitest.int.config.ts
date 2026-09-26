import { defineConfig } from 'vitest/config';

// Integration tests share one emulator, so files must not run in parallel.
export default defineConfig({
  test: {
    include: ['test/int/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
