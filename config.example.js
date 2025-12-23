module.exports = {
  // Jobber OAuth Configuration
  // Get these from your Jobber app settings at https://developer.getjobber.com/
  JOBBER_CLIENT_ID: "your-client-id-here",
  JOBBER_CLIENT_SECRET: "your-client-secret-here",

  // OAuth URLs
  JOBBER_AUTH_URL: "https://api.getjobber.com/api/oauth/authorize",
  JOBBER_TOKEN_URL: "https://api.getjobber.com/api/oauth/token",

  // GraphQL Configuration
  JOBBER_GRAPHQL_URL: "https://api.getjobber.com/api/graphql",
  API_VERSION: "2025-01-20",

  // Local server configuration
  PORT: 3001,
  REDIRECT_URI: "http://localhost:3001/auth/callback",

  // Session configuration
  SESSION_SECRET: "your-session-secret-here", // Use a strong random string
};
