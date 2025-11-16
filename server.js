import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const app = express();
app.use(express.json());

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const BASE_URL = "https://api-m.sandbox.paypal.com";
const PORT = process.env.PORT || 3000;

let cachedToken = null;
let tokenExpiry = 0;

// ---------------------------------------------
// Get Access Token (cached)
// ---------------------------------------------
async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && now < tokenExpiry) {
    console.log("Using cached PayPal token");
    return cachedToken;
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");

  console.log("Fetching new PayPal access token...");
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  console.log("PayPal token response:", data);

  if (!data.access_token) {
    throw new Error("Failed to get access token from PayPal");
  }

  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 60) * 1000;
  return cachedToken;
}

// ---------------------------------------------
// Create PayPal Order
// ---------------------------------------------
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, payeeEmail } = req.body;
    console.log("Received create-order request:", req.body);

    const token = await getAccessToken();
    console.log("Using token:", token);

    // Optional custom token for your tracking
    const successToken = crypto.randomBytes(8).toString("hex");

    const orderRes = await fetch(`${BASE_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: currency, value: amount },
            payee: { email_address: payeeEmail },
          },
        ],
        application_context: {
          return_url: "https://example.com/paypal-success",
          cancel_url: "https://example.com/paypal-cancel"
        }
      }),
    });

    const order = await orderRes.json();
    console.log("PayPal create-order response:", order);

    // IMPORTANT:
    // Inject your successToken WITHOUT breaking PayPal's structure
    order.successToken = successToken;

    // Return EXACT paypal structure so Swift works
    res.json(order);

  } catch (error) {
    console.error("❌ Error in create-order:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// ---------------------------------------------
// Capture Order
// ---------------------------------------------
app.post("/capture-order", async (req, res) => {
  try {
    const { orderID } = req.body;

    const token = await getAccessToken();

    const captureRes = await fetch(`${BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`
      },
    });

    const captureData = await captureRes.json();
    console.log("PayPal capture response:", captureData);

    res.json(captureData);

  } catch (error) {
    console.error("❌ Error in capture-order:", error);
    res.status(500).json({ error: "Failed to capture order" });
  }
});

// ---------------------------------------------
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
