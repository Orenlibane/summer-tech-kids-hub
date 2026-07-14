import { put, head } from '@vercel/blob';

const PATH = 'stats.json';

/* initial seed used only the very first time (before any real activity) */
const SEED = {
  visits: 3200,
  likes: {
    'mad-bunnies': 52,
    'bananas-avocados': 38,
    'sushi-ninjas': 47,
    'kids-vs-tvs': 33,
    'hoops-vs-cleats': 41,
    'ball-race': 36,
    'nebula-strike': 44,
    'void-raiders': 39
  }
};

async function readStats() {
  try {
    const h = await head(PATH);
    const r = await fetch(h.url + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch (e) { /* not created yet */ }
  return null;
}

async function writeStats(data) {
  await put(PATH, JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 0
  });
}

export default async function handler(req, res) {
  try {
    let stats = await readStats();
    if (!stats) { stats = JSON.parse(JSON.stringify(SEED)); await writeStats(stats); }
    if (!stats.likes) stats.likes = {};

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(stats);
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = {}; } }
      body = body || {};

      if (body.action === 'visit') {
        stats.visits = (stats.visits || 0) + 1;
      } else if (body.action === 'like') {
        const id = String(body.id || '');
        const delta = body.delta === -1 ? -1 : 1;
        if (id) stats.likes[id] = Math.max(0, (stats.likes[id] || 0) + delta);
      }
      await writeStats(stats);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(stats);
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
