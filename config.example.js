module.exports = {
  // Jobber OAuth Configuration
  // Get these from your Jobber app settings at https://developer.getjobber.com/
  JOBBER_CLIENT_ID: "f1e669eb-8e00-46bf-98b9-9ec972940d5c",
  JOBBER_CLIENT_SECRET:
    "c9d9642964e0b868b0cbc469e861f4b4e901b493fdd648a77622fb011c49559d",

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
