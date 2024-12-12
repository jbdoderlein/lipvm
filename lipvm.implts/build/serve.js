import esbuild from 'esbuild';
import { createBuildSettings } from './settings.js';
import http from 'node:http'

const devport = 3000

const settings = createBuildSettings({ 
  sourcemap: true,
  banner: {
    js: `new EventSource('/esbuild').addEventListener('change', () => location.reload());`,
  }
});

const ctx = await esbuild.context(settings);

await ctx.watch();

const { host, port } = await ctx.serve({
  port: 5500,
  servedir: 'www',
  fallback: "www/index.html"



});

// Then start a proxy server on port 3000
http.createServer((req, res) => {
    req.headers["Cross-Origin-Embedder-Policy"]="require-corp";
    req.headers["Cross-Origin-Opener-Policy"] = "same-origin"
  const options = {
    hostname: host,
    port: port,
    path: req.url,
    method: req.method,
        headers: req.headers
  }
  // Forward each incoming request to esbuild
  const proxyReq = http.request(options, proxyRes => {
    // If esbuild returns "not found", send a custom 404 page
    if (proxyRes.statusCode === 404) {
      res.writeHead(404, { 'Content-Type': 'text/html' })
      res.end('<h1>A custom 404 page</h1>')
      return
    }

    // Otherwise, forward the response from esbuild to the client
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res, { end: true })
  })

  // Forward the body of the request to esbuild
  req.pipe(proxyReq, { end: true })
}).listen(devport)
  


console.log(`Serving app at ${host}:${devport}.`);