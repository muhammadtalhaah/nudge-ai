import { defineConfig } from 'tsup';

/**
 * Bundles the server (and the root-level `shared/` contracts it imports) into a single
 * ESM file. Bundling rather than `tsc --outDir` sidesteps the awkward output paths you get
 * when a project compiles sources from outside its own rootDir, and it means production
 * runs one file with no path-alias resolution at runtime.
 *
 * Third-party dependencies stay external — they are installed on the host.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  splitting: false,
  minify: false,
  dts: false,
});
