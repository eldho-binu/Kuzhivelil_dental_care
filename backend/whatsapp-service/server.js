const express = require("express");
const cors = require("cors");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();

app.use(cors());
app.use(express.json());

let latestQR = null;
let connected = false;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage"
        ]
    }
});

client.on("qr", async (qr) => {
    console.log("📱 QR Code Generated");

    try {
        latestQR = await QRCode.toDataURL(qr);
    } catch (err) {
        console.error(err);
    }
});

client.on("ready", () => {
    connected = true;
    latestQR = null;

    console.log("✅ WhatsApp is ready!");
});

client.on("authenticated", () => {
    console.log("✅ WhatsApp Authenticated");
});

client.on("auth_failure", (msg) => {
    connected = false;
    console.log("❌ Authentication Failed:", msg);
});

client.on("disconnected", (reason) => {
    connected = false;
    console.log("⚠ WhatsApp Disconnected:", reason);
});

client.initialize();

app.get("/", (req, res) => {
    res.send("WhatsApp Service Running");
});

app.get("/status", (req, res) => {
    res.json({
        connected
    });
});

app.get("/qr", (req, res) => {

    if (connected) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>WhatsApp Status</title>
            </head>
            <body style="font-family:Arial;text-align:center;margin-top:100px;">
                <h2>✅ WhatsApp Already Connected</h2>
            </body>
            </html>
        `);
    }

    if (!latestQR) {
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Waiting</title>
                <meta http-equiv="refresh" content="3">
            </head>
            <body style="font-family:Arial;text-align:center;margin-top:100px;">
                <h2>Waiting for QR Code...</h2>
                <p>This page refreshes automatically.</p>
            </body>
            </html>
        `);
    }

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Scan WhatsApp QR</title>
            <meta http-equiv="refresh" content="5">
        </head>
        <body style="
            font-family:Arial;
            display:flex;
            justify-content:center;
            align-items:center;
            flex-direction:column;
            height:100vh;
        ">
            <h2>Scan this QR using WhatsApp</h2>

            <img src="${latestQR}" width="320"/>

            <p>
                WhatsApp → Settings → Linked Devices → Link a Device
            </p>
        </body>
        </html>
    `);
});

app.post("/send", async (req, res) => {
    console.log("📨 Received /send request");
    console.log("Request Body:", req.body);

    try {
        const { phone, message } = req.body;

        const chatId = `${phone}@c.us`;

        console.log("📱 Sending message to:", chatId);

        await client.sendMessage(chatId, message);

        console.log("✅ Message sent successfully!");

        res.json({
            success: true
        });

    } catch (err) {
        console.error("❌ Send Error:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});