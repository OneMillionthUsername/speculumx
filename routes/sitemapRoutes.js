import express from 'express';
import logger from '../utils/logger.js';
import { DatabaseService } from '../databases/mariaDB.js';
import { isAppReady } from '../app.js';

/**
 * Routes for generating sitemap and robots.txt.
 *
 * - `GET /sitemap.xml` produces an XML sitemap including static pages,
 *   blog posts where available.
 * - `GET /robots.txt` returns a permissive robots file pointing to the sitemap.
 */
const sitemapRouter = express.Router();

// XML Sitemap generieren
sitemapRouter.get('/sitemap.xml', async (req, res) => {
  try {
    if (!isAppReady()) {
      return res.status(503).type('text/plain').send('Service temporarily unavailable');
    }

    logger.debug('Generating sitemap.xml');
    
    // Base URL aus Request ableiten
    const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    const baseUrl = `${protocol}://${req.get('host')}`;
    
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml"
        xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">

`;

    // Statische Seiten
    const staticPages = [
      { url: '/', priority: '1.0', changefreq: 'daily' },
      { url: '/about', priority: '0.8', changefreq: 'monthly' },
      { url: '/blogpost', priority: '0.9', changefreq: 'daily' },
      { url: '/archiv', priority: '0.7', changefreq: 'weekly' },
    ];

    const now = new Date().toISOString();

    // Statische Seiten hinzufügen
    staticPages.forEach(page => {
      sitemap += `  <url>
    <loc>${baseUrl}${page.url}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${page.changefreq}</changefreq>
    <priority>${page.priority}</priority>
  </url>
`;
    });

    try {
      // Blog Posts hinzufügen
      logger.debug('Fetching blog posts for sitemap');
      const allPosts = await DatabaseService.getAllPosts();
      const posts = Array.isArray(allPosts) ? allPosts.filter(p => p.published) : [];

      if (posts && posts.length > 0) {
        logger.debug(`Adding ${posts.length} blog posts to sitemap`);

        posts.forEach(post => {
          const postDate = post.created_at ? new Date(post.created_at).toISOString() : now;
          // XML-sicher: encodeURIComponent entfernt &<>" aus dem Pfadsegment
          const postPath = encodeURIComponent(String(post.slug || post.id));
          sitemap += `  <url>
    <loc>${baseUrl}/blogpost/${postPath}</loc>
    <lastmod>${postDate}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;
        });
      }
    } catch (dbError) {
      logger.warn('Could not fetch posts for sitemap:', dbError.message);
      // Weiter ohne Posts
    }

    sitemap += '</urlset>';

    logger.debug('Sitemap generated successfully');
    
    // Korrekte Headers setzen
    res.set({
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600', // 1 Stunde Cache
      'X-Robots-Tag': 'noindex', // Sitemap selbst nicht indexieren
    });
    
    res.send(sitemap);
    
  } catch (error) {
    logger.error('Error generating sitemap:', error);
    res.status(500).type('text/plain').send('Error generating sitemap');
  }
});

// Robots.txt Route (falls nicht bereits vorhanden)
sitemapRouter.get('/robots.txt', (req, res) => {
  const protocol = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const baseUrl = `${protocol}://${req.get('host')}`;
  
  const robotsTxt = `# robots.txt für SpeculumX Blog
# Erlaubt allen Suchmaschinen, die gesamte Website zu crawlen

User-agent: *
Allow: /

# Sitemap
Sitemap: ${baseUrl}/sitemap.xml

# Crawl-Delay (verhindert zu aggressive Bots)
Crawl-delay: 1

# Disallow admin areas (falls vorhanden)
Disallow: /admin/
Disallow: /api/
Disallow: /blogpost/admin/
Disallow: /*.json$
`;

  res.set({
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'public, max-age=86400', // 24 Stunden Cache
  });
  
  res.send(robotsTxt);
});

export default sitemapRouter;
