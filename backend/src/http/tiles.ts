/**
 * Map tiles for the coordinates login's map (frontend MapPicker), proxied
 * from OpenStreetMap. Going through the server gives OSM the identifying
 * User-Agent its tile policy asks for (the desktop app sends no Referer),
 * and keeps recently used tiles in memory.
 */

import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

const UPSTREAM = 'https://tile.openstreetmap.org';
const MAX_ZOOM = 18;
const CACHE_TILES = 2000;

export function registerTiles(app: FastifyInstance, config: Config) {
  /** Insertion-ordered, so the first key is the least recently used. */
  const cache = new Map<string, Buffer>();
  const userAgent = `DEADBORD/0.1 (+${config.publicUrl})`;

  app.get<{ Params: { z: string; x: string; y: string } }>('/tiles/:z/:x/:y.png', async (req, reply) => {
    const [z, x, y] = [req.params.z, req.params.x, req.params.y].map(Number);
    const n = 2 ** z;
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > MAX_ZOOM || x < 0 || x >= n || y < 0 || y >= n) {
      return reply.code(404).send({ error: 'No such tile' });
    }
    const key = `${z}/${x}/${y}`;
    let tile = cache.get(key);
    if (tile) {
      cache.delete(key);
    } else {
      const res = await fetch(`${UPSTREAM}/${key}.png`, { headers: { 'User-Agent': userAgent } });
      if (!res.ok) return reply.code(502).send({ error: `Tile server replied ${res.status}` });
      tile = Buffer.from(await res.arrayBuffer());
      if (cache.size >= CACHE_TILES) cache.delete(cache.keys().next().value!);
    }
    cache.set(key, tile);
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=604800').send(tile);
  });
}
