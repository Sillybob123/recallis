import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Pin the output to versions Safari actually ships, rather than trusting
    // whatever the toolchain's default happens to be. Safari 15.4 is the first
    // release with crypto.randomUUID and structuredClone.
    target: ["es2020", "safari15", "chrome90", "firefox90", "edge90"],
  },
})
