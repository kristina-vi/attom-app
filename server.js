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

// Helper: Fetch property details
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
  addWebhookEvent(req, propertyDetails);
});

function addWebhookEvent(req, propertyDetails) {
  webhookEvents.unshift({
    id: Date.now(),
    receivedAt: new Date().toISOString(),
    headers: {
      "x-jobber-topic": req.headers["x-jobber-topic"],
    },
    webhookPayload: req.body,
    propertyDetails,
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
