// DOM elements
const loginSection = document.getElementById("login-section");
const authenticatedSection = document.getElementById("authenticated-section");
const vehicleForm = document.getElementById("vehicle-form");
const createVehicleForm = document.getElementById("create-vehicle-form");
const loadingDiv = document.getElementById("loading");
const successMessage = document.getElementById("success-message");
const errorMessage = document.getElementById("error-message");
const errorText = document.getElementById("error-text");
const logoutBtn = document.getElementById("logout-btn");
const vehicleDetails = document.getElementById("vehicle-details");

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
  vehicleForm.style.display = "none";
  hideMessages();
}

// Show authenticated state
function showAuthenticatedState() {
  loginSection.style.display = "none";
  authenticatedSection.style.display = "block";
  vehicleForm.style.display = "block";
  hideMessages();
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

// Handle vehicle creation form submission
async function handleVehicleSubmit(event) {
  event.preventDefault();

  const formData = new FormData(createVehicleForm);
  const vehicleData = {
    name: formData.get("name").trim(),
    make: formData.get("make").trim(),
    model: formData.get("model").trim(),
    year: formData.get("year"),
  };

  // Basic validation
  if (
    !vehicleData.name ||
    !vehicleData.make ||
    !vehicleData.model ||
    !vehicleData.year
  ) {
    showError("Please fill in all required fields.");
    return;
  }

  const year = parseInt(vehicleData.year);
  if (year < 1900 || year > 2030) {
    showError("Please enter a valid year between 1900 and 2030.");
    return;
  }

  // Show loading state
  showLoading();

  try {
    const response = await fetch("/api/vehicles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vehicleData),
    });

    const result = await response.json();

    if (response.ok && result.success) {
      showSuccess(result.vehicle);
      createVehicleForm.reset();
    } else {
      if (result.needsReauth) {
        showError("Your session has expired. Please log in again.");
        setTimeout(() => {
          showLoginState();
        }, 2000);
      } else if (result.details && Array.isArray(result.details)) {
        // Handle validation errors
        const errorMessages = result.details
          .map(
            (err) =>
              `${err.path ? err.path.join(".") : err.field || "field"}: ${
                err.message
              }`
          )
          .join(", ");
        showError(`Validation errors: ${errorMessages}`);
      } else {
        showError(
          result.error || "Failed to create vehicle. Please try again."
        );
      }
    }
  } catch (error) {
    console.error("Vehicle creation error:", error);
    showError("Network error. Please check your connection and try again.");
  } finally {
    hideLoading();
  }
}

// Show loading state
function showLoading() {
  loadingDiv.style.display = "block";
  hideMessages();

  // Disable form
  const submitBtn = createVehicleForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
}

// Hide loading state
function hideLoading() {
  loadingDiv.style.display = "none";

  // Enable form
  const submitBtn = createVehicleForm.querySelector('button[type="submit"]');
  submitBtn.disabled = false;
}

// Show success message
function showSuccess(vehicle) {
  hideMessages();

  vehicleDetails.innerHTML = `
        <strong>Vehicle Details:</strong><br>
        <small>
            ID: ${vehicle.id}<br>
            Name: ${vehicle.name}<br>
            Make: ${vehicle.make}<br>
            Model: ${vehicle.model}<br>
            Year: ${vehicle.year}
        </small>
    `;

  successMessage.style.display = "block";

  // Auto-hide success message after 5 seconds
  setTimeout(() => {
    successMessage.style.display = "none";
  }, 5000);
}

// Show error message
function showError(message) {
  hideMessages();
  errorText.textContent = message;
  errorMessage.style.display = "block";

  // Auto-hide error message after 10 seconds
  setTimeout(() => {
    errorMessage.style.display = "none";
  }, 10000);
}

// Hide all messages
function hideMessages() {
  successMessage.style.display = "none";
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
createVehicleForm.addEventListener("submit", handleVehicleSubmit);

// Handle form input validation feedback
const inputs = document.querySelectorAll("input[required]");
inputs.forEach((input) => {
  input.addEventListener("invalid", function () {
    this.classList.add("is-invalid");
  });

  input.addEventListener("input", function () {
    if (this.validity.valid) {
      this.classList.remove("is-invalid");
      this.classList.add("is-valid");
    } else {
      this.classList.remove("is-valid");
      this.classList.add("is-invalid");
    }
  });
});
