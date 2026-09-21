//This folder contains database connection logic.

/** 
- Database Connection: Encapsulates the logic for establishing database connections.
- Reusability: This file can be imported in different parts of the app to interact with the database.
- Environment Setup: Makes it easy to configure different databases for different environments (development, production).
*/

import * as mariadb from 'mariadb';
import { convertBigInts, parseTags, createSlug } from '../utils/utils.js';
//import queryBuilder from '../utils/queryBuilder.js';
import { dbConfig } from '../config/dbConfig.js';
import logger from '../utils/logger.js';
import { databaseError } from '../models/customExceptions.js';
import { normalizePublished } from '../utils/normalizers.js';

/**
 * Connection pool used for MariaDB queries. Can be a real mariadb pool or a mock pool.
 * @type {import('mariadb').Pool|undefined}
 */
let pool;

/**
 * Flag indicating whether the module is running in mock mode (no real DB).
 * @type {boolean}
 */
let isMockMode = false;

function createMockPool() {
  logger.info('Using mock database pool for testing');
  return {
    getConnection: async () => {
      return {
        query: async (Sql, params = []) => {
          logger.debug(`[MOCK DB] SQL: ${Sql}, Params: ${JSON.stringify(params)}`);
          if(Sql.toLowerCase().includes('select version()')) {
            return [{ version: '10.5.9-MariaDB-1:10.5.9+maria~focal' }];
          }
          else if (Sql.toLowerCase().includes('select') && Sql.toLowerCase().includes('posts')) {
            return [
              {
                id: 1,
                slug: 'sample-post-1',
                title: 'Sample Blog Post 1',
                content: '<p>This is a sample blog post content.</p>',
                tags: '["sample","blog"]',
                author: 'author',
                views: 10,
                published: 1,
                // Older post
                created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7), // 7 days ago
                updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
              },
              {
                id: 2,
                slug: 'sample-post-2',
                title: 'Sample Blog Post 2',
                content: '<p>This is another sample blog post.</p>',
                tags: '["sample","test"]',
                author: 'author',
                views: 5,
                published: 1,
                // Newer post
                created_at: new Date(),
                updated_at: new Date(),
              },
            ];
          }
          else if (Sql.toLowerCase().includes('insert')) {
            return { insertId: 1, affectedRows: 1 };
          }
          else if (Sql.toLowerCase().includes('update') || Sql.toLowerCase().includes('delete')) {
            return { affectedRows: 1 };
          } else if (Sql.toLowerCase().includes('create table')) {
            return { warningStatus: 0 };
          }
          return [];
        },
        release: () => {
          logger.debug('[MOCK DB] Connection released');
        },
        end: () => Promise.resolve(),
      };
    },
    end: async () => {
      if (isMockMode) {
        logger.warn('Mock database pool does not need to be closed');
      }
      return Promise.resolve();
    },
  };
}
// Prüfen ob Mock-Modus aktiv ist
/**
 * Gibt zurück, ob die Datenbank im Mock-Modus läuft.
 * Im Mock-Modus werden keine echten DB-Verbindungen verwendet,
 * sondern ein In-Memory-Stub für Entwicklung/Tests.
 * @returns {boolean}
 */
export function isMockDatabase() {
  return isMockMode;
}

export async function initializeDatabase() {
  logger.info('initializeDatabase: Starting database initialization');
  
  // if (process.env.NODE_ENV === 'development') {
  //   logger.warn('Keine lokale Datenbank konfiguriert. Überspringe Datenbank-Initialisierung.');
  //   logger.debug('initializeDatabase: Using mock mode for development');
  //   pool = createMockPool();
  //   isMockMode = true;
  //   return;
  // }
  
  // Prüfe ob alle notwendigen DB-Umgebungsvariablen gesetzt sind
  logger.info('initializeDatabase: Checking environment variables');
  if (!dbConfig.user || !dbConfig.password || !dbConfig.database) {
    logger.warn('Database environment variables not fully configured. Using mock mode.');
    logger.warn('Missing variables:', {
      DB_USER: !dbConfig.user ? 'MISSING' : 'OK',
      DB_PASSWORD: !dbConfig.password ? 'MISSING' : 'OK', 
      DB_NAME: !dbConfig.database ? 'MISSING' : 'OK',
    });
    logger.debug('initializeDatabase: Switching to mock mode due to missing env vars');
    pool = createMockPool();
    isMockMode = true;
    return;
  }
  
  try {
    logger.info('initializeDatabase: Creating MariaDB connection pool', {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      database: dbConfig.database,
      connectionLimit: dbConfig.connectionLimit,
    });
    
    pool = mariadb.createPool(dbConfig);

    logger.info('initializeDatabase: Testing initial connection');
    const connection = await pool.getConnection();
    connection.release();

    logger.info('initializeDatabase: Database pool created successfully');
  } catch (error) {
    logger.error(`initializeDatabase: Database connection failed: ${error.message}`, { stack: error.stack });
    logger.warn('Falling back to mock mode due to database connection failure');
    pool = createMockPool();
    isMockMode = true;
    // Nicht mehr werfen - auf Mock-Modus fallen lassen
    return;
  }
}

/**
 * Returns the current MariaDB pool instance.
 * @returns {{ pool: typeof mariadb.Pool }} The database pool object.
 * @throws {databaseError} If the pool is not initialized.
 */
export function getDatabasePool() {
  if (!pool) {
    logger.error('No pool or database has been initialized. Call initializeDatabase() first.');
    throw new databaseError('Database has not been initialized. Call initializeDatabase() first.');
  }
  return pool;
}
// Datenbankverbindung testen
/**
 * Tests the connection to the MariaDB database (or mock database in development mode).
 * Logs the database version if successful, or logs an error if the connection fails.
 * @returns {Promise<boolean>} Returns true if the connection is successful, otherwise throws an error.
 * @throws {databaseError} If the connection fails.
 */
