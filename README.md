# ATTOM Integration App

A Node.js application that integrates with Jobber's API using OAuth 2.0 and GraphQL.

## Features

- 🔐 OAuth 2.0 authentication with Jobber
- 🔌 GraphQL API integration
- 🚗 Example: Create vehicles with make, model, year, and name

## Prerequisites

- [Developer Center account](https://developer.getjobber.com/)
- [An app in the Developer Center](https://developer.getjobber.com/apps). You can use the existing one or create a new one.
- Node.js (version 14 or higher)
- npm or yarn

## Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/kristina-vi/attom-integration-app.git
   cd attom-integration-app
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure your Jobber app:**

   - Go to your Jobber [Developer Center](https://developer.getjobber.com/apps)
   - Select your app and click edit
     ![image](https://github.com/user-attachments/assets/9fd648a4-73db-434e-a95e-c37d44733ca8)
   - Set the redirect URI to: `http://localhost:3001/auth/callback`
   - Enable the Vehicle and Equipment scope
     ![image](https://github.com/user-attachments/assets/f51611ee-355f-4ec1-b917-7befceca985d)
   - Note down your Client ID and Client Secret

4. **Set up configuration:**

   Copy the example config file:

   ```bash
   cp config.example.js config.js
   ```

   Edit `config.js` and add your actual credentials:

   ```javascript
   // config.js
   module.exports = {
     CLIENT_ID: "your-actual-client-id",
     CLIENT_SECRET: "your-actual-client-secret",
     // ... other settings
   };
   ```

## Usage

1. **Start the server:**

   ```bash
   npm start
   ```

   For development with auto-restart:

   ```bash
   npm run dev
   ```

2. **Open your browser:**
   Navigate to `http://localhost:3001`

3. **Authenticate with Jobber:**

   - Click "Connect with Jobber"
   - You'll be redirected to Jobber's authorization page
   - Grant the required permissions
   - You'll be redirected back to the application

4. **Use the API:**
   - The template includes a sample vehicle creation form
   - Fill out the form with make, model, year, and name
   - Click "Create Vehicle" to test the GraphQL API
   - Customize the API calls for your specific use case

## Project Structure

```
├── server.js          # Express server with OAuth and GraphQL integration
├── config.js          # Configuration file with OAuth credentials (gitignored)
├── config.example.js  # Example configuration file for setup
├── package.json       # Node.js dependencies and scripts
├── .gitignore         # Git ignore rules
├── public/
│   ├── index.html     # Frontend HTML
│   └── script.js      # Frontend JavaScript for API communication
└── README.md          # This file
```

## OAuth Flow

1. User clicks "Connect with Jobber"
2. Application redirects to Jobber's authorization server
3. User grants permissions
4. Jobber redirects back with authorization code
5. Application exchanges code for access token
6. Access token is stored in session
7. User can now create vehicles

## GraphQL Integration

This template demonstrates GraphQL API usage with a `vehicleCreate` mutation example:

```graphql
mutation CreateVehicle($input: VehicleCreateInput!) {
  vehicleCreate(input: $input) {
    vehicle {
      id
      name
      make
      model
      year
    }
    userErrors {
      field
      message
    }
  }
}
```

## Customizing for Your Use Case

This template uses vehicle creation as an example. To adapt it for your needs:

1. **Replace the GraphQL mutation** in `server.js` with your desired Jobber API operations
2. **Update the frontend form** in `public/index.html` to match your data requirements
3. **Modify the API endpoint** in `server.js` (currently `/api/vehicles`) to match your functionality
4. **Update validation and error handling** as needed for your specific use case

You can integrate with any part of Jobber's GraphQL API - clients, jobs, invoices, team members, etc.

## Error Handling

The application handles various error scenarios:

- OAuth authentication errors
- Token expiration
- GraphQL validation errors
- Network connectivity issues
- Form validation errors

## Security Features

- Client secret is kept on the server (not exposed to frontend)
- Session-based token storage
- Input validation and sanitization

## Troubleshooting

### Common Issues

1. **"Authentication failed"**

   - Verify your Client ID and Client Secret in `config.js`
   - Ensure the redirect URI matches exactly in your Jobber app settings

2. **"Failed to create vehicle"**

   - Verify all form fields are filled correctly
   - Check that your Jobber app has permission to create vehicles

3. **"Session expired"**
   - Click "Connect with Jobber" to re-authenticate

## Production Deployment

Before deploying to production:

1. **Environment Variables:**

   - Move credentials to environment variables
   - Set `SESSION_SECRET` to a secure random string

2. **Security:**

   - Enable HTTPS
   - Set `cookie.secure: true` in session configuration
   - Update CORS settings for your domain
   - Implement [Refresh Token rotation](https://developer.getjobber.com/docs/building_your_app/app_authorization/#refresh-token-flow)

3. **Redirect URI:**

   - Update the redirect URI in your Jobber app settings
   - Update `REDIRECT_URI` in your configuration

4. **Handle App Disconnect**
   - This template doesn't handle user disconnect
   - The documentation on the disconnect flow can be found [here](https://developer.getjobber.com/docs/building_your_app/app_authorization/#handling-app-disconnects)

## Support

For issues with:

- **Jobber API:** Check the [Jobber Developer Documentation](https://developer.getjobber.com/docs)
- **This application:** Review the troubleshooting section above

## License

This project is provided as-is **for demonstration purposes.**
