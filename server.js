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

// Get PayPal access token (cached)
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    throw new Error("PayPal Client ID or Secret not set!");
  }

  const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString("base64");

  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();

  if (!data.access_token) {
    throw new Error("Failed to get access token from PayPal");
  }

  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 60) * 1000; // 60s buffer
  return cachedToken;
}

// Create PayPal order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, payeeEmail } = req.body;

    const token = await getAccessToken();

    // Generate a unique success token
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
          // Send dynamic success token in return URL
          return_url: `https://yourapp.com/paypal-success?token=${successToken}`,
          cancel_url: `https://yourapp.com/paypal-cancel`,
        },
      }),
    });

    const order = await orderRes.json();
    const approveLink = order.links?.find(link => link.rel === "approve")?.href;

    res.json({ orderID: order.id, approveLink, successToken });

  } catch (error) {
    console.error("❌ Error in create-order:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// Capture PayPal order
app.post("/capture-order", async (req, res) => {
  try {
    const { orderID } = req.body;

    const token = await getAccessToken();

    const captureRes = await fetch(`${BASE_URL}/v2/checkout/orders/${orderID}/capture`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
    });

    const captureData = await captureRes.json();

    res.json(captureData);

  } catch (error) {
    console.error("❌ Error in capture-order:", error);
    res.status(500).json({ error: "Failed to capture order" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
