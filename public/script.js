// DOM elements
const loginSection = document.getElementById("login-section");
const authenticatedSection = document.getElementById("authenticated-section");
const errorMessage = document.getElementById("error-message");
const errorText = document.getElementById("error-text");
const logoutBtn = document.getElementById("logout-btn");
const disconnectAlert = document.getElementById("disconnect-alert");
const acknowledgeDisconnectBtn = document.getElementById(
  "acknowledge-disconnect-btn"
);

// Initialize the application
async function init() {
  // Check URL parameters for authentication status or errors
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");
  const authenticated = urlParams.get("authenticated");

  if (error) {
    showError(getErrorMessage(error));
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (authenticated) {
    // Clean up URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Check authentication status
  await checkAuthStatus();
}

// Check if user is authenticated
async function checkAuthStatus() {
  try {
    const response = await fetch("/api/auth/status");
    const data = await response.json();

    if (data.authenticated) {
      showAuthenticatedState();
    } else {
      showLoginState();
    }
  } catch (error) {
    console.error("Error checking auth status:", error);
    showLoginState();
  }
}

// Show login state
function showLoginState() {
  loginSection.style.display = "block";
  authenticatedSection.style.display = "none";
  hideError();
}

// Show authenticated state
function showAuthenticatedState() {
  loginSection.style.display = "none";
  authenticatedSection.style.display = "block";
  hideError();
}

// Handle logout
async function logout() {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      showLoginState();
    }
  } catch (error) {
    console.error("Logout error:", error);
    showError("Failed to logout. Please try again.");
  }
}

// Show error message
function showError(message) {
  hideError();
  errorText.textContent = message;
  errorMessage.style.display = "block";

  // Auto-hide error message after 10 seconds
  setTimeout(() => {
    errorMessage.style.display = "none";
  }, 10000);
}

// Hide error message
function hideError() {
  errorMessage.style.display = "none";
}

// Get user-friendly error message
function getErrorMessage(error) {
  const errorMessages = {
    access_denied:
      "Access was denied. Please try again and authorize the application.",
    invalid_request:
      "Invalid request. Please try the authentication process again.",
    token_exchange_failed:
      "Failed to exchange authorization code for access token. Please try again.",
    server_error: "Server error occurred. Please try again later.",
    temporarily_unavailable:
      "Service is temporarily unavailable. Please try again later.",
  };

  return (
    errorMessages[error] || `Authentication error: ${error}. Please try again.`
  );
}

// Event listeners
document.addEventListener("DOMContentLoaded", init);
logoutBtn.addEventListener("click", logout);

// Webhook Events functionality
const webhookEventsContainer = document.getElementById("webhook-events");
const eventCountSpan = document.getElementById("event-count");
const clearEventsBtn = document.getElementById("clear-events-btn");

let knownEventIds = new Set();
let lastRenderedIds = [];

// Poll for webhook events
async function fetchWebhookEvents() {
  try {
    const response = await fetch("/api/webhooks/events");
    const data = await response.json();

    if (data.events && data.events.length > 0) {
      // Check if we have new events by comparing IDs
      const currentIds = data.events.map((e) => e.id);
      const hasNewEvents =
        currentIds.length !== lastRenderedIds.length ||
        currentIds.some((id, i) => id !== lastRenderedIds[i]);

      if (hasNewEvents) {
        renderWebhookEvents(data.events);
        lastRenderedIds = currentIds;
      }

      eventCountSpan.textContent = `${data.events.length} event${
        data.events.length !== 1 ? "s" : ""
      }`;
    } else {
      if (lastRenderedIds.length > 0) {
        // Events were cleared, re-render empty state
        renderWebhookEvents([]);
        lastRenderedIds = [];
      }
      eventCountSpan.textContent = "No events yet";
    }
  } catch (error) {
    console.error("Error fetching webhook events:", error);
  }
}

