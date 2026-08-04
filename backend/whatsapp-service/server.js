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
            "--disable-background-networking",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            "--disable-extensions",
            "--disable-sync"
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

client.on("authenticated", () => {
    console.log("✅ WhatsApp Authenticated");
});

client.on("ready", () => {
    connected = true;
    latestQR = null;
    console.log("✅ WhatsApp is ready!");
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
        <html>
            <body style="font-family:Arial;text-align:center;margin-top:100px;">
                <h2>✅ WhatsApp Already Connected</h2>
            </body>
        </html>
        `);
    }

    if (!latestQR) {
        return res.send(`
        <html>
            <head>
                <meta http-equiv="refresh" content="3">
            </head>
            <body style="font-family:Arial;text-align:center;margin-top:100px;">
                <h2>Waiting for QR Code...</h2>
            </body>
        </html>
        `);
    }

    res.send(`
    <html>
        <head>
            <meta http-equiv="refresh" content="5">
        </head>

        <body style="
            display:flex;
            justify-content:center;
            align-items:center;
            flex-direction:column;
            font-family:Arial;
            height:100vh;
        ">

            <h2>Scan WhatsApp QR</h2>

            <img src="${latestQR}" width="320"/>

            <p>
                WhatsApp → Settings → Linked Devices → Link a Device
            </p>

        </body>
    </html>
    `);
});

app.post("/send", async (req, res) => {

    console.log("📨 Received Request");

    try {

        if (!connected) {
            return res.status(400).json({
                success: false,
                error: "WhatsApp is not connected"
            });
        }

        const { phone, message } = req.body;

        console.log("Phone:", phone);

        const chatId = `${phone}@c.us`;

        console.log("Chat ID:", chatId);

        // Small delay to allow browser to settle
        await new Promise(resolve => setTimeout(resolve, 2000));

        const result = await client.sendMessage(chatId, message);

        console.log("✅ Message Sent");
        console.log(result.id._serialized);

        res.json({
            success: true
        });

    } catch (err) {

        console.error("❌ SEND ERROR");
        console.error(err);

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