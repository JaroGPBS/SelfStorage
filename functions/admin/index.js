// Retired legacy admin route. The supported Admin panel is /panel/.
// Return a real 404 instead of Cloudflare Pages' SPA fallback to /.
export function onRequest() {
  return new Response('404 - Strona nie istnieje.', {
    status: 404,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    },
  });
}
