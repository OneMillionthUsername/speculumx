//dbConfig.js: Contains the configuration for connecting to the database, like the host, username, and password.
/**
- Separation of Configurations: Keeps all environment configurations in one place for easier management.
- Environment Flexibility: Allows easy switching of configurations for different environments (development, production).
- Database Configuration: Centralizes database connection settings for better maintainability.
*/

// Side-effect import: ensures dotenv has loaded .env.<NODE_ENV> before we read
// process.env below. Standalone scripts (scripts/*.mjs) import databases/mariaDB.js
// directly without ever importing config.js first, so without this, DB_USER/
// DB_PASSWORD/DB_NAME are silently empty when run outside app.js/Docker.
import './config.js';

export const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  acquireTimeout: 30000,
  timeout: 30000,
  reconnect: true,
  charset: 'utf8mb4',
  collate: 'utf8mb4_unicode_ci',
};