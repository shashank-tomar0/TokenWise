import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'mcp-server/index': 'src/mcp-server/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
  sourcemap: true,
});