//The server.js file is responsible for configuring and starting the server. It imports the Express app from app.js, sets the port, and tells the app to listen for incoming requests.
/**
 *
- Importing the Express App: It imports the app created in app.js.
- Setting Up the Port: The server listens on a specific port (e.g., 3000).
- Starting the Server: The server is started using app.listen() to handle incoming requests.
- Logging the Server Status: It logs a message when the server starts successfully.
 */

//server.js
import http from 'http';
import * as config from './config/config.js';
import app, { waitForApp, getAppStatus } from './app.js';
import logger from './utils/logger.js';
import { closeDatabase } from './databases/mariaDB.js';

// ===========================================
// SERVER CONFIGURATION & STARTUP
// ===========================================

// Global server reference for graceful shutdown
let httpServer = null;
let shuttingDown = false;

// Main server startup function
async function startServer() {
  try {
    // Wait for app initialization to complete
    await waitForApp();
    
    // Check app status after initialization
    const appStatus = getAppStatus();
    logger.info('Detailed App Status:', {
      ready: appStatus.ready,
      database: appStatus.database,
      timestamp: appStatus.timestamp,
    });

    if (!appStatus.ready) {
      throw new Error('App initialization failed - not ready');
    }
    
    logger.info('App ready, starting servers...');
        
    // Log server configuration
    logServerConfiguration();

    // Start HTTP server (TLS is terminated by Nginx)
    await startHTTPServer();

    // Setup graceful shutdown handlers
    setupGracefulShutdown();
        
    logger.info('Server startup completed successfully');
        
  } catch (error) {
    const appStatus = getAppStatus();
    logger.error(`Server startup failed: ${error.message}`);
    logger.error('App Status:', {
      appReady: appStatus.ready,
      databaseReady: appStatus.database,
      timestamp: appStatus.timestamp,
    });
    if (config.IS_PRODUCTION) {
      logger.error(`Error type: ${error.name}, code: ${error.code || 'unknown'}`);
    } else {
      logger.error('Error details:', error);
    }
        
    // Specific error handling for common issues
    if (error.code === 'EADDRINUSE') {
      logger.error(`Port ${config.PORT} is already in use!`);
      logger.error('Try: PORT=3001 node server.js');
    } else if (error.code === 'EACCES') {
      logger.error(`Permission denied for port ${config.PORT}`);
      logger.error('Try using a port > 1024 or run with elevated privileges');
    } else if (error.message.includes('app initialization')) {
      logger.error('App initialization failed - check database connection');
    }
        
    process.exit(1);
  }
}
// Start HTTP server
function startHTTPServer() {
  return new Promise((resolve, reject) => {
    httpServer = http.createServer(app);
        
    // Configure server timeouts for better performance
    httpServer.setTimeout(30000);           // 30 seconds for socket timeout
    httpServer.headersTimeout = 31000;      // 31 seconds for headers timeout
    httpServer.keepAliveTimeout = 5000;     // 5 seconds keep-alive
    httpServer.requestTimeout = 20000;      // 20 seconds for request timeout
    httpServer.maxHeadersCount = 1000;     // Limit max headers to prevent abuse
    httpServer.maxConnections = 1000;      // Limit max concurrent connections
        
    httpServer.listen(config.PORT, config.HOST, () => {
      logger.info(`HTTP Server running on ${config.HOST}:${config.PORT}`);

      if (config.IS_PRODUCTION) {
        // In production Nginx terminates SSL and proxies to this port.
        // Show the public-facing HTTPS URL, not the internal Node port.
        const publicUrl = `https://${config.DOMAIN || 'speculumx.at'}`;
        logger.info(`Server erreichbar unter: ${publicUrl}`);
        logger.info(`Health Check: ${publicUrl}/health`);
        logger.info('Production mode: SSL handled by Nginx');
      } else {
        // In development Nginx (Docker) listens on port 80 and proxies to this port.
        const devUrl = 'http://localhost';
        logger.info(`Server erreichbar unter: ${devUrl}`);
        logger.info(`Health Check: ${devUrl}/health`);
        logger.info('Development mode: HTTP server started');
      }
            
      resolve();
    });
        
    httpServer.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        const errorMsg = `Port ${config.PORT} bereits in Verwendung! Tipp: Verwende einen anderen Port mit PORT=xxxx`;
        logger.error(errorMsg);
        console.error(errorMsg);
      } else {
        logger.error('HTTP Server error:', error);
      }
      reject(error);
    });
  });
}
// Log server configuration
function logServerConfiguration() {
  logger.info('=== Server Configuration ===');
  logger.info(`Environment: ${config.IS_PRODUCTION ? 'Production' : 'Development'}`);
  //logger.info(`Plesk integration: ${config.IS_PLESK ? 'Enabled' : 'Disabled'}`);
  logger.info(`HTTP Port: ${config.PORT}`);
  //logger.info(`HTTPS Port: ${config.HTTPS_PORT}`);
  logger.info(`Host: ${config.HOST}`);
  logger.info(`Domain: ${config.DOMAIN || 'not set'}`);
}// Graceful shutdown setup
function setupGracefulShutdown() {
  [
    'SIGTERM', // Beenden-Signal vom Betriebssystem (z.B. durch systemctl stop oder kill)
    'SIGINT',  // Interrupt-Signal (z.B. Strg+C im Terminal)
    'SIGUSR2', // Benutzerdefiniertes Signal, oft von Tools wie nodemon zum Neustarten verwendet
  ].forEach(signal => {
    process.on(signal, () => gracefulShutdown(signal));
  });
}
// Graceful Shutdown Handler
// Order matters: stop accepting requests and let in-flight ones finish, then
// close the DB pool they use, then flush the log files, then exit.
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received - starting graceful shutdown...`);

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);

  const httpClosed = !httpServer ? Promise.resolve() : new Promise((resolve) => {
    httpServer.close((err) => {
      if (err) {
        logger.error('Error closing HTTP server:', err);
      } else {
        logger.info('HTTP server closed');
      }
      resolve();
    });
  });

  httpClosed
    .then(() => closeDatabase())
    .then(() => {
      logger.info('Database pool closed - shutdown complete');
      return logger.close();
    })
    .then(() => process.exit(0))
    .catch((error) => {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    });
}
// ===========================================
// GLOBAL ERROR SAFETY NET
// ===========================================
process.on('uncaughtException', (err) => {
  logger.error('FATAL: uncaughtException – process will exit', {
    message: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('FATAL: unhandledRejection – process will exit', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  process.exit(1);
});

// Start the server
startServer();