// Render webhook events
function renderWebhookEvents(events) {
  if (events.length === 0) {
    webhookEventsContainer.innerHTML = `
      <div class="text-center text-muted py-4">
        <i class="fas fa-inbox fa-3x mb-3"></i>
        <p>Waiting for webhook events...</p>
        <p class="small">Create a property in Jobber to see events here</p>
      </div>
    `;
    return;
  }

  const newEventIds = events
    .filter((e) => !knownEventIds.has(e.id))
    .map((e) => e.id);

  // Mark all current events as known
  events.forEach((e) => knownEventIds.add(e.id));

  webhookEventsContainer.innerHTML = events
    .map((event) => {
      const isNew = newEventIds.includes(event.id);

      const time = new Date(event.receivedAt).toLocaleString();
      const topic = event.headers["x-jobber-topic"] || "Unknown";
      const address = event.propertyDetails?.address;

      // Format address if available
      let addressHtml = "";
      if (address) {
        const addressParts = [
          address.street1,
          address.street2,
          address.city,
          address.province,
          address.postalCode,
          address.country,
        ].filter(Boolean);
        addressHtml = `
          <div class="property-address mt-2 p-2" style="background: #e8f5e9; border-radius: 8px;">
            <strong><i class="fas fa-map-marker-alt text-success"></i> Property Address:</strong>
            <div class="mt-1">${
              addressParts.join(", ") || "No address available"
            }</div>
          </div>
        `;
      } else {
        addressHtml = `
          <div class="property-address mt-2 p-2" style="background: #fff3e0; border-radius: 8px;">
            <i class="fas fa-exclamation-circle text-warning"></i> 
            <em>Property details not available (authenticate first)</em>
          </div>
        `;
      }

      return `
      <div class="webhook-event ${isNew ? "new" : ""}">
        <div class="d-flex justify-content-between align-items-start">
          <div>
            <strong><i class="fas fa-home"></i> ${topic}</strong>
          </div>
          <span class="webhook-event-time">${time}</span>
        </div>
        ${addressHtml}
        <details class="mt-2">
          <summary style="cursor: pointer; color: #666;">
            <i class="fas fa-code"></i> Raw webhook payload
          </summary>
          <div class="webhook-event-body">${JSON.stringify(
            event.webhookPayload || event.body,
            null,
            2
          )}</div>
        </details>
      </div>
    `;
    })
    .join("");
}

// Clear webhook events
async function clearWebhookEvents() {
  try {
    const response = await fetch("/api/webhooks/events", { method: "DELETE" });
    if (response.ok) {
      knownEventIds.clear();
      webhookEventsContainer.innerHTML = `
        <div class="text-center text-muted py-4">
          <i class="fas fa-inbox fa-3x mb-3"></i>
          <p>Waiting for webhook events...</p>
          <p class="small">Create a property in Jobber to see events here</p>
        </div>
      `;
      eventCountSpan.textContent = "No events yet";
    }
  } catch (error) {
    console.error("Error clearing events:", error);
  }
}

// Event listener for clear button
clearEventsBtn.addEventListener("click", clearWebhookEvents);

// Start polling for webhook events (every 2 seconds)
setInterval(fetchWebhookEvents, 2000);
fetchWebhookEvents(); // Initial fetch

// App Disconnect functionality
async function checkDisconnectStatus() {
  try {
    const response = await fetch("/api/app/disconnect-status");
    const data = await response.json();

    if (data.disconnected) {
      showDisconnectAlert();
    }
  } catch (error) {
    console.error("Error checking disconnect status:", error);
  }
}

function showDisconnectAlert() {
  disconnectAlert.style.display = "block";
  // Also update auth state to show login
  showLoginState();
}

async function acknowledgeDisconnect() {
  try {
    await fetch("/api/app/acknowledge-disconnect", { method: "POST" });
    disconnectAlert.style.display = "none";
  } catch (error) {
    console.error("Error acknowledging disconnect:", error);
  }
}

// Event listener for acknowledge button
acknowledgeDisconnectBtn.addEventListener("click", acknowledgeDisconnect);

// Poll for disconnect status (every 2 seconds)
setInterval(checkDisconnectStatus, 2000);
