import { criarLimitadorRequisicoes } from "./util/seguranca.js";
const rateLimit = require("express-rate-limit");
const express = require("express");
const qrcode = require("qrcode-terminal");
import multer from "multer";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import os from "os";
import { spawn } from "child_process";
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const P = require("pino");
const app = express();
app.use(express.json());
app.use(criarLimitadorRequisicoes());
app.set("trust proxy", 1);
let sock;
let isReady = false;

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: P({ level: "silent" }),
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📲 Escaneie o QR Code:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      isReady = true;
      console.log("✅ WhatsApp conectado.");
    }

    if (connection === "close") {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("❌ Conexão fechada. Reconnect?", shouldReconnect);

      if (shouldReconnect) start();
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages?.[0];
      if (!msg || msg.key.fromMe) return;

      const jid = msg.key.remoteJid;
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        "";

      if (!text) return;

      console.log("📩", jid, "=>", text);

      // Resposta automática exemplo
      if (text.toLowerCase().includes("oi")) {
        await sock.sendMessage(jid, { text: "Salve 😼 Bot Baileys online." });
      }
    } catch (e) {
      console.error("Erro ao processar msg:", e);
    }
  });
}

app.get("/health", (req, res) => {
  res.json({ ok: true, whatsappReady: isReady });
});

// Enviar mensagem via HTTP
// POST /send  { "to": "5599999999999", "text": "hello" }
app.post("/send", async (req, res) => {
  try {
    if (!sock) return res.status(503).json({ ok: false, error: "not_connected" });

    const { to, text } = req.body;
    if (!to || !text) return res.status(400).json({ ok: false, error: "missing_to_or_text" });

    // normaliza: só números, e adiciona @s.whatsapp.net
    const jid = `${String(to).replace(/\D/g, "")}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const PORT = process.env.PORTA_HTTP || 8909;
app.listen(PORT, () => console.log(`🌐 API ouvindo na porta ${PORT}`));

start();

