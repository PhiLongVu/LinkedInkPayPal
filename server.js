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
  if (cachedToken && now < tokenExpiry) return cachedToken;

  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) throw new Error("PayPal credentials not set");

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
  if (!data.access_token) throw new Error("Failed to get access token");

  cachedToken = data.access_token;
  tokenExpiry = now + (data.expires_in - 60) * 1000; // 60s buffer
  return cachedToken;
}

// Create PayPal order
app.post("/create-order", async (req, res) => {
  try {
    const { amount, currency, payeeEmail } = req.body;
    const token = await getAccessToken();

    const successToken = crypto.randomBytes(8).toString("hex");

    const orderRes = await fetch(`${BASE_URL}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
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
          return_url: `https://yourapp.com/paypal-success?token=${successToken}`,
          cancel_url: `https://yourapp.com/paypal-cancel`,
        },
      }),
    });

    const order = await orderRes.json();

    if (!order || !Array.isArray(order.links)) {
      console.error("❌ Invalid PayPal response:", order);
      return res.status(500).json({ error: "Invalid PayPal order response" });
    }

    const approveLinkObj = order.links.find(link => link.rel === "approve");
    if (!approveLinkObj || !approveLinkObj.href) {
      console.error("❌ No approve link in PayPal order:", order);
      return res.status(500).json({ error: "PayPal approve link not found" });
    }

    res.json({ orderID: order.id, approveLink: approveLinkObj.href, successToken });

  } catch (err) {
    console.error("❌ Error creating PayPal order:", err);
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

  } catch (err) {
    console.error("❌ Error capturing PayPal order:", err);
    res.status(500).json({ error: "Failed to capture order" });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
