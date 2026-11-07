/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [react()],
  server: {
    // Reachable from a phone on the same Wi-Fi.
    host: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
