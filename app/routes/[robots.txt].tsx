// A signage wall should never be indexed.
export function loader() {
  return new Response(`User-agent: *\nDisallow: /\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': `max-age=${60 * 60 * 24}`,
    },
  });
}
