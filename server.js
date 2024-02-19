import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { build as esbuild } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
// import { renderToString } from 'react-dom/server';
import * as ReactServerDom from 'react-server-dom-webpack/server.browser';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'es-module-lexer';
import { relative } from 'node:path';

const app = new Hono();
const clientComponentMap = {};

app.get('/', (c) => {
  return c.html(
    `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React RSC</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/build/_client.js"></script>
</body>
</html>
    `,
  );
});

app.get('/rsc', async (c) => {
  const Page = await import('./build/page.js');
  // const html = renderToString(createElement(Page.default));
  const stream = ReactServerDom.renderToReadableStream(
    createElement(Page.default),
    clientComponentMap
  );
  return new Response(stream);
});

app.use('/build/*', serveStatic());

serve(app, async (info) => {
  build();
  console.log(`Listening ${info.port}`);
});

const reactComponentRegex = /\.jsx$/;

async function build() {
  const clientEntryPoints = new Set();

  await esbuild({
    bundle: true,
    format: 'esm',
    logLevel: 'error',
    entryPoints: [resolveApp('page.jsx')],
    outdir: resolveBuild(),
    // avoid bundling npm packages for server-side components
    packages: 'external',
    plugins: [
      {
        name: 'resolve-client-imports',
        setup(build) {
          // Intercept component imports to check for 'use client'
          build.onResolve(
            { filter: reactComponentRegex },
            async ({ path: relativePath }) => {
              const path = resolveApp(relativePath);
              const contents = await readFile(path, 'utf-8');
              
              if (contents.startsWith("'use client'")) {
                console.log(path, '<<<');
                clientEntryPoints.add(path);
                return {
                  // Avoid bundling client components into the server build.
                  external: true,
                  // Resolve the client import to the built `.js` file
                  // created by the client `esbuild` process below.
                  path: relativePath.replace(reactComponentRegex, '.js'),
                };
              }
            },
          );
        },
      },
    ],
  });

  const { outputFiles } = await esbuild({
    bundle: true,
    format: 'esm',
    logLevel: 'error',
    entryPoints: [resolveApp('_client.js'), ...clientEntryPoints],
    outdir: resolveBuild(),
    splitting: true,
    plugins: [],
    write: false,
  });

  outputFiles.forEach(async (file) => {
    // Parse file export names
    const [, exports] = parse(file.text);
    let newContents = file.text;

    for (const exp of exports) {
      // Create a unique lookup key for each exported component.
      // Could be any identifier!
      // We'll choose the file path + export name for simplicity.
      const key = file.path + exp.n;

      clientComponentMap[key] = {
        // Have the browser import your component from your server
        // at `/build/[component].js`
        id: `/build/${relative(resolveBuild(), file.path)}`,
        // Use the detected export name
        name: exp.n,
        // Turn off chunks. This is webpack-specific
        chunks: [],
        // Use an async import for the built resource in the browser
        async: true,
      };

      // Tag each component export with a special `react.client.reference` type
      // and the map key to look up import information.
      // This tells your stream renderer to avoid rendering the
      // client component server-side. Instead, import the built component
      // client-side at `clientComponentMap[key].id`
      newContents += `
${exp.ln}.$$id = ${JSON.stringify(key)};
${exp.ln}.$$typeof = Symbol.for("react.client.reference");
			`;
    }
    await writeFile(file.path, newContents);
  });
}

const appDir = new URL('./app/', import.meta.url);
const buildDir = new URL('./build/', import.meta.url);

function resolveApp(path = '') {
  return fileURLToPath(new URL(path, appDir));
}

function resolveBuild(path = '') {
  return fileURLToPath(new URL(path, buildDir));
}
