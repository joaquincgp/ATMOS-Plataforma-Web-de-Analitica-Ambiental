import path from 'path';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: '../../reports/frontend-junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'cobertura'],
      reportsDirectory: '../../reports/frontend-coverage',
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/types/**',
      ],
      thresholds: {
        branches: 50,
        functions: 70,
        lines: 70,
        statements: 70,
      },
    },
  },
});
