/**
 * servidor-baileys
 *
 * Este artefato preserva apenas:
 *  - Conexão Baileys (estado persistente)
 *  - Evento messages.upsert (chegada de mensagens)
 *  - Endpoint POST /transcricao (ponto de acoplamento com teu Vue3)
 */

import multer from "multer";
import dotenv from "dotenv";
dotenv.config({ path: "/home/bragaus/Documentos/MEUTUTOR/AGENTE_HIBRIDO_BACKEND/.env" });
import { Sequelize, DataTypes, Model } from "sequelize";
import express from "express";
import cors from "cors";
import pino from "pino";
import qrcode from "qrcode-terminal";
import fs from "node:fs/promises";
import OpenAI, { toFile } from "openai";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadContentFromMessage,
  getContentType
} from "@whiskeysockets/baileys";

/** =========================
 * Constantes  
 * * ========================= */
const PORTA_TELEGRAFO = Number(process.env.PORTA_HTTP ?? 3789);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PASTA_CREDENCIAIS = process.env.PASTA_AUTENTICACAO ?? "./estado-auth";
const LIMITE_MASSA_CORPO = Number(process.env.LIMITE_BYTES_HTTP ?? 2 * 1024 * 1024);

const ORIGEM_PERMITIDA = process.env.CORS_ORIGEM ?? true; // true = refletir origem (dev)
const SEGREDO_DO_PORTAO = process.env.TOKEN_API ?? "";    // opcional: se vazio, não exige token
const UPLOAD = multer({ storage: multer.memoryStorage() });
/** =========================
 * Registro (observador)
 * ========================= */
