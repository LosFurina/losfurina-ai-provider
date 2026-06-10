const routes = new Map();

export function registerRoute(path, handler) {
  routes.set(path, handler);
}

export function navigate(path) {
  window.location.hash = path;
}

export function getCurrentPath() {
  const h = window.location.hash.slice(1) || '/';
  return h;
}

export function startRouter(container) {
  const render = () => {
    const path = getCurrentPath();
    const handler = routes.get(path) || routes.get('/');
    if (!handler) {
      container.innerHTML = '<div class="page-body">404</div>';
      return;
    }
    container.innerHTML = '';
    handler(container);
  };
  window.addEventListener('hashchange', render);
  render();
}
