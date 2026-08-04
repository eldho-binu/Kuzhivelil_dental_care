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
    authStrategy: new LocalAuth({
        dataPath: "./.wwebjs_auth"
    }),
    puppeteer: {
        headless: true,
        protocolTimeout: 300000,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--window-size=1280,720"
        ]
    }
});

client.on("qr", async (qr) => {
    console.log("📱 QR Code Generated");
    connected = false;

    try {
        latestQR = await QRCode.toDataURL(qr);
    } catch (e) {
        console.error(e);
    }
});

client.on("authenticated", () => {
    console.log("✅ WhatsApp Authenticated");
});

client.on("loading_screen", (percent, message) => {
    console.log(`Loading ${percent}% - ${message}`);
});

client.on("change_state", (state) => {
    console.log("State:", state);
});

client.on("ready", () => {
    console.log("✅ WhatsApp is ready!");
    connected = true;
    latestQR = null;
});

client.on("auth_failure", (msg) => {
    connected = false;
    console.log("❌ Auth Failure:", msg);
});

client.on("disconnected", (reason) => {
    connected = false;
    console.log("⚠ Disconnected:", reason);
});

client.initialize();

app.get("/", (req, res) => {
    res.send("WhatsApp Service Running");
});

app.get("/status", (req, res) => {
    res.json({ connected });
});

app.get("/qr", (req, res) => {
    if (connected) {
        return res.send("<h2>✅ WhatsApp Already Connected</h2>");
    }

    if (!latestQR) {
        return res.send(`
        <html>
        <head><meta http-equiv="refresh" content="3"></head>
        <body style="font-family:Arial;text-align:center;margin-top:100px">
        <h2>Waiting for QR...</h2>
        </body>
        </html>
        `);
    }

    res.send(`
    <html>
    <head><meta http-equiv="refresh" content="5"></head>
    <body style="display:flex;justify-content:center;align-items:center;flex-direction:column;height:100vh;font-family:Arial">
        <h2>Scan QR</h2>
        <img src="${latestQR}" width="320">
    </body>
    </html>
    `);
});

app.post("/send", async (req, res) => {

    try {

        if (!connected) {
            return res.status(400).json({
                success: false,
                error: "WhatsApp not connected"
            });
        }

        const { phone, message } = req.body;

        console.log("Sending to", phone);

        await client.sendMessage(`${phone}@c.us`, message);

        console.log("✅ Message Sent");

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log("🚀 Server running on port", PORT);
});