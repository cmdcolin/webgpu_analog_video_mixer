import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Project Pages site is served under /<repo>/; dev + screenshot harness stay at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/webgpu_analog_video_mixer/' : '/',
  plugins: [react()],
}))
