import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_SECRET;
const BASE_URL = "https://api-m.sandbox.paypal.com";
const PORT = process.env.PORT || 3000;

let cachedToken = null;
let tokenExpiry = 0;

// Get access token (cached)
async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) return cachedToken;

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
  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 60) * 1000; // buffer 60s
  return cachedToken;
}

// Create order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, payeeEmail } = req.body;
    const token = await getAccessToken();

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
      }),
    });

    const order = await orderRes.json();
    res.json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// Capture order
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
    console.error(error);
    res.status(500).json({ error: "Failed to capture order" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
