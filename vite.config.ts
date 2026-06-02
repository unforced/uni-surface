import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `base` must match how the app is served.
// - GitHub Pages project site (default): '/my-vault-ui/'
// - Custom domain or user/org page: change to '/'
// https://vite.dev/config/
export default defineConfig({
  base: '/my-vault-ui/',
  plugins: [react()],
})