const registro = pino({
  level: process.env.LOG_NIVEL ?? "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

/** =========================
 * Estado do “espaço-tempo”
 * ========================= */
let soqueteWhatsApp = null;

/** =========================================================
 * Funções puras (menos efeitos colaterais = mais verdade)
 * ========================================================= */

// 1) Stream -> Buffer (a alquimia é simples: concat)
async function streamParaBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// 2) Às vezes a mensagem vem dentro de "envelopes" (ephemeral/viewOnce)
function extrairMensagemInterna(msg) {
  if (!msg?.message) return null;

  let m = msg.message;

  // Ephemeral
  if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;

  // View Once (pode variar conforme versão)
  if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
  if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;

  return m;

}

async function pegarBufferDoAudio(baileysMsg) {
  const mensagem = extrairMensagemInterna(baileysMsg);
  if (!mensagem) return null;

  const tipo = getContentType(mensagem);

  // Caso 1: áudio padrão do WhatsApp (voice note / áudio)
  if (tipo === "audioMessage") {
    const audio = mensagem.audioMessage;
    const stream = await downloadContentFromMessage(audio, "audio");
    const buffer = await streamParaBuffer(stream);

    return {
      buffer,
      mimeType: audio.mimetype ?? "audio/ogg; codecs=opus",
      fileName: "audio.ogg",
      seconds: audio.seconds,
      ptt: audio.ptt, // true = mensagem de voz
    };
  }

  // Caso 2: usuário mandou como arquivo (documentMessage com mimetype audio/*)
  if (tipo === "documentMessage") {
    
    const doc = mensagem.documentMessage;
    const mime = doc.mimetype ?? "";
    if (!mime.startsWith("audio/")) return null;

    const stream = await downloadContentFromMessage(doc, "document");
    console.log("stream")
    console.log("stream")
    const buffer = await streamParaBuffer(stream);

    return {
      buffer,
      mimeType: mime,
      fileName: doc.fileName ?? "audio.bin",
    };
  }

  return null;
}

async function transcreverBufferOpenAI({ buffer, fileName, language = "en" }) {
  // Guarda de segurança (OpenAI: 25MB no endpoint de transcrição)
  const LIMITE = 25 * 1024 * 1024;
  if (buffer.length > LIMITE) {
    throw new Error(`Áudio grande demais (${(buffer.length / 1024 / 1024).toFixed(2)}MB). Precisa cortar/chunkar.`);
  }

  const arquivo = await toFile(buffer, fileName || "audio.ogg");

  const r = await openai.audio.transcriptions.create({
    model: "gpt-4o-transcribe",
    file: arquivo,
    language, // se você sabe que é inglês, isso ajuda muito
  });

  return r.text;
}

/**
 * Extrai texto “clássico” de uma mensagem.
 * (Não tenta ser onisciente: só cobre o comum com determinismo.)
 */
function extrairTextoClassico(mensagem) {
  const conteudo = mensagem?.message;
  if (!conteudo) return "";

  // Axioma: preferimos a forma mais direta.
  return (
    conteudo.conversation ||
    conteudo.extendedTextMessage?.text ||
    conteudo.imageMessage?.caption ||
    conteudo.videoMessage?.caption ||
    ""
  );
}

/**
 * Decide se devemos ignorar a mensagem.
 * Por padrão: ignora as que “vieram de nós”.
 */
function deveIgnorarMensagem(mensagem) {
  return Boolean(mensagem?.key?.fromMe);
}

/**
 * Backoff exponencial: convergência lenta, porém estável (quase uma série).
 */
function atrasoComBackoff(tentativa, tetoMs = 30_000) {
  const base = Math.min(tetoMs, 500 * 2 ** tentativa);
  const ruido = Math.floor(Math.random() * 250); // quebra ressonâncias (thundering herd)
  return base + ruido;
}

/** =========================================
 * Baileys: iniciar conexão + observar upsert
 * ========================================= */
async function iniciarConexaoWhatsApp() {
  const { state: estadoQuantico, saveCreds: salvarCredenciais } =
    await useMultiFileAuthState(PASTA_CREDENCIAIS);

    const { version: versaoBaileys } = await fetchLatestBaileysVersion();

  soqueteWhatsApp = makeWASocket({
    version: versaoBaileys,
    logger: registro,
    auth: {
      creds: estadoQuantico.creds,
      keys: makeCacheableSignalKeyStore(estadoQuantico.keys, registro),
    },

    // Etiqueta social: menos ruído de presença.
    emitOwnEvents: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  // Persistência: a memória do universo (credenciais) deve sobreviver ao reboot.
  soqueteWhatsApp.ev.on("creds.update", salvarCredenciais);

  // Conexão / reconexão: um pequeno “campo gravitacional” contra o caos.
  let tentativaReconexao = 0;

  soqueteWhatsApp.ev.on("connection.update", async (atualizacao) => {
    const { connection, lastDisconnect, qr } = atualizacao;

    if (qr) {
      qrcode.generate(qr, { small: true });
      registro.info("QR gerado — o observador deve colapsar a função de onda escaneando.");
    }

    if (connection === "open") {
      tentativaReconexao = 0;
      registro.info("Conexão estabelecida com o WhatsApp (referencial inercial estável).");
      return;
    }

    if (connection === "close") {
      const codigo = lastDisconnect?.error?.output?.statusCode;
      const deslogado = codigo === DisconnectReason.loggedOut;

      registro.warn({ codigo, deslogado }, "Conexão encerrada.");

      if (deslogado) {
        registro.error("Sessão deslogada. É necessário reautenticar (novo QR).");
        return;
      }

      tentativaReconexao += 1;
      const esperaMs = atrasoComBackoff(tentativaReconexao);

      registro.warn({ tentativaReconexao, esperaMs }, "Tentando reconectar com backoff.");
      setTimeout(() => {
        iniciarConexaoWhatsApp().catch((erro) =>
          registro.error({ erro }, "Falha na reconexão (singularidade operacional).")
        );
      }, esperaMs);
    }:
  });

// guarda arquivos em memória (Buffer) — ótimo pra mandar pra OpenAI depois
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (ajuste)
});

app.post(
  "/transcricao",
  upload.fields([
    { name: "arquivoApoio", maxCount: 1 },
    { name: "audios", maxCount: 20 },
  ]),
  (req, res) => {
    // ✅ campos de texto do FormData
    const { textoCenario, dicaSecreta, enviadoEm } = req.body;

    // se você mandou array/objeto como JSON string no FormData:
    const respostasAceitas = JSON.parse(req.body.respostasAceitas || "[]");

    // ✅ arquivos
    const arquivoApoio = req.files?.arquivoApoio?.[0] || null;
    const audios = req.files?.audios || [];

    // Exemplos do que você tem em cada file:
    // file.buffer (Buffer), file.mimetype, file.originalname, file.size

    console.log({
      textoCenario,
      dicaSecreta,
      enviadoEm,
      respostasAceitas,
      arquivoApoio: arquivoApoio?.originalname,
      qtdAudios: audios.length,
      audio0: audios[0]?.mimetype,
    });

    return res.json({
      ok: true,
      recebido: {
        textoCenario,
        dicaSecreta,
        enviadoEm,
        respostasAceitas,
        arquivoApoio: arquivoApoio ? {
          nome: arquivoApoio.originalname,
          mime: arquivoApoio.mimetype,
          bytes: arquivoApoio.size,
        } : null,
        audios: audios.map((a) => ({
          nome: a.originalname,
          mime: a.mimetype,
          bytes: a.size,
        })),
      },
    });
  }
);

  /**
   * Evento central: messages.upsert
   * Matemática mental: pense nisso como um fluxo discreto de amostras do mundo real.
   */
  soqueteWhatsApp.ev.on("messages.upsert", async (evento) => {
    if (evento.type !== "notify" && evento.type !== "append") return;

    for (const mensagem of evento.messages ?? []) {
      
      const audio = await pegarBufferDoAudio(mensagem)
      const transcricao = await transcreverBufferOpenAI({
        buffer: audio.buffer,
        fileName: audio.fileName,
        language: "en",
      });
      console.log(transcricao)
      const jidRemoto = mensagem?.key?.remoteJid ?? "desconhecido";
      const texto = extrairTextoClassico(mensagem);
  
      



      if (texto) {
        registro.debug({ jidRemoto, texto }, "Conteúdo textual observado.");
      }
    }
  });

  return soqueteWhatsApp;
}

/** =========================
 * HTTP: só o que importa agora
 * ========================= */

async function transcreverBuffer(bufferAudio) {
  const arquivo = await toFile(bufferAudio, "audio.ogg"); // ou .wav/.mp3
  const r = await openai.audio.transcriptions.create({
    file: arquivo,
    model: "gpt-4o-transcribe",
    language: "en",
  });

  return r.text;
}

function exigirTokenSeHouver(req, res, next) {
  if (!SEGREDO_DO_PORTAO) return next();

  const cabecalho = String(req.headers.authorization ?? "");
  const ok = cabecalho === `Bearer ${SEGREDO_DO_PORTAO}`;

  if (!ok) return res.status(401).json({ ok: false, erro: "Token inválido." });
  next();
}

async function iniciarTelegrafoHTTP() {
  const app = express();

  // guarda arquivos em memória (Buffer) — ótimo pra mandar pra OpenAI depois
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 }, // 25MB (ajuste)
  });

  app.use(cors({
    origin: true,         
    credentials: true,    
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }));

  app.options("*", cors({ origin: true, credentials: true }));

  //app.use(express.json({ limit: LIMITE_MASSA_CORPO }));
  //app.use(exigirTokenSeHouver);
}
/** =========================
 * Partida do cosmos
 * ========================= */
(async () => {
  await iniciarConexaoWhatsApp();
  await iniciarTelegrafoHTTP();
})().catch((erro) => {
  registro.error({ erro }, "Falha fatal ao iniciar (colapso do referencial).");
  process.exit(1);
});
