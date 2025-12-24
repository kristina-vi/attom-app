const express = require("express");
const axios = require("axios");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const config = require("./config");

const app = express();
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

// Webhook events (in-memory)
const webhookEvents = [];
const MAX_EVENTS = 50;

// ATTOM API
const ATTOM_API_KEY = "f0e8cff35b5080b3ede1b209dadb875f";
const ATTOM_API_URL =
  "https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/basicprofile";

// ============ CUSTOM FIELDS CONFIG ============

// All available fields with ATTOM data extractors
const ALL_FIELDS = {
  propertyType: {
    name: "Property Type",
    getValue: (p) =>
      p.summary?.propertyType || p.summary?.propType || p.summary?.propSubType,
  },
  buildingSize: {
    name: "Building Size",
    getValue: (p) =>
      p.building?.size?.bldgSize ? `${p.building.size.bldgSize} sq ft` : null,
  },
  lotSize: {
    name: "Lot Size",
    getValue: (p) => (p.lot?.lotSize2 ? `${p.lot.lotSize2} sq ft` : null),
  },
  floors: {
    name: "Floors",
    getValue: (p) => p.building?.summary?.levels,
  },
  bedrooms: {
    name: "Bedrooms",
    getValue: (p) => p.building?.rooms?.beds,
  },
  bathrooms: {
    name: "Bathrooms",
    getValue: (p) => {
      const total =
        (p.building?.rooms?.bathsTotal || 0) +
        (p.building?.rooms?.bathsPartial || 0);
      return total > 0 ? total : null;
    },
  },
  heatingType: {
    name: "Heating Type",
    getValue: (p) => p.utilities?.heatingType,
  },
  coolingType: {
    name: "Cooling Type",
    getValue: (p) => p.utilities?.coolingType,
  },
  yearBuilt: {
    name: "Year Built",
    getValue: (p) => p.summary?.yearBuilt,
  },
  zoning: {
    name: "Zoning",
    getValue: (p) => p.lot?.zoningType,
  },
};

// Industry -> field keys
const INDUSTRY_FIELDS = {
  RESIDENTIAL_CLEANING: ["buildingSize", "floors", "bathrooms", "propertyType"],
  LAWN_CARE_LAWN_MAINTENANCE: ["lotSize", "propertyType", "zoning"],
  HVAC: ["buildingSize", "heatingType", "coolingType", "yearBuilt"],
};

// Default fields for other industries
const DEFAULT_FIELDS = [
  "propertyType",
  "buildingSize",
  "lotSize",
  "floors",
  "bedrooms",
  "bathrooms",
];

function getFieldsForIndustry(industry) {
  return INDUSTRY_FIELDS[industry] || DEFAULT_FIELDS;
}

// ============ ACCOUNTS STORAGE ============

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
    }
  } catch (e) {
    console.error("Error loading accounts:", e.message);
  }
  return {};
}

function saveAccounts(accounts) {
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
}

function getAccount(accountId) {
  return loadAccounts()[accountId];
}

function saveAccount(accountId, data) {
  const accounts = loadAccounts();
  accounts[accountId] = { ...accounts[accountId], ...data };
  saveAccounts(accounts);
}

// ============ JOBBER API HELPERS ============

async function jobberQuery(accessToken, query, variables = {}) {
  const response = await axios.post(
    config.JOBBER_GRAPHQL_URL,
    { query, variables },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-JOBBER-GRAPHQL-VERSION": config.API_VERSION,
      },
    }
  );
  return response.data;
}

async function getAccountInfo(accessToken) {
  const result = await jobberQuery(
    accessToken,
    `query { account { id industry } }`
  );
  return result.data?.account;
}

async function createCustomField(accessToken, name) {
  const result = await jobberQuery(
    accessToken,
    `mutation($name: String!) {
      customFieldConfigurationCreateText(input: { name: $name, appliesTo: ALL_PROPERTIES, transferable: false, readOnly: true }) {
        customFieldConfiguration { id name }
        userErrors { message }
      }
    }`,
    { name }
  );
  return result.data?.customFieldConfigurationCreateText
    ?.customFieldConfiguration;
}

