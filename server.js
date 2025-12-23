const express = require("express");
const axios = require("axios");
const session = require("express-session");
const path = require("path");
const config = require("./config");

const app = express();

// Store webhook events in memory
const webhookEvents = [];
const MAX_EVENTS = 50;

// Store access token for webhook use
let storedAccessToken = null;
let disconnectedViaWebhook = false;

// ATTOM API configuration
const ATTOM_API_KEY = "f0e8cff35b5080b3ede1b209dadb875f";
const ATTOM_API_URL =
  "https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile";

// Helper: Disconnect app from Jobber
async function disconnectFromJobber(accessToken) {
  if (!accessToken) return false;

  try {
    const response = await axios.post(
      config.JOBBER_GRAPHQL_URL,
      {
        query: `mutation { appDisconnect { app { id } userErrors { message } } }`,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-JOBBER-GRAPHQL-VERSION": config.API_VERSION,
        },
      }
    );
    console.log("Disconnected from Jobber:", response.data);
    return true;
  } catch (error) {
    console.error("Error disconnecting:", error.message);
    return false;
  }
}

// Helper: Fetch property data from ATTOM API
async function fetchAttomPropertyData(address) {
  if (!address || !address.street1) return null;

  try {
    // Format address1: street number and name (e.g., "1001 W JEFFERSON AVE")
    const address1 = address.street1.toUpperCase();

    // Format address2: city, state/province postalCode (e.g., "DETROIT, MI 48226")
    const address2Parts = [
      address.city,
      address.province,
      address.postalCode,
    ].filter(Boolean);
    const address2 = address2Parts.join(", ").toUpperCase();

    console.log("Fetching ATTOM data for:", { address1, address2 });

    const response = await axios.get(ATTOM_API_URL, {
      params: { address1, address2 },
      headers: {
        Accept: "application/json",
        apikey: ATTOM_API_KEY,
      },
    });

    console.log("ATTOM response received");
    return response.data;
  } catch (error) {
    console.error(
      "Error fetching ATTOM data:",
      error.response?.data || error.message
    );
    return { error: error.response?.data || error.message };
  }
}

// Helper: Fetch property details from Jobber
async function fetchPropertyDetails(propertyId) {
  if (!storedAccessToken) return null;

  try {
    const response = await axios.post(
      config.JOBBER_GRAPHQL_URL,
      {
        query: `query($id: EncodedId!) { property(id: $id) { address { street1 street2 city province country postalCode } } }`,
        variables: { id: propertyId },
      },
      {
        headers: {
          Authorization: `Bearer ${storedAccessToken}`,
          "Content-Type": "application/json",
          "X-JOBBER-GRAPHQL-VERSION": config.API_VERSION,
        },
      }
    );
    return response.data.data?.property;
  } catch (error) {
    console.error("Error fetching property:", error.message);
    return null;
  }
}

// Middleware
app.use(express.json());
app.use(express.static("public"));
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

// OAuth: Login
app.get("/auth/login", (req, res) => {
  const authUrl = `${config.JOBBER_AUTH_URL}?client_id=${
    config.JOBBER_CLIENT_ID
  }&redirect_uri=${encodeURIComponent(config.REDIRECT_URI)}&response_type=code`;
  res.redirect(authUrl);
});

// OAuth: Callback
app.get("/auth/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code)
    return res.redirect("/?error=" + (error || "invalid_request"));

  try {
    const response = await axios.post(config.JOBBER_TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: config.JOBBER_CLIENT_ID,
      client_secret: config.JOBBER_CLIENT_SECRET,
      code,
      redirect_uri: config.REDIRECT_URI,
    });

    req.session.accessToken = response.data.access_token;
    storedAccessToken = response.data.access_token;
    disconnectedViaWebhook = false;
    console.log("Access token stored");
    res.redirect("/");
  } catch (err) {
    console.error("Token exchange failed:", err.message);
    res.redirect("/?error=token_exchange_failed");
  }
});

// Auth status
app.get("/api/auth/status", (req, res) => {
  res.json({
    authenticated: !!req.session.accessToken && !disconnectedViaWebhook,
  });
});

// Logout
app.post("/api/auth/logout", async (req, res) => {
  if (req.session.accessToken) {
    await disconnectFromJobber(req.session.accessToken);
  }
  storedAccessToken = null;
  req.session.destroy();
  res.json({ success: true });
});

// Webhook: APP_DISCONNECT
app.post("/webhooks/app-disconnect", (req, res) => {
  res.json({ received: true });
  console.log(
    "APP_DISCONNECT received:",
    req.body.data?.webHookEvent?.accountId
  );
  storedAccessToken = null;
  disconnectedViaWebhook = true;
  addWebhookEvent(req, null);
});

// Webhook: PROPERTY_CREATE
app.post("/webhooks/property", async (req, res) => {
  res.json({ received: true });
  const propertyId = req.body.data?.webHookEvent?.itemId;
  const propertyDetails = propertyId
    ? await fetchPropertyDetails(propertyId)
    : null;

  // Fetch ATTOM property data if we have an address
  let attomData = null;
  if (propertyDetails?.address) {
    attomData = await fetchAttomPropertyData(propertyDetails.address);
  }

  addWebhookEvent(req, propertyDetails, attomData);
});

function addWebhookEvent(req, propertyDetails, attomData = null) {
  webhookEvents.unshift({
    id: Date.now(),
    receivedAt: new Date().toISOString(),
    headers: {
      "x-jobber-topic": req.headers["x-jobber-topic"],
    },
    webhookPayload: req.body,
    propertyDetails,
    attomData,
  });
  if (webhookEvents.length > MAX_EVENTS) webhookEvents.pop();
}

// Get/clear webhook events
app.get("/api/webhooks/events", (req, res) =>
  res.json({ events: webhookEvents })
);
app.delete("/api/webhooks/events", (req, res) => {
  webhookEvents.length = 0;
  res.json({ success: true });
});

// Start server
app.listen(config.PORT, () => {
  console.log(`Server: http://localhost:${config.PORT}`);
});
