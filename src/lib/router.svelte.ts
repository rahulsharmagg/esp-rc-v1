/**
 * Svelte 5 Native Reactive Router
 * High-performance, lightweight SPA router powered by Svelte 5 Runes ($state, $derived)
 */

export type RouteParams = Record<string, string>;

export class SvelteRouter {
  path = $state(typeof window !== 'undefined' ? window.location.pathname : '/');
  search = $state(typeof window !== 'undefined' ? window.location.search : '');
  hash = $state(typeof window !== 'undefined' ? window.location.hash : '');

  // Normalized path without trailing slash (except root '/')
  normalizedPath = $derived.by(() => {
    const p = this.path;
    if (p.length > 1 && p.endsWith('/')) {
      return p.slice(0, -1);
    }
    return p || '/';
  });

  // Query parameters as a reactive key-value map
  query = $derived.by(() => {
    const params = new URLSearchParams(this.search);
    const result: Record<string, string> = {};
    params.forEach((val, key) => {
      result[key] = val;
    });
    return result;
  });

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', this.handlePopState);
      window.addEventListener('click', this.handleAnchorClick);
    }
  }

  private handlePopState = () => {
    this.updateLocation();
  };

  private updateLocation = () => {
    if (typeof window === 'undefined') return;
    this.path = window.location.pathname;
    this.search = window.location.search;
    this.hash = window.location.hash;
  };

  /**
   * Programmatic navigation
   */
  navigate = (to: string, options: { replace?: boolean; state?: any } = {}) => {
    if (typeof window === 'undefined') return;

    const url = new URL(to, window.location.origin);
    const targetPath = url.pathname;
    const targetSearch = url.search;
    const targetHash = url.hash;

    // Avoid duplicate history entries
    if (
      targetPath === this.path &&
      targetSearch === this.search &&
      targetHash === this.hash
    ) {
      return;
    }

    if (options.replace) {
      window.history.replaceState(options.state ?? {}, '', to);
    } else {
      window.history.pushState(options.state ?? {}, '', to);
    }

    this.updateLocation();
  };

  /**
   * Go back in browser history
   */
  back = () => {
    if (typeof window !== 'undefined') {
      window.history.back();
    }
  };

  /**
   * Go forward in browser history
   */
  forward = () => {
    if (typeof window !== 'undefined') {
      window.history.forward();
    }
  };

  /**
   * Check if current route matches a pattern or list of patterns
   */
  matches = (patterns: string | string[]): boolean => {
    const current = this.normalizedPath;
    const list = Array.isArray(patterns) ? patterns : [patterns];

    return list.some((pattern) => {
      const norm = pattern.length > 1 && pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
      if (norm === '*' || norm === current) return true;
      if (norm.endsWith('/*')) {
        const prefix = norm.slice(0, -2);
        return current === prefix || current.startsWith(prefix + '/');
      }
      return false;
    });
  };

  /**
   * Intercept click events on standard <a> anchors for seamless SPA navigation
   */
  private handleAnchorClick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) {
      return;
    }

    const anchor = (e.target as HTMLElement)?.closest('a');
    if (!anchor || !anchor.href) return;

    // Ignore anchors with explicit download or target attributes
    if (anchor.hasAttribute('download') || anchor.target === '_blank') return;
    if (anchor.getAttribute('rel')?.includes('external')) return;

    // Check if link is same origin
    const url = new URL(anchor.href, window.location.origin);
    if (url.origin !== window.location.origin) return;

    // Prevent full page reload and navigate using Svelte router
    e.preventDefault();
    this.navigate(url.pathname + url.search + url.hash);
  };

  destroy = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.handlePopState);
      window.removeEventListener('click', this.handleAnchorClick);
    }
  };
}

export const router = new SvelteRouter();