async function fetchPropertyDetails(accessToken, propertyId) {
  const result = await jobberQuery(
    accessToken,
    `query($id: EncodedId!) { property(id: $id) { address { street1 street2 city province country postalCode } } }`,
    { id: propertyId }
  );
  return result.data?.property;
}

async function updatePropertyFields(accessToken, propertyId, customFields) {
  const fieldsGql = customFields
    .map(
      (cf) =>
        `{ customFieldConfigurationId: "${cf.id}", valueText: "${String(
          cf.value
        ).replace(/"/g, '\\"')}" }`
    )
    .join(", ");

  const result = await jobberQuery(
    accessToken,
    `mutation { propertyEdit(propertyId: "${propertyId}", input: { customFields: [${fieldsGql}] }) { property { id } userErrors { message } } }`
  );

  if (result.data?.propertyEdit?.userErrors?.length > 0) {
    console.error(
      "Property update errors:",
      result.data.propertyEdit.userErrors
    );
  } else {
    console.log("Property custom fields updated successfully");
  }
  return result;
}

async function disconnectFromJobber(accessToken) {
  try {
    await jobberQuery(
      accessToken,
      `mutation { appDisconnect { app { id } userErrors { message } } }`
    );
    return true;
  } catch (e) {
    console.error("Error disconnecting:", e.message);
    return false;
  }
}

// ============ SETUP ACCOUNT ============

async function setupAccount(accessToken) {
  const accountInfo = await getAccountInfo(accessToken);
  if (!accountInfo) throw new Error("Could not get account info");

  const { id: accountId, industry } = accountInfo;
  console.log(`Setting up account ${accountId} (${industry})`);

  // Check if already set up
  const existing = getAccount(accountId);
  if (existing?.customFields && Object.keys(existing.customFields).length > 0) {
    console.log("Account already set up, updating token");
    saveAccount(accountId, { accessToken });
    return accountId;
  }

  // Create custom fields for this industry
  const fieldKeys = getFieldsForIndustry(industry);
  const customFields = {};

  console.log(`Creating custom fields for ${industry}:`, fieldKeys);
  for (const key of fieldKeys) {
    const field = ALL_FIELDS[key];
    const created = await createCustomField(accessToken, field.name);
    if (created) {
      customFields[key] = created.id;
      console.log(`Created: ${field.name} -> ${created.id}`);
    }
  }

  saveAccount(accountId, { accessToken, industry, customFields });
  console.log("Account setup complete");
  return accountId;
}

// ============ ATTOM API ============

async function fetchAttomData(address) {
  if (!address?.street1) return null;

  try {
    const address1 = address.street1.toUpperCase();
    const address2 = [address.city, address.province, address.postalCode]
      .filter(Boolean)
      .join(", ")
      .toUpperCase();

    console.log("Fetching ATTOM data:", { address1, address2 });
    const response = await axios.get(ATTOM_API_URL, {
      params: { address1, address2 },
      headers: { Accept: "application/json", apikey: ATTOM_API_KEY },
    });
    console.log("ATTOM response received");
    return response.data;
  } catch (e) {
    console.error("ATTOM error:", e.response?.data || e.message);
    return { error: e.response?.data || e.message };
  }
}

// ============ PROCESS PROPERTY WEBHOOK ============

