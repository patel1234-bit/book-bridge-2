/**
 * ==========================================================================
 * BOOKBRIDGE SECRETS CONFIGURATION
 * Strict production validation for JWT and cryptographic keys
 * ==========================================================================
 */

const isProduction = process.env.NODE_ENV === 'production';
let jwtSecret = process.env.JWT_SECRET;

if (isProduction) {
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('[Fatal Error] In production, JWT_SECRET environment variable is required and must be at least 32 characters long.');
    process.exit(1);
  }
} else {
  if (!jwtSecret) {
    console.warn('[Security Warning] JWT_SECRET not set in environment. Using insecure development secret. DO NOT USE IN PRODUCTION.');
    jwtSecret = 'dev_only_insecure_jwt_secret_min_32_characters_long_warning';
  } else if (jwtSecret.length < 32) {
    console.warn('[Security Warning] JWT_SECRET is less than 32 characters long in development environment.');
  }
}

module.exports = {
  JWT_SECRET: jwtSecret,
  isProduction
};

