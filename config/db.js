/**
 * ==========================================================================
 * BOOKBRIDGE AUTHORITATIVE DATABASE ENGINE (Sequelize ORM + MySQL)
 * Production-ready connection pooling, strict error isolation, and migrations
 * ==========================================================================
 */

const path = require('path');
const fs = require('fs');
const { Sequelize } = require('sequelize');

let sequelize = null;
let isConnected = false;
let dbDialect = 'mysql';

const isProduction = process.env.NODE_ENV === 'production';
const rawDatabaseUrl = process.env.DATABASE_URL || process.env.MYSQL_URL || '';
const databaseUrl = rawDatabaseUrl.includes('?') ? rawDatabaseUrl.split('?')[0] : rawDatabaseUrl;

if (databaseUrl) {
  // MySQL / Postgres / External Cloud DB Connection String
  const isPostgres = databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://');
  const requireSSL = isPostgres || process.env.MYSQL_SSL === 'true' || process.env.DB_SSL === 'true' || rawDatabaseUrl.includes('ssl');

  dbDialect = isPostgres ? 'postgres' : 'mysql';

  const dialectOptions = isPostgres ? {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  } : (requireSSL ? {
    connectTimeout: 30000,
    ssl: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true
    }
  } : {
    connectTimeout: 20000
  });

  sequelize = new Sequelize(databaseUrl, {
    dialect: dbDialect,
    dialectOptions,
    logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    pool: {
      max: 15,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
  console.log(`[DB Config] Configured ${dbDialect.toUpperCase()} connection from DATABASE_URL.`);
} else if (process.env.MYSQL_HOST) {
  // Explicit MySQL Environment Variables
  const host = process.env.MYSQL_HOST;
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
  const database = process.env.MYSQL_DATABASE || 'bookbridge';
  const username = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const requireSSL = process.env.MYSQL_SSL === 'true' || process.env.DB_SSL === 'true';
  dbDialect = 'mysql';

  sequelize = new Sequelize(database, username, password, {
    host,
    port,
    dialect: 'mysql',
    dialectOptions: requireSSL ? {
      connectTimeout: 30000,
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
      }
    } : {
      connectTimeout: 20000
    },
    logging: process.env.DB_LOGGING === 'true' ? console.log : false,
    pool: {
      max: 15,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  });
  console.log(`[DB Config] Configured MySQL connection at ${host}:${port}/${database}.`);
} else if (!isProduction) {
  // SQLite is allowed ONLY when NODE_ENV !== 'production' (development/testing)
  const dbDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  const sqlitePath = path.join(dbDir, 'bookbridge.sqlite');
  dbDialect = 'sqlite';

  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: sqlitePath,
    logging: process.env.DB_LOGGING === 'true' ? console.log : false
  });
  console.log(`[DB Dev Mode] Initialized SQLite development database at: ${sqlitePath}`);
} else {
  // In production, DATABASE_URL or MYSQL_HOST is required. No zero-config SQLite mode in production.
  console.error('[DB Fatal Error] In production, either DATABASE_URL or MYSQL_HOST must be provided. SQLite is not permitted in production. Exiting.');
  process.exit(1);
}

/**
 * Connect to database and verify connectivity
 */
const connectDB = async () => {
  if (!sequelize) {
    console.error('[DB Fatal Error] Database connection instance not initialized.');
    if (isProduction) {
      process.exit(1);
    }
    return false;
  }

  try {
    await sequelize.authenticate();
    isConnected = true;
    console.log(`[Database Connected] Successfully connected to ${dbDialect.toUpperCase()} database engine.`);
    return true;
  } catch (error) {
    isConnected = false;
    console.error(`[Database Error] Connection failed (${error.message}).`);

    if (isProduction) {
      console.error('[Database Fatal Error] Failed to connect to production database. Exiting process.');
      process.exit(1);
    }

    return false;
  }
};

const getSQLStatus = () => isConnected;
const getMongoStatus = () => isConnected; // Compatibility alias

module.exports = {
  sequelize,
  connectDB,
  getSQLStatus,
  getMongoStatus,
  getDialect: () => dbDialect
};