async function processPropertyWebhook(accountId, propertyId) {
  const account = getAccount(accountId);
  if (!account?.accessToken) {
    console.log("No token for account", accountId);
    return { propertyDetails: null, attomData: null };
  }

  // Fetch property details
  const propertyDetails = await fetchPropertyDetails(
    account.accessToken,
    propertyId
  );
  if (!propertyDetails?.address) {
    return { propertyDetails, attomData: null };
  }

  // Fetch ATTOM data
  const attomData = await fetchAttomData(propertyDetails.address);
  if (!attomData || attomData.error) {
    return { propertyDetails, attomData };
  }

  // Extract values and update property
  const attomProperty = attomData.property?.[0];
  if (attomProperty && account.customFields) {
    const fieldsToUpdate = [];

    for (const [key, fieldId] of Object.entries(account.customFields)) {
      const fieldDef = ALL_FIELDS[key];
      const value = fieldDef?.getValue(attomProperty);
      if (value !== null && value !== undefined) {
        fieldsToUpdate.push({ id: fieldId, value });
      }
    }

    if (fieldsToUpdate.length > 0) {
      await updatePropertyFields(
        account.accessToken,
        propertyId,
        fieldsToUpdate
      );
    }
  }

  return { propertyDetails, attomData };
}

// ============ EXPRESS SETUP ============

app.use(express.json());
app.use(express.static("public"));
app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

// OAuth
app.get("/auth/login", (req, res) => {
  res.redirect(
    `${config.JOBBER_AUTH_URL}?client_id=${
      config.JOBBER_CLIENT_ID
    }&redirect_uri=${encodeURIComponent(
      config.REDIRECT_URI
    )}&response_type=code`
  );
});

app.get("/auth/callback", async (req, res) => {
  const { code, error } = req.query;
  if (error || !code)
    return res.redirect("/?error=" + (error || "invalid_request"));

  try {
    const tokenResponse = await axios.post(config.JOBBER_TOKEN_URL, {
      grant_type: "authorization_code",
      client_id: config.JOBBER_CLIENT_ID,
      client_secret: config.JOBBER_CLIENT_SECRET,
      code,
      redirect_uri: config.REDIRECT_URI,
    });

    const accessToken = tokenResponse.data.access_token;
    req.session.accessToken = accessToken;

    // Setup account (async, don't block redirect)
    setupAccount(accessToken).catch(console.error);

    res.redirect("/");
  } catch (e) {
    console.error("Token exchange failed:", e.message);
    res.redirect("/?error=token_exchange_failed");
  }
});

app.get("/api/auth/status", (req, res) => {
  res.json({ authenticated: !!req.session.accessToken });
});

app.post("/api/auth/logout", async (req, res) => {
  if (req.session.accessToken) {
    await disconnectFromJobber(req.session.accessToken);
  }
  req.session.destroy();
  res.json({ success: true });
});

// Webhooks
app.post("/webhooks/app-disconnect", (req, res) => {
  res.json({ received: true });
  const accountId = req.body.data?.webHookEvent?.accountId;
  console.log("APP_DISCONNECT:", accountId);

  if (accountId) {
    saveAccount(accountId, { accessToken: null });
  }

  addWebhookEvent(req, null, null);
});

app.post("/webhooks/property", async (req, res) => {
  res.json({ received: true });

  const accountId = req.body.data?.webHookEvent?.accountId;
  const propertyId = req.body.data?.webHookEvent?.itemId;

  const { propertyDetails, attomData } = await processPropertyWebhook(
    accountId,
    propertyId
  );
  addWebhookEvent(req, propertyDetails, attomData);
});

function addWebhookEvent(req, propertyDetails, attomData) {
  webhookEvents.unshift({
    id: Date.now(),
    receivedAt: new Date().toISOString(),
    headers: { "x-jobber-topic": req.headers["x-jobber-topic"] },
    webhookPayload: req.body,
    propertyDetails,
    attomData,
  });
  if (webhookEvents.length > MAX_EVENTS) webhookEvents.pop();
}

app.get("/api/webhooks/events", (req, res) =>
  res.json({ events: webhookEvents })
);
app.delete("/api/webhooks/events", (req, res) => {
  webhookEvents.length = 0;
  res.json({ success: true });
});

// Start
app.listen(config.PORT, () =>
  console.log(`Server: http://localhost:${config.PORT}`)
);
