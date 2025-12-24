const express = require("express");
const axios = require("axios");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const config = require("./config");

// Path to store custom field IDs
const CUSTOM_FIELDS_FILE = path.join(__dirname, "custom-fields.json");

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

// Custom field definitions
const CUSTOM_FIELD_DEFINITIONS = [
  { name: "Property Type", key: "propertyType" },
  { name: "Building Size", key: "buildingSize" },
  { name: "Lot Size", key: "lotSize" },
  { name: "Floors", key: "floors" },
  { name: "Bedrooms", key: "bedrooms" },
  { name: "Bathrooms", key: "bathrooms" },
];

// Helper: Load custom field IDs from file
function loadCustomFieldIds() {
  try {
    if (fs.existsSync(CUSTOM_FIELDS_FILE)) {
      const data = fs.readFileSync(CUSTOM_FIELDS_FILE, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error("Error loading custom field IDs:", error.message);
  }
  return {};
}

// Helper: Save custom field IDs to file
function saveCustomFieldIds(ids) {
  try {
    fs.writeFileSync(CUSTOM_FIELDS_FILE, JSON.stringify(ids, null, 2));
    console.log("Custom field IDs saved to", CUSTOM_FIELDS_FILE);
  } catch (error) {
    console.error("Error saving custom field IDs:", error.message);
  }
}

// Helper: Create a single custom field in Jobber
async function createCustomField(accessToken, fieldName) {
  try {
    const response = await axios.post(
      config.JOBBER_GRAPHQL_URL,
      {
        query: `
          mutation CustomFieldConfigurationCreate($name: String!) {
            customFieldConfigurationCreateText(
              input: {
                name: $name
                appliesTo: ALL_PROPERTIES
                transferable: false
                readOnly: true
              }
            ) {
              customFieldConfiguration {
                id
                name
              }
              userErrors {
                message
                path
              }
            }
          }
        `,
        variables: { name: fieldName },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-JOBBER-GRAPHQL-VERSION": config.API_VERSION,
        },
      }
    );

    const result = response.data.data?.customFieldConfigurationCreateText;
    if (result?.userErrors?.length > 0) {
      console.log(`Custom field "${fieldName}" error:`, result.userErrors);
      return null;
    }
    return result?.customFieldConfiguration;
  } catch (error) {
    console.error(`Error creating custom field "${fieldName}":`, error.message);
    return null;
  }
}

// Helper: Create all custom fields after OAuth
async function createAllCustomFields(accessToken) {
  const existingIds = loadCustomFieldIds();
  const allFieldsExist = CUSTOM_FIELD_DEFINITIONS.every(
    (def) => existingIds[def.key]
  );

  if (allFieldsExist) {
    console.log("All custom fields already exist");
    return existingIds;
  }

  console.log("Creating custom fields in Jobber...");
  const newIds = { ...existingIds };

  for (const def of CUSTOM_FIELD_DEFINITIONS) {
    if (!newIds[def.key]) {
      const created = await createCustomField(accessToken, def.name);
      if (created) {
        newIds[def.key] = created.id;
        console.log(`Created custom field: ${def.name} -> ${created.id}`);
      }
    }
  }

  saveCustomFieldIds(newIds);
  return newIds;
}

// Helper: Update property with ATTOM data
async function updatePropertyCustomFields(propertyId, attomData, accessToken) {
  if (!accessToken || !attomData || attomData.error) return null;

  const customFieldIds = loadCustomFieldIds();
  if (Object.keys(customFieldIds).length === 0) {
    console.log("No custom field IDs found, skipping property update");
    return null;
  }

  const property = attomData.property?.[0];
  if (!property) return null;

  const summary = property.summary || {};
  const building = property.building || {};
  const lot = property.lot || {};
  const rooms = building.rooms || {};

  // Build custom fields array with values from ATTOM
  const customFields = [];

  if (customFieldIds.propertyType) {
    const propType =
      summary.propertyType || summary.propType || summary.propSubType || "";
    if (propType) {
      customFields.push({
        customFieldConfigurationId: customFieldIds.propertyType,
        valueText: String(propType),
      });
    }
  }

  if (customFieldIds.buildingSize) {
    const bldgSize = building.size?.bldgSize;
    if (bldgSize) {
      customFields.push({
        customFieldConfigurationId: customFieldIds.buildingSize,
        valueText: `${bldgSize} sq ft`,
      });
    }
  }

  if (customFieldIds.lotSize) {
    const lotSize = lot.lotSize2;
    if (lotSize) {
      customFields.push({
        customFieldConfigurationId: customFieldIds.lotSize,
        valueText: `${lotSize} sq ft`,
      });
    }
  }

  if (customFieldIds.floors) {
    const levels = building.summary?.levels;
    if (levels) {
      customFields.push({
        customFieldConfigurationId: customFieldIds.floors,
        valueText: String(levels),
      });
    }
  }

  if (customFieldIds.bedrooms) {
    const beds = rooms.beds;
    if (beds !== undefined && beds !== null) {
      customFields.push({
        customFieldConfigurationId: customFieldIds.bedrooms,
        valueText: String(beds),
      });
    }
  }

  if (customFieldIds.bathrooms) {
    const baths = (rooms.bathsTotal || 0) + (rooms.bathsPartial || 0);
    if (baths > 0) {
      customFields.push({
        customFieldConfigurationId: customFieldIds.bathrooms,
        valueText: String(baths),
      });
    }
  }

  if (customFields.length === 0) {
    console.log("No custom field values to update");
    return null;
  }

  // Build custom fields array as inline GraphQL
  const customFieldsGql = customFields
    .map(
      (cf) =>
        `{ customFieldConfigurationId: "${
          cf.customFieldConfigurationId
        }", valueText: "${cf.valueText.replace(/"/g, '\\"')}" }`
    )
    .join(", ");

  try {
    const response = await axios.post(
      config.JOBBER_GRAPHQL_URL,
      {
        query: `
          mutation UpdatePropertyCustomFields {
            propertyEdit(
              propertyId: "${propertyId}"
              input: { customFields: [${customFieldsGql}] }
            ) {
              property {
                id
                customFields {
                  ... on CustomFieldText {
                    id
                    label
                    valueText
                  }
                }
              }
              userErrors {
                message
                path
              }
            }
          }
        `,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-JOBBER-GRAPHQL-VERSION": config.API_VERSION,
        },
      }
    );

    console.log(
      "Property update response:",
      JSON.stringify(response.data, null, 2)
    );
    const result = response.data.data?.propertyEdit;
    if (result?.userErrors?.length > 0) {
      console.error("Property update errors:", result.userErrors);
    } else {
      console.log("Property custom fields updated successfully");
    }
    return result;
  } catch (error) {
    console.error(
      "Error updating property:",
      error.response?.data || error.message
    );
    return null;
  }
}

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

    // Create custom fields after connection (async, don't block redirect)
    createAllCustomFields(storedAccessToken).catch(console.error);

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

  // Update property with ATTOM data via custom fields
  if (attomData && !attomData.error && propertyId && storedAccessToken) {
    await updatePropertyCustomFields(propertyId, attomData, storedAccessToken);
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