export async function testConnection() {
  let conn;
  try {
    conn = await getDatabasePool().getConnection();
    const result = await conn.query('SELECT VERSION() as version');
    if (isMockMode) {
      logger.info('Mock MariaDB connection successful, Version: ' + result[0].version);
    } else {
      logger.info('MariaDB connection successful, Version: ' + result[0].version);
    }
    return true;
  } catch (error) {
    if (isMockMode) {
      logger.error(`Mock MariaDB connection failed: ${error.message}`);
    } else {
      logger.error(`MariaDB connection failed: ${error.message}`);
    }
    throw new databaseError(`${isMockMode ? 'Mock MariaDB' : 'MariaDB'} connection failed: ${error.message}`, error);
  } finally {
    if (conn) conn.release();
  }
}
/**
 * Erstellt die erforderlichen Datenbank-Schemata (Tabellen, Indizes) falls sie nicht existieren.
 * In Mock-Mode wird die Schema-Erstellung übersprungen.
 * @returns {Promise<boolean>} True wenn Schema erstellt/validiert wurde.
 * @throws {databaseError} Bei kritischen Fehlern während der Schema-Erstellung.
 */
export async function initializeDatabaseSchema() {
  let conn;
  try {
    if(isMockMode) {
      logger.info('Mock mode - skipping actual database schema initialization.');
      return true; 
    }
    conn = await getDatabasePool().getConnection();
    logger.info('Initializing MariaDB schema...');
    // Posts-Tabelle
    await conn.query(`
        CREATE TABLE IF NOT EXISTS posts (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            content LONGTEXT NOT NULL,
            slug VARCHAR(50) NOT NULL UNIQUE,
            tags JSON DEFAULT NULL,
            author VARCHAR(100) DEFAULT 'author',
            views BIGINT DEFAULT 0,
            published BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            INDEX idx_posts_created_at (created_at DESC),
            INDEX idx_posts_views (views DESC),
            INDEX idx_posts_author (author),
            INDEX idx_posts_published (published)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Comments-Tabelle
    await conn.query(`
        CREATE TABLE IF NOT EXISTS comments (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            postId BIGINT NOT NULL,
            username VARCHAR(100) NOT NULL DEFAULT 'Anonym',
            text VARCHAR(1000) NOT NULL,
            ip_address VARCHAR(45) DEFAULT NULL,
            approved BOOLEAN DEFAULT 1,
            published BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

            INDEX idx_comments_postId (postId),
            INDEX idx_comments_created_at (created_at DESC),
            INDEX idx_comments_approved (approved),

            FOREIGN KEY (postId) REFERENCES posts(id)
                ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Uploads/Media-Tabelle
    await conn.query(`
        CREATE TABLE IF NOT EXISTS media (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            postId BIGINT NULL,
            original_name VARCHAR(255) NOT NULL,
            file_size BIGINT DEFAULT NULL,
            mime_type VARCHAR(100) DEFAULT NULL,
            uploaded_by VARCHAR(100) DEFAULT NULL,
            upload_path VARCHAR(500) DEFAULT NULL,
            alt_text VARCHAR(255) DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            INDEX idx_media_uploaded_by (uploaded_by),
            INDEX idx_media_created_at (created_at DESC),
            INDEX idx_media_mime_type (mime_type),
            INDEX idx_media_original_name(original_name),

            FOREIGN KEY (postId) REFERENCES posts(id)
                ON DELETE SET NULL ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Cards-Tabelle
    await conn.query(`
        CREATE TABLE IF NOT EXISTS cards (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            subtitle VARCHAR(500) DEFAULT NULL,
            link VARCHAR(1000) NOT NULL,
            img_link VARCHAR(1000) NOT NULL,
            published BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            INDEX idx_cards_created_at (created_at DESC),
            INDEX idx_cards_published (published)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Analytics/Views-Tabelle
    // await conn.query(`
    //     CREATE TABLE IF NOT EXISTS post_analytics (
    //         id BIGINT AUTO_INCREMENT PRIMARY KEY,
    //         postId BIGINT NOT NULL,
    //         event_type ENUM('view', 'comment', 'share', 'download') DEFAULT 'view',
    //         ip_address VARCHAR(45) DEFAULT NULL,
    //         user_agent TEXT DEFAULT NULL,
    //         referer VARCHAR(500) DEFAULT NULL,
    //         country VARCHAR(50) DEFAULT NULL,
    //         city VARCHAR(100) DEFAULT NULL,
    //         created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    //         INDEX idx_analytics_postId (postId),
    //         INDEX idx_analytics_event_type (event_type),
    //         INDEX idx_analytics_created_at (created_at DESC),
    //         INDEX idx_analytics_ip (ip_address),

    //         FOREIGN KEY (postId) REFERENCES posts(id)
    //             ON DELETE CASCADE ON UPDATE CASCADE
    //     ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    // `);

    // Admin-Benutzer Tabelle (für zukünftige Multi-Admin-Unterstützung)
    await conn.query(`
        CREATE TABLE IF NOT EXISTS admins (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email VARCHAR(255) DEFAULT NULL,
            full_name VARCHAR(255) DEFAULT NULL,
            role ENUM('admin', 'editor', 'viewer') DEFAULT 'admin',
            active BOOLEAN DEFAULT 1,
            last_login DATETIME DEFAULT NULL,
            login_attempts INT DEFAULT 0,
            locked_until DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            INDEX idx_admins_username (username),
            INDEX idx_admins_active (active),
            INDEX idx_admins_role (role),
            INDEX idx_admins_last_login (last_login)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Backup-Tabelle für gelöschte Posts (Wiederherstellung)
    await conn.query(`
        CREATE TABLE IF NOT EXISTS deleted_posts (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            original_id BIGINT NOT NULL,
            title VARCHAR(500) NOT NULL,
            content LONGTEXT NOT NULL,
            tags JSON DEFAULT NULL,
            author VARCHAR(100) DEFAULT NULL,
            views BIGINT DEFAULT 0,
            original_created_at DATETIME NOT NULL,
            deleted_by VARCHAR(100) NOT NULL,
            deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reason TEXT DEFAULT NULL,

            INDEX idx_deleted_posts_original_id (original_id),
            INDEX idx_deleted_posts_deleted_at (deleted_at DESC),
            INDEX idx_deleted_posts_author (author),
            INDEX idx_deleted_posts_deleted_by (deleted_by)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Karten-Tabelle
    // Hinweis: Die Cards-Tabelle wird weiter oben bereits mit created_at, Indizes
    // und published DEFAULT 1 erstellt. Der folgende doppelte Block wurde entfernt,
    // um Konflikte zwischen unterschiedlichen Defaults (0 vs 1) zu vermeiden.

    console.log('MariaDB schema created/verified successfully');
    logger.info('MariaDB schema created/verified successfully');
    return true;
  } catch (error) {
    if(isMockMode) {
      logger.log('Mock-Schema erstellt');
      return true;
    }
    logger.error(`Error creating MariaDB schema: ${error.message}`);
    throw new databaseError(`Error creating MariaDB schema: ${error.message}`, error);
  } finally {
    if (conn) conn.release();
  }
}
export const DatabaseService = {
  // Posts
  /**
   * Retrieves a published post by its slug.
   * @param {string} slug - The slug of the post to retrieve.
   * @returns {Promise<object|null>} Resolves with the post object if found and published, otherwise null.
   * @throws {databaseError} If a database error occurs during the query.
   */
  async getPostBySlug(slug) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();

      // Defensive logging and normalization: trim and attempt normalized lookup if exact match fails
      const incomingSlug = typeof slug === 'string' ? slug.trim() : slug;
      const normalizedSlug = typeof incomingSlug === 'string' && incomingSlug.length > 0 ? createSlug(incomingSlug, { maxLength: 50 }) : incomingSlug;
      logger.debug(`DatabaseService.getPostBySlug: Received slug="${incomingSlug}", normalized="${normalizedSlug}"`);

      // Try exact lookup first
      let posts = await conn.query('SELECT * FROM posts WHERE slug = ? LIMIT 1', [incomingSlug]);

      // If no exact match, try normalized slug (useful for legacy entries with different normalization)
      if ((!posts || posts.length === 0) && normalizedSlug && normalizedSlug !== incomingSlug) {
        logger.debug(`DatabaseService.getPostBySlug: No exact match for slug="${incomingSlug}", trying normalized slug="${normalizedSlug}"`);
        posts = await conn.query('SELECT * FROM posts WHERE slug = ? LIMIT 1', [normalizedSlug]);
      }

      if (!posts || posts.length === 0) {
        logger.warn(`DatabaseService.getPostBySlug: No post found for slug="${incomingSlug}"`);
        return null;
      }

      const postRow = posts[0];

      // Fetch associated media via media.postId (guard in case of unexpected query errors)
      let mediaRows = [];
      try {
        mediaRows = await conn.query(
          'SELECT id, original_name, upload_path, mime_type, alt_text FROM media WHERE postId = ? ORDER BY id ASC',
          [postRow.id],
        );
      } catch (mediaErr) {
        logger.debug(`DatabaseService.getPostBySlug: media query failed for postId=${postRow.id}: ${mediaErr.message}`);
        mediaRows = [];
      }

      const post = convertBigInts(postRow);
      post.tags = parseTags(post.tags);
      post.media = (mediaRows || []).map(r => convertBigInts(r));

      // Normalize some fields to match other getters
      if (post.author === null || post.author === undefined) {
        post.author = 'author';
      }
      // Published: Integer (0/1) zu Boolean konvertieren
      post.published = normalizePublished(post.published);

      logger.debug(`DatabaseService.getPostBySlug: Post ${post.id} - author: "${post.author}", published: ${post.published} (${typeof post.published})`);

      if (!post.published) {
        logger.info(`DatabaseService.getPostBySlug: Post ${post.id} (slug=${post.slug}) is not published`);
        return null;
      }

      return post;
    } catch (error) {
      logger.error(`Error in getPostBySlug: ${error.message}`);
      throw new databaseError(`Error in getPostBySlug: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostById(id) {
    let conn;
    try {
      // Validate incoming id to avoid unexpected DB misses and provide clearer errors
      logger.debug(`DatabaseService.getPostById: incoming id=${id} (type=${typeof id})`);
      if (id === null || id === undefined) {
        throw new Error('ID is null or invalid');
      }
      if (typeof id === 'string') {
        const trimmed = id.trim();
        if (!/^\d+$/.test(trimmed)) {
          throw new Error('ID is null or invalid');
        }
        id = Number(trimmed);
      }
      if (typeof id === 'number') {
        if (!Number.isFinite(id) || id <= 0) {
          throw new Error('ID is null or invalid');
        }
      }
      conn = await getDatabasePool().getConnection();
      //const { query, params } = queryBuilder('get', 'posts', { id });
      //const result = await conn.query(query, params);
      const posts = await conn.query('SELECT * FROM posts WHERE id = ?', [id]);
      if(!posts || posts.length === 0) {
        logger.warn(`Post with ID ${id} not found`);
        throw new Error(`Post not found for id ${id}`);
      }
      const postRow = posts[0];
      const mediaRows = await conn.query(
        'SELECT id, original_name, upload_path, mime_type, alt_text FROM media WHERE postId = ? ORDER BY id ASC',
        [postRow.id],
      );
      const post = convertBigInts(postRow);
      post.tags = parseTags(post.tags);
      post.media = (mediaRows || []).map(r => convertBigInts(r));

      // Normalize some fields to match other getters
      if (post.author === null || post.author === undefined) {
        post.author = 'author';
      }
      post.published = normalizePublished(post.published);
      logger.debug(`DatabaseService.getPostById: Post ${post.id} - author: "${post.author}", published: ${post.published} (${typeof post.published})`);

      return post;
    } catch (error) {
      logger.error(`Error in getPostById: ${error.message}`);
      throw new databaseError(`Error in getPostById: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostsByCategoryId(categoryId) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const posts = await conn.query('SELECT * FROM posts WHERE category_id = ? ORDER BY created_at DESC', [categoryId]);
      if (!posts || posts.length === 0) {
        logger.warn(`No posts found for category ID ${categoryId}`);
        return [];
      }
      return posts.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) {
          post.author = 'author';
        }
        return post;
      });
    } catch (error) {
      logger.error(`Error in getPostsByCategoryId: ${error.message}`);
      throw new databaseError(`Error in getPostsByCategoryId: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostsByCategory(category) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const posts = await conn.query('SELECT * FROM posts WHERE category_id = (SELECT id FROM categories WHERE slug = ?) ORDER BY created_at DESC', [category]);
      if (!posts || posts.length === 0) {
        logger.warn(`No posts found for category "${category}"`);
        return [];
      }
      return posts.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) {
          post.author = 'author';
        }
        return post;
      });
    } catch (error) {
      logger.error(`Error in getPostsByCategory: ${error.message}`);
      throw new databaseError(`Error in getPostsByCategory: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getAllPosts() {
    let conn;
    // logger.debug('DatabaseService.getAllPosts: Starting database query');
    try {
      // logger.debug('DatabaseService.getAllPosts: Getting database connection');
      conn = await getDatabasePool().getConnection();
      
      // logger.debug('DatabaseService.getAllPosts: Executing SELECT * FROM posts ORDER BY created_at DESC');
      //const { query, params } = queryBuilder('get', 'posts', { orderBy: 'created_at DESC' });
      //const result = await conn.query(query, params);
      // Ensure newest posts come first
      const result = await conn.query('SELECT * FROM posts ORDER BY created_at DESC');
      
      logger.debug(`DatabaseService.getAllPosts: Query returned ${result ? result.length : 'null'} rows`);
      
      // Keine Posts gefunden ist kein Fehler, sondern ein leeres Ergebnis
      if(!result || result.length === 0) {
        logger.debug('DatabaseService.getAllPosts: Returning empty array');
        return []; // Leeres Array zurückgeben statt Exception
      }
      
      logger.debug(`DatabaseService.getAllPosts: Processing ${result.length} posts`);
      const processedPosts = result.map((post, _index) => {
        // logger.debug(`DatabaseService.getAllPosts: Processing post ${index + 1}/${result.length}, ID: ${post.id}`);
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        
        // Datentyp-Konvertierung für Validation
        // Autor: NULL oder undefined zu String konvertieren
        if (post.author === null || post.author === undefined) {
          post.author = 'author'; // Default-Author
        }
        
        // Published: Integer (0/1) zu Boolean konvertieren
        post.published = normalizePublished(post.published);
        
        // logger.debug(`DatabaseService.getAllPosts: Post ${post.id} - author: "${post.author}", published: ${post.published} (${typeof post.published})`);
        
        return post;
      });
      
      logger.debug(`DatabaseService.getAllPosts: Successfully processed ${processedPosts.length} posts`);
      return processedPosts;
    } catch (error) {
      logger.debug(`DatabaseService.getAllPosts: Database error occurred: ${error.message}`, { stack: error.stack });
      logger.error(`Error in getAllPosts: ${error.message}`);
      throw new databaseError(`Error in getAllPosts: ${error.message}`, error);
    } finally {
      if (conn) {
        logger.debug('DatabaseService.getAllPosts: Releasing database connection');
        conn.release();
      }
    }
  },
  async getPublishedPostsForHome() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(`
        SELECT id, slug, title, views, created_at, LEFT(content, 2000) AS excerpt_source, LEFT(content, 5000) AS preview_source
        FROM posts
        WHERE published = 1
        ORDER BY created_at DESC
      `);

      if (!result || result.length === 0) {
        return [];
      }

      return result.map((post) => {
        convertBigInts(post);
        post.views = Number(post.views) || 0;
        return post;
      });
    } catch (error) {
      logger.error(`Error in getPublishedPostsForHome: ${error.message}`);
      throw new databaseError(`Error in getPublishedPostsForHome: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getArchivedPosts(year) {
    // Optional year argument: when provided, return archived posts only for that year.
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      let result;
      if (typeof year !== 'undefined' && year !== null && year !== '') {
        const y = Number(year);
        // Defensive: ensure year is a number
        if (Number.isNaN(y)) {
          logger.warn(`Invalid year provided: ${year}`);
          return [];
        }
        // Select posts for the given year that are considered archived (older than 3 months)
        result = await conn.query('SELECT * FROM posts WHERE YEAR(created_at) = ? AND created_at < NOW() - INTERVAL 3 MONTH ORDER BY created_at DESC', [y]);
      } else {
        // Return all archived posts (older than 3 months), newest first
        result = await conn.query('SELECT * FROM posts WHERE created_at < NOW() - INTERVAL 3 MONTH ORDER BY created_at DESC');
      }
      if (!result || result.length === 0) {
        return [];
      }
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        return post;
      });
    } catch (error) {
      logger.error(`Error in getArchivedPosts: ${error.message}`);
      throw new databaseError(`Error in getArchivedPosts: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getArchivedYears() {
    // Returns an array of distinct years (number) for which archived posts exist
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const rows = await conn.query('SELECT DISTINCT YEAR(created_at) AS year FROM posts WHERE created_at < NOW() - INTERVAL 3 MONTH ORDER BY year DESC');
      if (!rows || rows.length === 0) return [];
      // Normalize to array of numbers
      return rows.map(r => Number(r.year)).filter(y => !Number.isNaN(y));
    } catch (error) {
      logger.error(`Error in getArchivedYears: ${error.message}`);
      throw new databaseError(`Error in getArchivedYears: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostsByTag(tag) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      //const { query, params } = queryBuilder('read', 'posts', { tags: { like: `%${tag}%` } });
      //const result = await conn.query(query, params);
      const result = await conn.query('SELECT * FROM posts WHERE tags LIKE ?', [`%${tag}%`]);
      if(!result || result.length === 0) {
        logger.warn(`No posts found for tag "${tag}"`);
        return [];
      }
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        return post;
      });
    } catch (error) {
      logger.error(`Error in getPostsByTag: ${error.message}`);
      throw new databaseError(`Error in getPostsByTag: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getMostReadPosts() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM posts ORDER BY views DESC LIMIT 5');
      if(!result || result.length === 0) {
        logger.warn('No posts found for getMostReadPosts');
        return [];
      }
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        // Normalize common fields expected by Post model
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) {
          post.author = 'author';
        }
        return post;
      });
    } catch (error) {
      logger.error(`Error in getMostReadPosts: ${error.message}`);
      throw new databaseError(`Error in getMostReadPosts: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async increasePostViews(postId, _ipAddress, _userAgent, _referer) {
    // TODO: Implement tracking of post views
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const update = await conn.query('UPDATE posts SET views = views + 1 WHERE id = ?', [postId]);
      if(!update || update.affectedRows === 0) {
        throw new Error('No rows affected');
      }
      return { success: true };
      //await conn.query(`INSERT INTO post_views (postId, event_type, ip_address, user_agent, referer) VALUES (?, 'view', ?, ?, ?)`, [postId, ipAddress, userAgent, referer]);
    } catch (error) {
      logger.error(`Error in increasePostViews: ${error.message}`);
      throw new databaseError(`Error in increasePostViews: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async updatePost(post) {
    let conn;
    try {
      if (!post || typeof post !== 'object' || Array.isArray(post)) {
        throw new databaseError('Post is null or not an object');
      }
      const updatableFields = ['title', 'content', 'tags', 'published', 'author', 'updated_at', 'category_id'];
      const hasUpdatableField = updatableFields.some(field => field in post);
      if (!hasUpdatableField) {
        throw new databaseError('No fields provided for update');
      }

      conn = await getDatabasePool().getConnection();

      const keys = updatableFields.filter(field => field in post);
      const values = keys.map(k => {
        if (k === 'tags') {
          const raw = post[k];
          if (raw === undefined || raw === null) return null;
          if (Array.isArray(raw)) {
            try { return JSON.stringify(raw); } catch (_e) { return null; }
          }
          if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed === '') return null;
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) return JSON.stringify(parsed);
              if (typeof parsed === 'string') {
                return JSON.stringify(parsed.split(',').map(t => t.trim()).filter(Boolean));
              }
            } catch {
              return JSON.stringify(trimmed.split(',').map(t => t.trim()).filter(Boolean));
            }
            return null;
          }
          return null;
        }
        return post[k];
      });
      // Set published_at on first publish (only if not already set) — folded into
      // the same UPDATE so this stays a single atomic statement, not two round trips.
      const setParts = keys.map(k => `\`${k}\` = ?`);
      if (post.published) {
        setParts.push('published_at = COALESCE(published_at, NOW())');
      }
      values.push(post.id);
      const updateSql = `UPDATE posts SET ${setParts.join(', ')} WHERE id = ?`;
      const result = await conn.query(updateSql, values);
      if(!result || result.affectedRows === 0) {
        throw new Error(`Failed to update post with id ${post.id}`);
      }
      return { success: true };
    } catch (error) {
      logger.error(`Error in updatePost: ${error.message}`);
      throw new databaseError(`Error in updatePost: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async deletePost(id) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      logger.debug(`DatabaseService.deletePost: Deleting post ${id}`);
      const result = await conn.query('DELETE FROM posts WHERE id = ?', [id]);
      logger.debug(`DatabaseService.deletePost: Query result - affectedRows: ${result.affectedRows}`);
      if(!result || result.affectedRows === 0) {
        throw new Error(`Failed to delete post with id ${id}`);
      }
      return { success: true };
    } catch (error) {
      logger.error(`Error in deletePost: ${error.message}`);
      throw new databaseError(`Error in deletePost: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getDrafts() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT * FROM posts WHERE published = 0 AND published_at IS NULL ORDER BY created_at DESC',
      );
      if (!result || result.length === 0) return [];
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) post.author = 'author';
        return post;
      });
    } catch (error) {
      logger.error(`Error in getDrafts: ${error.message}`);
      throw new databaseError(`Error in getDrafts: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getUnpublishedPosts() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT * FROM posts WHERE published = 0 AND published_at IS NOT NULL ORDER BY published_at DESC',
      );
      if (!result || result.length === 0) return [];
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) post.author = 'author';
        return post;
      });
    } catch (error) {
      logger.error(`Error in getUnpublishedPosts: ${error.message}`);
      throw new databaseError(`Error in getUnpublishedPosts: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPublishedPostsCount() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT COUNT(*) AS count FROM posts WHERE published = 1');
      return Number(result[0].count) || 0;
    } catch (error) {
      throw new databaseError(`Error in getPublishedPostsCount: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPublishedPostsPaginated(limit, offset) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT * FROM posts WHERE published = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset],
      );
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) post.author = 'author';
        return post;
      });
    } catch (error) {
      throw new databaseError(`Error in getPublishedPostsPaginated: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getCurrentPostsCount() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT COUNT(*) AS count FROM posts WHERE published = 1 AND created_at >= NOW() - INTERVAL 3 MONTH',
      );
      return Number(result[0].count) || 0;
    } catch (error) {
      throw new databaseError(`Error in getCurrentPostsCount: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getCurrentPostsPaginated(limit, offset) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT * FROM posts WHERE published = 1 AND created_at >= NOW() - INTERVAL 3 MONTH ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset],
      );
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) post.author = 'author';
        return post;
      });
    } catch (error) {
      throw new databaseError(`Error in getCurrentPostsPaginated: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostsCountByCategory(category) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT COUNT(*) AS count FROM posts WHERE published = 1 AND category_id = (SELECT id FROM categories WHERE slug = ?)',
        [category],
      );
      return Number(result[0].count) || 0;
    } catch (error) {
      throw new databaseError(`Error in getPostsCountByCategory: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostsByCategoryPaginated(category, limit, offset) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT * FROM posts WHERE published = 1 AND category_id = (SELECT id FROM categories WHERE slug = ?) ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [category, limit, offset],
      );
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        if (post.author === null || post.author === undefined) post.author = 'author';
        return post;
      });
    } catch (error) {
      throw new databaseError(`Error in getPostsByCategoryPaginated: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostsCountByTag(tag) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT COUNT(*) AS count FROM posts WHERE published = 1 AND tags LIKE ?',
        [`%${tag}%`],
      );
      return Number(result[0].count) || 0;
    } catch (error) {
      throw new databaseError(`Error in getPostsCountByTag: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPostsByTagPaginated(tag, limit, offset) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT * FROM posts WHERE published = 1 AND tags LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [`%${tag}%`, limit, offset],
      );
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        return post;
      });
    } catch (error) {
      throw new databaseError(`Error in getPostsByTagPaginated: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getArchivedPostsCount(year) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      let result;
      if (year !== undefined && year !== null) {
        result = await conn.query(
          'SELECT COUNT(*) AS count FROM posts WHERE published = 1 AND YEAR(created_at) = ? AND created_at < NOW() - INTERVAL 3 MONTH',
          [Number(year)],
        );
      } else {
        result = await conn.query(
          'SELECT COUNT(*) AS count FROM posts WHERE published = 1 AND created_at < NOW() - INTERVAL 3 MONTH',
        );
      }
      return Number(result[0].count) || 0;
    } catch (error) {
      throw new databaseError(`Error in getArchivedPostsCount: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getArchivedPostsPaginated(year, limit, offset) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      let result;
      if (year !== undefined && year !== null) {
        result = await conn.query(
          'SELECT * FROM posts WHERE published = 1 AND YEAR(created_at) = ? AND created_at < NOW() - INTERVAL 3 MONTH ORDER BY created_at DESC LIMIT ? OFFSET ?',
          [Number(year), limit, offset],
        );
      } else {
        result = await conn.query(
          'SELECT * FROM posts WHERE published = 1 AND created_at < NOW() - INTERVAL 3 MONTH ORDER BY created_at DESC LIMIT ? OFFSET ?',
          [limit, offset],
        );
      }
      return result.map(post => {
        convertBigInts(post);
        post.tags = parseTags(post.tags);
        post.published = normalizePublished(post.published);
        return post;
      });
    } catch (error) {
      throw new databaseError(`Error in getArchivedPostsPaginated: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async createPost(postData) {
    let conn;
    try {
      if(postData === null || typeof postData !== 'object' || Object.keys(postData).length === 0) {
        throw new databaseError('Post is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      // Build explicit parameterized INSERT to avoid driver-specific 'SET ?' expansion issues
      const allowedFields = ['title','slug','content','tags','author','views','published','created_at','updated_at', 'category_id'];
      const keys = Object.keys(postData).filter(k => allowedFields.includes(k));
      if (keys.length === 0) {
        throw new Error('No valid fields provided for insert');
      }
      const cols = keys.map(k => `\`${k}\``).join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => {
        if (k === 'tags' && postData[k] !== undefined && postData[k] !== null && typeof postData[k] !== 'string') {
          // store tags as JSON string
          try { return JSON.stringify(postData[k]); } catch (_e) { return null; }
        }
        return postData[k];
      });
      const insertSql = `INSERT INTO posts (${cols}) VALUES (${placeholders})`;
      const result = await conn.query(insertSql, values);
      if(!result || result.affectedRows === 0) {
        throw new Error(`Failed to create post: ${insertSql} with values ${JSON.stringify(values)}`);
      }
      return { id: Number(result.insertId), ...postData };
    } catch (error) {
      logger.error(`Error in createPost: ${error.message}`);
      throw new databaseError(`Error in createPost: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getAllCategories() {
    let conn;
    try {      
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM categories ORDER BY id ASC');
      return result.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        slug: row.slug,
      }));
    } catch (error) {
      logger.error(`Error in getAllCategories: ${error.message}`);
      throw new databaseError(`Error in getAllCategories: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getCategoryById(id) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM categories WHERE id = ?', [id]);
      if (!result || result.length === 0) return null;
      const row = result[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        slug: row.slug,
      };
    } catch (error) {
      logger.error(`Error in getCategoryById: ${error.message}`);
      throw new databaseError(`Error in getCategoryById: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getCategoriesByPostId(postId) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        `SELECT c.id, c.name, c.description
        FROM categories c
        JOIN posts p ON p.category_id = c.id
        WHERE p.id = ?`,
        [postId],
      );
      return result.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
      }));
    } catch (error) {
      logger.error(`Error in getCategoriesByPostId: ${error.message}`);
      throw new databaseError(`Error in getCategoriesByPostId: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  // Cards
  /**
   * Erstellt eine neue Card in der DB.
   * @param {Object} cardData - card-Daten (title, subtitle, link, img_link, published).
   * @returns {Promise<Object>} Objekt mit `success: true` und dem erstellten `card`.
   * @throws {databaseError} Bei DB-Fehlern.
   */
  async createCard(cardData) {
    let conn;
    try {
      if (!cardData || typeof cardData !== 'object') {
        throw new databaseError('Card is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      // Use explicit column list to avoid driver-specific SET ? behavior issues
      const insertData = {
        title: cardData.title,
        subtitle: cardData.subtitle ?? null,
        link: cardData.link,
        img_link: cardData.img_link,
        // Ensure boolean maps correctly for MariaDB tinyint(1)/boolean
        // Default to 1 (true) if not explicitly provided to match schema default
        published: typeof cardData.published === 'boolean' ? (cardData.published ? 1 : 0) : 1,
      };
      const result = await conn.query(
        'INSERT INTO cards (title, subtitle, link, img_link, published) VALUES (?, ?, ?, ?, ?)',
        [insertData.title, insertData.subtitle, insertData.link, insertData.img_link, insertData.published],
      );
      if (result.affectedRows === 0) {
        throw new Error('No rows affected');
      }
      return {
        success: true,
        card: { id: Number(result.insertId), ...insertData, published: Boolean(insertData.published) },
      };
    } catch (error) {
      logger.error(`Error in createCard: ${error.message}`);
      throw new databaseError(`Error in createCard: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getAllCards() {
    let conn;
    try {
      		conn = await getDatabasePool().getConnection();
      		const result = await conn.query('SELECT * FROM cards WHERE published = 1 ORDER BY id DESC');
      if (!result || result.length === 0) {
        throw new Error('No cards found');
      }
      return result.map(card => {
        const converted = { ...convertBigInts(card) };
        // Normalize published to boolean consistently
        converted.published = normalizePublished(converted.published);
        return converted;
      });
    } catch (error) {
      logger.error(`Error in getAllCards: ${error.message}`);
      throw new databaseError(`Error in getAllCards: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getAllCardsAdmin() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM cards ORDER BY id DESC');
      return (result || []).map(card => {
        const converted = { ...convertBigInts(card) };
        converted.published = normalizePublished(converted.published);
        return converted;
      });
    } catch (error) {
      logger.error(`Error in getAllCardsAdmin: ${error.message}`);
      throw new databaseError(`Error in getAllCardsAdmin: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getCardsPaginated(limit, offset) {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT * FROM cards WHERE published = 1 ORDER BY id DESC LIMIT ? OFFSET ?',
        [limit, offset],
      );
      return (result || []).map(card => {
        const converted = { ...convertBigInts(card) };
        converted.published = normalizePublished(converted.published);
        return converted;
      });
    } catch (error) {
      logger.error(`Error in getCardsPaginated: ${error.message}`);
      throw new databaseError(`Error in getCardsPaginated: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getPublishedCardsCount() {
    let conn;
    try {
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT COUNT(*) AS count FROM cards WHERE published = 1');
      return Number(result[0].count);
    } catch (error) {
      logger.error(`Error in getPublishedCardsCount: ${error.message}`);
      throw new databaseError(`Error in getPublishedCardsCount: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getCardById(cardId) {
    let conn;
    try {
      if(cardId === null || isNaN(cardId)) {
        throw new databaseError('ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM cards WHERE id = ?', [cardId]);
      if (result.length === 0) return null;
      const converted = { ...convertBigInts(result[0]) };
      converted.published = normalizePublished(converted.published);
      return converted;
    } catch (error) {
      logger.error(`Error in getCardById: ${error.message}`);
      throw new databaseError(`Error in getCardById: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async deleteCard(cardId) {
    let conn;
    try {
      if(cardId === null || isNaN(cardId)) {
        throw new databaseError('ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('DELETE FROM cards WHERE id = ?', [cardId]);
      if (result.affectedRows > 0) {
        return { success: true };
      } else {
        throw new databaseError('No rows affected');
      }
    } catch (error) {
      logger.error(`Error in deleteCard: ${error.message}`);
      throw new databaseError(`Error in deleteCard: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async updateCard(cardId, cardData) {
    let conn;
    try {
      if (cardId === null || isNaN(cardId)) {
        throw new databaseError('ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const published = typeof cardData.published === 'boolean' ? (cardData.published ? 1 : 0) : 1;
      const result = await conn.query(
        'UPDATE cards SET title = ?, subtitle = ?, link = ?, img_link = ?, published = ? WHERE id = ?',
        [cardData.title, cardData.subtitle ?? null, cardData.link, cardData.img_link, published, cardId],
      );
      if (result.affectedRows === 0) {
        throw new databaseError('No rows affected');
      }
      return { success: true };
    } catch (error) {
      logger.error(`Error in updateCard: ${error.message}`);
      throw new databaseError(`Error in updateCard: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  // Comments
  /**
   * Fügt einen Kommentar zu einem Post hinzu und gibt das neue Kommentar-Objekt zurück.
   * @param {number} postId - ID des Posts.
   * @param {Object} commentData - Kommentardaten (username, text, ...).
   * @returns {Promise<Object>} Objekt mit `success: true` und `comment`.
   * @throws {databaseError} Bei DB-Fehlern.
   */
  async createComment(postId, commentData) {
    let conn;
    try {
      if (!postId || isNaN(postId) || postId === null) {
        throw new databaseError('Post ID is null or invalid');
      }
      if (!commentData || typeof commentData !== 'object' || commentData === null) {
        throw new databaseError('Comment data is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'INSERT INTO comments (postId, username, text, approved, published) VALUES (?, ?, ?, 1, 1)', 
        [postId, commentData.username, commentData.text],
      );

      return {
        success: true,
        comment: {
          id: Number(result.insertId),
          postId: Number(postId),
          ...commentData,
        },
      };
    } catch (error) {
      logger.error(`Error in createComment: ${error.message}`);
      throw new databaseError(`Error in createComment: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getCommentsByPostId(postId) {
    let conn;
    try {
      if (!postId || isNaN(postId) || postId === null) {
        throw new databaseError('Post ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(`
            SELECT id, username, text, created_at, approved, published
            FROM comments 
            WHERE postId = ? AND approved = 1
            ORDER BY created_at ASC
        `, [postId]);
      return result.map(comment => ({
        id: Number(comment.id),
        username: comment.username,
        text: comment.text,
        created_at: comment.created_at,
        approved: Boolean(comment.approved),
        published: Boolean(comment.published),
      }));
    } catch (error) {
      logger.error(`Error in getCommentsByPostId: ${error.message}`);
      throw new databaseError(`Error in getCommentsByPostId: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async deleteComment(commentId, postId) {
    let conn;
    try {
      if (!commentId || isNaN(commentId) || commentId === null) {
        throw new databaseError('Comment ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'DELETE FROM comments WHERE id = ? AND postId = ?',
        [commentId, postId],
      );
      return result.affectedRows > 0 ? { success: true } : null;
    } catch (error) {
      logger.error(`Error in deleteComment: ${error.message}`);
      throw new databaseError(`Error in deleteComment: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  }, 
  // Media
  /**
   * Legt ein Media-Objekt in der DB an und gibt die neue Media-ID zurück.
   * @param {Object} mediaData - Media-Metadaten.
   * @returns {Promise<Object>} Objekt mit `success: true` und `mediaId`.
   * @throws {databaseError} Bei DB-Fehlern.
   */
  async addMedia(mediaData) {
    let conn;
    try {
      if (!mediaData || typeof mediaData !== 'object' || mediaData === null) {
        throw new databaseError('Media data is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      
      const result = await conn.query(
        'INSERT INTO media (postId, original_name, file_size, mime_type, uploaded_by, upload_path, alt_text) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          mediaData.postId || null,
          mediaData.original_name,
          mediaData.file_size || null,
          mediaData.mime_type || null,
          mediaData.uploaded_by || null,
          mediaData.upload_path,
          mediaData.alt_text || null,
        ],
      );
      
      if (result.affectedRows === 0) {
        throw new Error('No rows affected');
      }
      
      return {
        success: true,
        mediaId: Number(result.insertId),
      };
    } catch (error) {
      logger.error(`Error in addMedia: ${error.message}`);
      throw new databaseError(`Error in addMedia: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async deleteMedia(mediaId) {
    let conn;
    try {
      if (!mediaId || isNaN(mediaId) || mediaId === null) {
        throw new databaseError('Media ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('DELETE FROM media WHERE id = ?', [mediaId]);
      return result.affectedRows > 0 ? { success: true } : null;
    } catch (error) {
      logger.error(`Error in deleteMedia: ${error.message}`);
      throw new databaseError(`Error in deleteMedia: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getMediaById(mediaId) {
    let conn;
    try {
      if (!mediaId || isNaN(mediaId) || mediaId === null) {
        throw new databaseError('Media ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM media WHERE id = ?', [mediaId]);
      return result.length > 0 ? convertBigInts(result[0]) : null;
    } catch (error) {
      logger.error(`Error in getMediaById: ${error.message}`);
      throw new databaseError(`Error in getMediaById: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getMediaByPostId(postId) {
    let conn;
    try {
      if (!postId || isNaN(postId) || postId === null) {
        throw new databaseError('Post ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM media WHERE postId = ? ORDER BY id ASC', [postId]);
      return result.map(row => convertBigInts(row));
    } catch (error) {
      logger.error(`Error in getMediaByPostId: ${error.message}`);
      throw new databaseError(`Error in getMediaByPostId: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  // Admin
  /**
   * Lädt einen Admin-Benutzer anhand des Benutzernamens und normalisiert Felder
   * (z.B. Typkonvertierungen, Standardwerte) für Konsistenz mit Modellen.
   * @param {string} username - Admin-Benutzername.
   * @returns {Promise<Object|null>} Normalisiertes Admin-Objekt oder `null` wenn nicht gefunden.
   * @throws {databaseError} Bei DB-Fehlern.
   */
  async getAdminById(id) {
    let conn;
    try {
      if (!id || isNaN(id)) {
        throw new databaseError('Admin ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query(
        'SELECT id, username, role, full_name, active FROM admins WHERE id = ? LIMIT 1',
        [id],
      );
      if (!result || result.length === 0) return null;
      return convertBigInts({ ...result[0] });
    } catch (error) {
      logger.error(`Error in getAdminById: ${error.message}`);
      throw new databaseError(`Error in getAdminById: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async getAdminByUsername(username) {
    let conn;
    try {
      if (!username || typeof username !== 'string' || username.trim() === '' || username === null) {
        throw new databaseError('Username is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('SELECT * FROM admins WHERE username = ? LIMIT 1', [username]);
      if (!result || result.length === 0) return null;

      // Normalize admin row to expected types for Joi schema
      const raw = result[0];
      const row = convertBigInts({ ...raw });

      // id: ensure number
      if (typeof row.id === 'string') {
        const n = Number(row.id);
        row.id = Number.isFinite(n) ? n : row.id;
      }

      // active: tinyint(1) -> boolean
      if (typeof row.active === 'number') {
        row.active = row.active === 1;
      } else if (typeof row.active === 'string') {
        row.active = row.active === '1' || row.active.toLowerCase() === 'true';
      } else if (row.active == null) {
        row.active = true; // default active if missing
      }

      // role: default to 'admin' if missing/null
      if (!row.role) {
        row.role = 'admin';
      }

      // full_name: remove if null/invalid to satisfy Joi.optional string
      if (row.full_name == null || (typeof row.full_name !== 'string')) {
        delete row.full_name;
      }

      // Dates: convert invalid sentinel to null and ensure Date objects
      const normalizeDate = (v) => {
        if (!v) return null;
        if (typeof v === 'string' && v.startsWith('0000-00-00')) return null;
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d;
      };
      row.last_login = normalizeDate(row.last_login);
      row.locked_until = normalizeDate(row.locked_until);
      row.created_at = normalizeDate(row.created_at) || new Date();
      row.updated_at = normalizeDate(row.updated_at) || row.created_at;

      // login_attempts: ensure number >= 0
      if (typeof row.login_attempts === 'string') {
        const n = parseInt(row.login_attempts, 10);
        row.login_attempts = Number.isFinite(n) && n >= 0 ? n : 0;
      } else if (typeof row.login_attempts !== 'number' || row.login_attempts < 0 || !Number.isFinite(row.login_attempts)) {
        row.login_attempts = 0;
      }

      return row;
    } catch (error) {
      logger.error(`Error in getAdminByUsername: ${error.message}`);
      throw new databaseError(`Error in getAdminByUsername: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async updateAdminLoginSuccess(adminId) {
    let conn;
    try {
      if (!adminId || isNaN(adminId) || adminId === null) {
        throw new databaseError('Admin ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const update = await conn.query('UPDATE admins SET last_login = NOW(), login_attempts = 0, locked_until = NULL WHERE id = ?', [adminId]);
      return update.affectedRows > 0 ? true : false;
    } catch (error) {
      logger.error(`Error in updateAdminLoginSuccess: ${error.message}`);
      throw new databaseError(`Error in updateAdminLoginSuccess: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async updateAdminLoginFailure(adminId) {
    let conn;
    try {
      if (!adminId || isNaN(adminId) || adminId === null) {
        throw new databaseError('Admin ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      // Aktuelle Login-Attempts abrufen
      const result = await conn.query('SELECT login_attempts FROM admins WHERE id = ?', [adminId]);
      if (result.length > 0) {
        const currentAttempts = result[0].login_attempts + 1;
        let locked_until = null;

        // Account nach 3 fehlgeschlagenen Versuchen für 30 Minuten sperren
        if (currentAttempts >= 3) {
          locked_until = new Date(Date.now() + 30 * 60 * 1000); // 30 Minuten
        }

        const update = await conn.query('UPDATE admins SET login_attempts = ?, locked_until = ? WHERE id = ?', [currentAttempts, locked_until, adminId]);
        return update.affectedRows > 0 ? true : false;
      }
      else {
        // Admin not found
        return false;
      }
    } catch (error) {
      logger.error(`Error in updateAdminLoginFailure: ${error.message}`);
      throw new databaseError(`Error in updateAdminLoginFailure: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  },
  async updateAdminStatus(adminId, active) {
    let conn;
    try {
      if(adminId === null || isNaN(adminId)) {
        throw new databaseError('Admin ID is null or invalid');
      }
      conn = await getDatabasePool().getConnection();
      const result = await conn.query('UPDATE admins SET active = ? WHERE id = ?', [active, adminId]);
      return result.affectedRows > 0 ? true : false;
    } catch (error) {
      logger.error(`Error in updateAdminStatus: ${error.message}`);
      throw new databaseError(`Error in updateAdminStatus: ${error.message}`, error);
    } finally {
      if (conn) conn.release();
    }
  }, 
};
// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('Closing MariaDB connections...');
  await getDatabasePool().end();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  console.log('Closing MariaDB connections...');
  await getDatabasePool().end();
  process.exit(0);
});
