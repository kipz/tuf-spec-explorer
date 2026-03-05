import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/tuf-spec-explorer/',
  plugins: [react()],
})
