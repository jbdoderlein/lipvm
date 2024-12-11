import esbuildPluginTsc from 'esbuild-plugin-tsc';

export function createBuildSettings(options) {
  return {
    entryPoints: ['src/app.ts'],
    outfile: 'www/js/bundle.js',
    bundle: true,
    plugins: [
      esbuildPluginTsc({
        force: true
      }),
    ],
    ...options
  };
}