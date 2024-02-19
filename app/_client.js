import { createRoot } from 'react-dom/client';
import { createFromFetch } from 'react-server-dom-webpack/client';

// HACK: map webpack resolution to native ESM
// @ts-expect-error Property '__webpack_require__' does not exist on type 'Window & typeof globalThis'.
window.__webpack_require__ = async (id) => {
  return import(id);
};

const rootEl = document.getElementById('root');
const root = createRoot(rootEl);

createFromFetch(fetch('/rsc')).then((result) => {
  root.render(result);
});
