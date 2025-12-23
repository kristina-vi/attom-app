const express = require("express");
const axios = require("axios");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const config = require("./config");

const app = express();

// Store webhook events in memory (for demo purposes)
const webhookEvents = [];
const MAX_EVENTS = 50; // Keep last 50 events

// Store access token for webhook use (in production, use a proper store)
let storedAccessToken = null;

// Helper function to fetch property details from Jobber
async function fetchPropertyDetails(propertyId) {
  if (!storedAccessToken) {
    console.log("No access token available to fetch property details");
    return null;
  }

  const query = `
    query property($id: EncodedId!) {
      property(id: $id) {
        address {
          street1
          street2
          city
          province
          country
          postalCode
        }
      }
    }
  `;

  try {
    const response = await axios.post(
      config.JOBBER_GRAPHQL_URL,
      {
        query: query,
        variables: { id: propertyId },
      },
      {
        headers: {
          Authorization: `Bearer ${storedAccessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-JOBBER-GRAPHQL-VERSION": config.API_VERSION,
        },
      }
    );

    if (response.data.errors) {
      console.error("GraphQL errors fetching property:", response.data.errors);
      return null;
    }

    return response.data.data.property;
  } catch (error) {
    console.error("Error fetching property details:", error.message);
    return null;
  }
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true in production with HTTPS
  })
);

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Initiate OAuth flow
app.get("/auth/login", (req, res) => {
  const authUrl =
    `${config.JOBBER_AUTH_URL}?` +
    `client_id=${encodeURIComponent(config.JOBBER_CLIENT_ID)}&` +
    `redirect_uri=${encodeURIComponent(config.REDIRECT_URI)}&` +
    `response_type=code&`;
  res.redirect(authUrl);
});

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect("/?error=" + encodeURIComponent(error));
  }

  if (!code) {
    return res.redirect("/?error=invalid_request");
  }

  try {
    // Exchange authorization code for access token
    const tokenResponse = await axios.post(
      config.JOBBER_TOKEN_URL,
      {
        grant_type: "authorization_code",
        client_id: config.JOBBER_CLIENT_ID,
        client_secret: config.JOBBER_CLIENT_SECRET,
        code: code,
        redirect_uri: config.REDIRECT_URI,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }
    );

    const { access_token, refresh_token } = tokenResponse.data;

    // Store tokens in session
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;

    // Also store token for webhook use
    storedAccessToken = access_token;
    console.log("Access token stored for webhook property lookups");

    res.redirect("/?authenticated=true");
  } catch (error) {
    console.error(
      "Token exchange error:",
      error.response?.data || error.message
    );
    res.redirect("/?error=token_exchange_failed");
  }
});

// Check authentication status
app.get("/api/auth/status", (req, res) => {
  res.json({
    authenticated: !!req.session.accessToken,
    hasToken: !!req.session.accessToken,
  });
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Create vehicle endpoint
app.post("/api/vehicles", async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { name, make, model, year } = req.body;

  if (!name || !make || !model || !year) {
    return res
      .status(400)
      .json({ error: "Name, make, model, and year are required" });
  }

  const mutation = `
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
          message
          path
        }
      }
    }
  `;

  const variables = {
    input: {
      name: name,
      make: make,
      model: model,
      year: parseInt(year),
    },
  };

  try {
    // Make GraphQL request to create vehicle
    const response = await axios.post(
      config.JOBBER_GRAPHQL_URL,
      {
        query: mutation,
        variables: variables,
      },
      {
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-JOBBER-GRAPHQL-VERSION": config.API_VERSION,
        },
      }
    );

    // Check for GraphQL errors
    if (response.data.errors) {
      return res.status(400).json({
        error: "GraphQL errors",
        details: response.data.errors,
      });
    }

    const vehicleResult = response.data.data.vehicleCreate;

    // Check for user validation errors
    if (vehicleResult.userErrors && vehicleResult.userErrors.length > 0) {
      return res.status(400).json({
        error: "Validation errors",
        details: vehicleResult.userErrors,
      });
    }

    // Success - return the created vehicle
    res.json({ success: true, vehicle: vehicleResult.vehicle });
  } catch (error) {
    // Handle authentication errors
    if (error.response?.status === 401 || error.response?.status === 403) {
      req.session.destroy();
      return res.status(401).json({
        error: "Authentication expired",
        needsReauth: true,
      });
    }

    res.status(500).json({
      error: "Failed to create vehicle",
      details: error.response?.data || error.message,
    });
  }
});

// Webhook endpoint for PROPERTY_CREATE events
app.post("/webhooks/property", async (req, res) => {
  // Acknowledge receipt immediately (Jobber expects quick response)
  res.status(200).json({ received: true });

  const propertyId = req.body.itemId;
  console.log("Webhook received for property:", propertyId);

  // Fetch property details from Jobber API
  let propertyDetails = null;
  if (propertyId) {
    propertyDetails = await fetchPropertyDetails(propertyId);
    console.log("Property details fetched:", propertyDetails);
  }

  const event = {
    id: Date.now(),
    receivedAt: new Date().toISOString(),
    headers: {
      "content-type": req.headers["content-type"],
      "x-jobber-topic": req.headers["x-jobber-topic"],
      "x-jobber-hmac-sha256": req.headers["x-jobber-hmac-sha256"],
    },
    webhookPayload: req.body,
    propertyDetails: propertyDetails,
  };

  console.log("Full event:", JSON.stringify(event, null, 2));

  // Add to events array (most recent first)
  webhookEvents.unshift(event);

  // Keep only the last MAX_EVENTS
  if (webhookEvents.length > MAX_EVENTS) {
    webhookEvents.pop();
  }
});

// Get webhook events for the frontend
app.get("/api/webhooks/events", (req, res) => {
  res.json({ events: webhookEvents });
});

// Clear webhook events
app.delete("/api/webhooks/events", (req, res) => {
  webhookEvents.length = 0;
  res.json({ success: true });
});

// Start server
app.listen(config.PORT, () => {
  console.log(`Server running on http://localhost:${config.PORT}`);
  console.log(
    `Click here to start OAuth flow: http://localhost:${config.PORT}/auth/login`
  );
});
