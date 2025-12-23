// DOM elements
const loginSection = document.getElementById("login-section");
const authenticatedSection = document.getElementById("authenticated-section");
const errorMessage = document.getElementById("error-message");
const errorText = document.getElementById("error-text");
const webhookEventsContainer = document.getElementById("webhook-events");
const eventCountSpan = document.getElementById("event-count");

// Initialize
async function init() {
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");

  if (error) {
    showError(error);
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  const res = await fetch("/api/auth/status");
  const { authenticated } = await res.json();
  loginSection.style.display = authenticated ? "none" : "block";
  authenticatedSection.style.display = authenticated ? "block" : "none";
}

// Logout
document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  loginSection.style.display = "block";
  authenticatedSection.style.display = "none";
});

// Show error
function showError(message) {
  errorText.textContent = message;
  errorMessage.style.display = "block";
  setTimeout(() => (errorMessage.style.display = "none"), 10000);
}

// Webhook events
let lastEventIds = [];

async function fetchWebhookEvents() {
  try {
    const res = await fetch("/api/webhooks/events");
    const { events } = await res.json();

    const currentIds = events.map((e) => e.id);
    const hasChanges =
      currentIds.length !== lastEventIds.length ||
      currentIds.some((id, i) => id !== lastEventIds[i]);

    if (hasChanges) {
      renderEvents(events);
      lastEventIds = currentIds;
    }

    eventCountSpan.textContent = events.length
      ? `${events.length} event${events.length > 1 ? "s" : ""}`
      : "No events yet";
  } catch (err) {
    console.error("Error fetching events:", err);
  }
}

function renderEvents(events) {
  if (!events.length) {
    webhookEventsContainer.innerHTML = `
      <div class="text-center text-muted py-4">
        <i class="fas fa-inbox fa-3x mb-3"></i>
        <p>Waiting for webhook events...</p>
        <p class="small">Create a property in Jobber to see events here</p>
      </div>`;
    return;
  }

  webhookEventsContainer.innerHTML = events
    .map((event) => {
      const time = new Date(event.receivedAt).toLocaleString();
      const topic = event.headers["x-jobber-topic"] || "Unknown";
      const address = event.propertyDetails?.address;
      const attomData = event.attomData;

      // Jobber address section
      let addressHtml = "";
      if (address) {
        const parts = [
          address.street1,
          address.street2,
          address.city,
          address.province,
          address.postalCode,
          address.country,
        ].filter(Boolean);
        addressHtml = `
          <div class="mt-2 p-2" style="background: #e8f5e9; border-radius: 8px;">
            <strong><i class="fas fa-map-marker-alt text-success"></i> Jobber Address:</strong>
            <div class="mt-1">${parts.join(", ") || "No address"}</div>
          </div>`;
      } else {
        addressHtml = `
          <div class="mt-2 p-2" style="background: #fff3e0; border-radius: 8px;">
            <i class="fas fa-exclamation-circle text-warning"></i>
            <em>Property details not available (authenticate first)</em>
          </div>`;
      }

      // ATTOM data section
      let attomHtml = "";
      if (attomData && !attomData.error) {
        const property = attomData.property?.[0];
        if (property) {
          const summary = property.summary || {};
          const building = property.building || {};
          const lot = property.lot || {};

          attomHtml = `
            <div class="mt-2 p-2" style="background: #e3f2fd; border-radius: 8px;">
              <strong><i class="fas fa-building text-primary"></i> ATTOM Property Data:</strong>
              <div class="mt-2 small">
                ${
                  summary.propclass
                    ? `<div><strong>Property Class:</strong> ${summary.propclass}</div>`
                    : ""
                }
                ${
                  summary.proptype
                    ? `<div><strong>Property Type:</strong> ${summary.proptype}</div>`
                    : ""
                }
                ${
                  summary.yearbuilt
                    ? `<div><strong>Year Built:</strong> ${summary.yearbuilt}</div>`
                    : ""
                }
                ${
                  building.size?.bldgsize
                    ? `<div><strong>Building Size:</strong> ${building.size.bldgsize.toLocaleString()} sq ft</div>`
                    : ""
                }
                ${
                  building.rooms?.bathstotal
                    ? `<div><strong>Bathrooms:</strong> ${building.rooms.bathstotal}</div>`
                    : ""
                }
                ${
                  building.rooms?.beds
                    ? `<div><strong>Bedrooms:</strong> ${building.rooms.beds}</div>`
                    : ""
                }
                ${
                  lot.lotsize1
                    ? `<div><strong>Lot Size:</strong> ${lot.lotsize1.toLocaleString()} sq ft</div>`
                    : ""
                }
              </div>
              <details class="mt-2">
                <summary style="cursor: pointer; color: #1976d2; font-size: 0.85rem;">
                  <i class="fas fa-database"></i> Full ATTOM Response
                </summary>
                <div class="webhook-event-body">${JSON.stringify(
                  attomData,
                  null,
                  2
                )}</div>
              </details>
            </div>`;
        }
      } else if (attomData?.error) {
        attomHtml = `
          <div class="mt-2 p-2" style="background: #ffebee; border-radius: 8px;">
            <i class="fas fa-times-circle text-danger"></i>
            <strong>ATTOM Error:</strong>
            <div class="small mt-1">${JSON.stringify(attomData.error)}</div>
          </div>`;
      }

      return `
        <div class="webhook-event">
          <div class="d-flex justify-content-between align-items-start">
            <strong><i class="fas fa-home"></i> ${topic}</strong>
            <span class="webhook-event-time">${time}</span>
          </div>
          ${addressHtml}
          ${attomHtml}
          <details class="mt-2">
            <summary style="cursor: pointer; color: #666;">
              <i class="fas fa-code"></i> Raw webhook payload
            </summary>
            <div class="webhook-event-body">${JSON.stringify(
              event.webhookPayload,
              null,
              2
            )}</div>
          </details>
        </div>`;
    })
    .join("");
}

// Clear events
document
  .getElementById("clear-events-btn")
  .addEventListener("click", async () => {
    await fetch("/api/webhooks/events", { method: "DELETE" });
    lastEventIds = [];
    renderEvents([]);
  });

// Check auth status (for disconnect detection)
async function checkAuthStatus() {
  const res = await fetch("/api/auth/status");
  const { authenticated } = await res.json();
  loginSection.style.display = authenticated ? "none" : "block";
  authenticatedSection.style.display = authenticated ? "block" : "none";
}

// Start
init();
setInterval(fetchWebhookEvents, 2000);
setInterval(checkAuthStatus, 2000);
fetchWebhookEvents();
