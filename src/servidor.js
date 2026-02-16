


dotenv.config({ path: "/root/baileys/.env" });

import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import OpenAI, { toFile } from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import "dotenv/config";
import express from "express";
import pino from "pino";
import qrcode from "qrcode-terminal";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadContentFromMessage
} from "@whiskeysockets/baileys";

import { aplicarCabecalhosSeguranca, criarLimitadorRequisicoes, autenticarPorToken, exigirTexto } from "./util/seguranca.js";
import { lerArquivoLocalCautelosamente, mimetypePorExtensao } from "./util/midia.js";

const registro = pino({
  level: "info",
  transport: { target: "pino-pretty", options: { colorize: true } }
});

const PORTA_HTTP = Number(process.env.PORTA_HTTP || 3789);
const PASTA_AUTENTICACAO = process.env.PASTA_AUTENTICACAO || "./estado-auth";
const LIMITE_BYTES_HTTP = Number(process.env.LIMITE_BYTES_HTTP || 10 * 1024 * 1024);


let socketWhatsApp = null;
async function bufferFromStream(readable) {
    console.log(readable)
    console.log("readable")
  const chunks = [];
  for await (const chunk of readable) chunks.push(chunk);
    

  return Buffer.concat(chunks);



}


async function baixarAudioComoBuffer(audioMessage) {
}

/**
 * Converte qualquer áudio (ex.: OGG/Opus WhatsApp) para WAV mono 16k + normalizado.
 * Entrada e saída via memória (Buffer), sem arquivos temporários.
 *
 */


async function whatsappAudioParaWavMono16kNormalizado(audioBuffer) {


  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", "pipe:0",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "pcm_s16le",
      "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
      "-f", "wav",
      "pipe:1",
    ];
    const ff = spawn("ffmpeg", args);
    const chunks = [];
    const errChunks = [];

    ff.stdout.on("data", (d) => chunks.push(d));
    ff.stderr.on("data", (d) => errChunks.push(d));

    ff.on("error", (e) => reject(e));

    ff.on("close", (code) => {


      if (code !== 0) {
        const msg = Buffer.concat(errChunks).toString("utf8") || `ffmpeg saiu com code ${code}`;
        return reject(new Error(msg));
      }
      resolve(Buffer.concat(chunks));
    });

    ff.stdin.end(audioBuffer);
  });
}

/**
 * Transcreve + avalia pronúncia, com pré-processamento ffmpeg (WAV mono 16k normalizado).
 */
async function transcreverEAvaliarPronunciaComFFmpeg({
  audioBuffer,
  filenameOriginal = "whatsapp.ogg",
  mimetypeOriginal = "audio/ogg",
  language = "en",
  targetText,
}) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 0) PREP: padroniza áudio (melhora fidelidade e estabilidade)
  const wavBuffer = await whatsappAudioParaWavMono16kNormalizado(audioBuffer);

  // 1) TRANSCRIÇÃO (alta fidelidade)
  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(wavBuffer, "audio.wav", { type: "audio/wav" }),
    model: "gpt-4o-transcribe",
    language,
    response_format: "json",
    include: ["logprobs"],
  });

  const text = (transcription?.text || "").trim();
  const tokenLogprobs = Array.isArray(transcription?.logprobs) ? transcription.logprobs : [];
  const avgLogprob =
    tokenLogprobs.length > 0
      ? tokenLogprobs.reduce((acc, t) => acc + (t.logprob ?? 0), 0) / tokenLogprobs.length
      : null;

  const asrConfidence =
    avgLogprob == null
      ? null
      : 1 / (1 + Math.exp(-((avgLogprob + 1.2) * 2.2)));

  // 2) AVALIAÇÃO DE PRONÚNCIA (JSON estável)
  const PronunciaSchema = z.object({
    score: z.number().min(0).max(100),
    level: z.enum(["ruim", "ok", "boa", "excelente"]),
    summary_pt: z.string(),
    strengths: z.array(z.string()),
    improvements: z.array(z.string()),
    tips: z.array(z.string()),
    detected_issues: z.array(
      z.enum([
        "hesitation",
        "mumbling",
        "stress_intonation",
        "vowel_clarity",
        "consonant_clarity",
        "pace_too_fast",
        "pace_too_slow",
        "unclear_words",
      ])
    ),
  });

  const analysisPrompt = [
    "Você é uma professora de inglês especialista em pronúncia.",
    "Responda SOMENTE em JSON conforme o schema.",
    "Avalie a pronúncia usando transcript + sinais do ASR (asr_confidence/avg_logprob).",
    "Se houver targetText, compare o que era esperado vs. falado e penalize omissões/trocas.",
    "Dê dicas práticas curtas de treino (10–20s).",
  ].join("\n");

  const analysisInput = {
    transcript: text,
    targetText: targetText ?? null,
    asr_confidence: asrConfidence,
    avg_logprob: avgLogprob,
    token_count: tokenLogprobs.length,
    worst_tokens: tokenLogprobs
      .slice()
      .sort((a, b) => (a.logprob ?? 0) - (b.logprob ?? 0))
      .slice(0, 12)
      .map((t) => ({ token: t.token, logprob: t.logprob })),
    source_audio: { filenameOriginal, mimetypeOriginal },
  };

  const response = await openai.responses.parse({
    model: "gpt-4o-mini",
    input: [
      { role: "system", content: analysisPrompt },
      { role: "user", content: JSON.stringify(analysisInput) },
    ],
    text: { format: zodTextFormat(PronunciaSchema, "pronuncia") },
  });

  return {
    text,
    pronunciation: response.output_parsed,
    asr: {
      model: "gpt-4o-transcribe",
      language,
      avg_logprob: avgLogprob,
      confidence: asrConfidence,
      preprocessed: { format: "wav", sample_rate: 16000, channels: 1, normalized: "loudnorm I=-16" },
    },
  };
}

/**
 * Transcreve áudio (WhatsApp) e avalia pronúncia.
 *
 * @param {Object} params
 * @param {Buffer} params.audioBuffer  - Buffer do áudio (ex.: ogg/opus do WhatsApp já decodificado/baixado)
 * @param {string} params.filename     - Nome do arquivo (ex.: "audio.ogg")
 * @param {string} params.mimetype     - MIME (ex.: "audio/ogg")
 * @param {string} [params.language]   - ISO-639-1 (ex.: "en"). Se você souber que é inglês, passe "en". :contentReference[oaicite:3]{index=3}
 * @param {string} [params.targetText] - (Opcional mas MUITO forte) frase-alvo esperada do aluno
 * @returns {Promise<Object>}          - { text, pronunciation, asr }
 */
async function transcreverEAvaliarPronuncia({
  audioBuffer,
  filename,
  mimetype,
  language = "en",
  targetText,
}) {

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // 1) TRANSCRIÇÃO (alta fidelidade) + logprobs pra sinais de confiança
  const transcription = await openai.audio.transcriptions.create({
    file: await toFile(audioBuffer, filename, { type: mimetype }),
    model: "gpt-4o-transcribe",
    language,                 // "en" melhora precisão/latência se for mesmo inglês :contentReference[oaicite:4]{index=4}
    response_format: "json",  // requerido p/ logprobs nesse modelo :contentReference[oaicite:5]{index=5}
    include: ["logprobs"],    // devolve logprobs por token :contentReference[oaicite:6]{index=6}
  });

  const text = (transcription?.text || "").trim();
  const tokenLogprobs = Array.isArray(transcription?.logprobs) ? transcription.logprobs : [];

  // Heurística simples de “clareza/confiança” (0..1) baseada em logprobs.
  // (Não é “pronúncia perfeita”, mas correlaciona com inteligibilidade.)
  const avgLogprob =
    tokenLogprobs.length > 0
      ? tokenLogprobs.reduce((acc, t) => acc + (t.logprob ?? 0), 0) / tokenLogprobs.length
      : null;

  // Mapeia avgLogprob (tipicamente negativo) pra 0..1 com uma sigmoid suave
  const asrConfidence =
    avgLogprob == null
      ? null
      : 1 / (1 + Math.exp(-((avgLogprob + 1.2) * 2.2))); // ajuste empírico

  // 2) AVALIAÇÃO DE PRONÚNCIA (Structured Output)
  const PronunciaSchema = z.object({
    score: z.number().min(0).max(100),
    level: z.enum(["ruim", "ok", "boa", "excelente"]),
    summary_pt: z.string(),          // resumo em português
    strengths: z.array(z.string()),  // pontos fortes
    improvements: z.array(z.string()),// pontos a melhorar
    tips: z.array(z.string()),       // dicas práticas
    detected_issues: z.array(
      z.enum([
        "hesitation",
        "mumbling",
        "stress_intonation",
        "vowel_clarity",
        "consonant_clarity",
        "pace_too_fast",
        "pace_too_slow",
        "unclear_words",
      ])
    ),
  });

  const analysisPrompt = [
    "Você é uma professora de inglês especialista em pronúncia.",
    "Responda SOMENTE em JSON (conforme o schema).",
    "Avalie a pronúncia do aluno usando:",
    "- o texto transcrito (o que ele realmente falou)",
    "- sinais de confiança do ASR (asr_confidence / avg_logprob)",
    "- e, se houver, a frase-alvo esperada (targetText) para medir desvio.",
    "",
    "Se targetText existir, compare o sentido e a forma: palavras faltando, trocadas, contrações, finais de palavras, etc.",
    "Se targetText NÃO existir, foque em inteligibilidade, clareza, fluência e naturalidade para um falante não-nativo.",
    "",
    "Retorne dicas práticas e curtas (treinos de 10–20s).",
  ].join("\n");

  const analysisInput = {
    transcript: text,
    targetText: targetText ?? null,
    asr_confidence: asrConfidence,
    avg_logprob: avgLogprob,
    token_count: tokenLogprobs.length,
    // Pequena amostra de tokens “piorzinhos” ajuda a achar trechos problemáticos
    worst_tokens: tokenLogprobs
      .slice()
      .sort((a, b) => (a.logprob ?? 0) - (b.logprob ?? 0))
      .slice(0, 12)
      .map((t) => ({ token: t.token, logprob: t.logprob })),
  };

  const response = await openai.responses.parse({
    model: "gpt-4o-mini", // bom custo/benefício pra avaliação textual; pode subir pra um maior se quiser
    input: [
      { role: "system", content: analysisPrompt },
      { role: "user", content: JSON.stringify(analysisInput) },
    ],
    text: { format: zodTextFormat(PronunciaSchema, "pronuncia") },
  });

  const pronunciation = response.output_parsed;

  return {
    text,
    pronunciation,
    asr: {
      model: "gpt-4o-transcribe",
      language,
      avg_logprob: avgLogprob,
      confidence: asrConfidence,
    },
  };
}

/**
 * Extrai texto de uma mensagem do WhatsApp (casos comuns).
 * Em vossa jornada, podereis ampliar para buttons, list, template, etc.
 */
function extrairTextoDaMensagem(mensagem) {
  const conteudo = mensagem?.message;
  if (!conteudo) return "";

/*  if (conteudo.conversation) {
    return { type: "text", content: conteudo.conversation };
  }

  if (conteudo.extendedTextMessage?.text) {
    return { type: "extended_text", content: conteudo.extendedTextMessage.text };
  }

  if (conteudo.imageMessage?.caption) {
    return { type: "image", content: conteudo.imageMessage.caption };
  }

  if (conteudo.videoMessage?.caption) {
    return { type: "video", content: conteudo.videoMessage.caption };
  }

  if (conteudo.audioMessage) {
    return { type: "audio", content: conteudo.audioMessage };
  }
*/
    
  return (
    conteudo.conversation ||
    conteudo.extendedTextMessage?.text ||
    conteudo.imageMessage?.caption ||
    conteudo.videoMessage?.caption ||
    conteudo.audioMessage ||
    ""
  );

}

/**
 * Decide se a mensagem deve ser ignorada (ex.: mensagens enviadas por nós mesmos).
 */
function deveIgnorar(mensagem) {
  // "fromMe" = mensagem originada da própria conta conectada
  return  false//Boolean(mensagem?.key?.fromMe);
}

/**
 * Constrói e inicia a conexão Baileys.
 * Observação: há breaking changes relevantes (v7+). :contentReference[oaicite:6]{index=6}
 */
async function iniciarWhatsApp() {
  
  const { state: estadoAuth, saveCreds: salvarCredenciais } = await useMultiFileAuthState(PASTA_AUTENTICACAO);

  const { version } = await fetchLatestBaileysVersion();

  socketWhatsApp = makeWASocket({
    version,
    logger: registro,
    auth: {
      creds: estadoAuth.creds,
      keys: makeCacheableSignalKeyStore(estadoAuth.keys, registro)
    },
    // Boas maneiras: reduz ruído de “presença disponível”
    emitOwnEvents: false,
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  // Persistência de credenciais
  socketWhatsApp.ev.on("creds.update", salvarCredenciais);

  // Conexão e reconexão
  socketWhatsApp.ev.on("connection.update", (atualizacao) => {
    const { connection, lastDisconnect, qr } = atualizacao;

  // 📜 Exibir QR de forma explícita
  if (qr) {
    qrcode.generate(qr, { small: true });
    console.log("\n================ QR CODE ================\n");
    console.log(qr);
    console.log("\n========================================\n");
  }

    if (connection === "close") {
      const motivo = lastDisconnect?.error?.output?.statusCode;
      const deveReconectar = motivo !== DisconnectReason.loggedOut;

      registro.warn({ motivo, deveReconectar }, "Conexão encerrada.");

      if (deveReconectar) {
        iniciarWhatsApp().catch((erro) => registro.error({ erro }, "Falha ao reconectar."));
      } else {
        registro.error("Sessão deslogada. É mister autenticar novamente.");
      }
    }

    if (connection === "open") {
      registro.info("Conexão estabelecida com o WhatsApp.");
    }
  });

  /**
   * Mensagens entrantes: messages.upsert
   * O evento traz um array de mensagens: percorrei-o sempre. :contentReference[oaicite:7]{index=7}
   */
socketWhatsApp.ev.on("messages.upsert", async (evento) => {

    if (evento.type !== "notify" && evento.type !== "append") return;

      for (const mensagem of evento.messages || []) {
        if (deveIgnorar(mensagem)) continue;

async function bufferFromAsyncIterable(asyncIterable) {
  const chunks = [];
  for await (const chunk of asyncIterable) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

if (mensagem?.message?.audioMessage) {

 const audioMsg = mensagem?.message?.audioMessage;
 if (!audioMsg) throw new Error("Sem audioMessage na mensagem.");
 const stream = await downloadContentFromMessage(audioMsg, "audio");
const oggBuffer = await bufferFromAsyncIterable(stream);

        const file = await toFile(oggBuffer, "audio.ogg", {
         type: "audio/ogg",
        });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const rr = await client.audio.transcriptions.create({
    file,
    model: "gpt-4o-mini-transcribe",
    // language: "en",          // opcional (ISO-639-1)
    // response_format: "json", // opcional
  });

    console.log(rr)

    const form = new FormData();
    form.append("data", new Blob([mensagem?.message?.audioMessage], { type: "audio/ogg" }), {
      filename: "audio.ogg",
      contentType: "audio/ogg",
    });
    // opcional: metadados em JSON junto
    form.append("meta", JSON.stringify({ mimetype: "audio/ogg" }));
    form.append("tipo", "audio");
    form.append("remoteJid", mensagem?.key?.remoteJid);

    const r = await fetch("https://n8n.planoartistico.com/webhook-test/cec8958e-a7fe-4611-9737-51537e029a12", {
      method: "POST",
      body: form,
    });

    const txt = await r.text();
    registro.info({ txt }, "Mensagem recebida.");
}

if (mensagem?.message?.conversation) {


        const jidRemoto = mensagem?.key?.remoteJid;
        const texto = extrairTextoDaMensagem(mensagem);

        registro.info({ jidRemoto, texto, tipo: "texto" });


    //body: JSON.stringify(registro.info),
  const res = await fetch("https://n8n.planoartistico.com/webhook-test/cec8958e-a7fe-4611-9737-51537e029a12", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texto, remoteJid: jidRemoto, tipo: "texto"}),
  });
        
      }




      }
});

      

  // Eventos adicionais úteis (catálogo parcial)
  socketWhatsApp.ev.on("messages.update", (atualizacoes) => {
    registro.debug({ atualizacoes }, "messages.update");
  });

  socketWhatsApp.ev.on("presence.update", (presenca) => {
    registro.debug({ presenca }, "presence.update");
  });

  // Chamadas (call) existem no mapa de eventos do Baileys. :contentReference[oaicite:8]{index=8}
  socketWhatsApp.ev.on("call", (eventosChamada) => {
    registro.info({ eventosChamada }, "Evento de chamada.");
  });

  return socketWhatsApp;
}

/* ==========================
 * Funções públicas do WhatsApp
 * ========================== */

/**
 * Envia texto.
 */
async function enviarTexto(jidDestino, texto) {
  return socketWhatsApp.sendMessage(jidDestino, { text: texto });
}

/**
 * Envia imagem (local) com legenda opcional.
 */
async function enviarImagem(jidDestino, caminhoImagem, legenda = "") {
  const { caminhoAbsoluto } = lerArquivoLocalCautelosamente(caminhoImagem);
  return socketWhatsApp.sendMessage(jidDestino, {
    image: { url: caminhoAbsoluto },
    caption: legenda
  });
}

/**
 * Envia vídeo (local) com legenda opcional.
 */
async function enviarVideo(jidDestino, caminhoVideo, legenda = "") {
  const { caminhoAbsoluto } = lerArquivoLocalCautelosamente(caminhoVideo);
  return socketWhatsApp.sendMessage(jidDestino, {
    video: { url: caminhoAbsoluto },
    caption: legenda
  });
}

/**
 * Envia áudio (local). Pode ser PTT (mensagem de voz) se desejardes.
 */
async function enviarAudio(jidDestino, caminhoAudio, comoPtt = false) {
    const { caminhoAbsoluto } = lerArquivoLocalCautelosamente(caminhoAudio);
  const mimetype = mimetypePorExtensao(caminhoAbsoluto);

  return socketWhatsApp.sendMessage(jidDestino, {
    audio: { url: caminhoAbsoluto },
    mimetype,
    ptt: Boolean(comoPtt)
  });
}

/**
 * Envia “digitando…” (composing) e depois “pausado”.
 * Presença suportada: unavailable | available | composing | recording | paused. :contentReference[oaicite:9]{index=9}
 */
async function simularDigitando(jidDestino, milissegundos = 1200) {
  await socketWhatsApp.sendPresenceUpdate("composing", jidDestino);
  await new Promise((r) => setTimeout(r, milissegundos));
  await socketWhatsApp.sendPresenceUpdate("paused", jidDestino);
}

/**
 * Reage a uma mensagem com emoji.
 * O react usa a chave (key) da mensagem alvo. :contentReference[oaicite:10]{index=10}
 */
async function reagirMensagem(jidDestino, chaveMensagem, emoji) {
  return socketWhatsApp.sendMessage(jidDestino, {
    react: { key: chaveMensagem, text: emoji }
  });
}

/**
 * Responde uma conversa citando (quoted) a mensagem recebida.
 * Isto cria o “reply” no cliente do WhatsApp.
 */
async function responderConversa(jidDestino, textoResposta, mensagemOriginal) {
  return socketWhatsApp.sendMessage(
    jidDestino,
    { text: textoResposta },
    { quoted: mensagemOriginal }
  );
}

/* ==========================
 * Servidor HTTP (Express)
 * ========================== */

async function iniciarHttp() {
  const app = express();

  aplicarCabecalhosSeguranca(app);

  app.use(criarLimitadorRequisicoes());
  app.use(express.json({ limit: LIMITE_BYTES_HTTP }));
  app.use(express.urlencoded({ extended: true, limit: LIMITE_BYTES_HTTP }));

  // Protege toda a API
  app.use(autenticarPorToken);

  // Saúde
  app.get("/saude", (req, res) => {
    const conectado = Boolean(socketWhatsApp?.user);
    res.json({ ok: true, conectado });
  });

  // Enviar texto
  app.post("/mensagem/texto", async (req, res) => {
    try {
      const jidDestino = exigirTexto(req.body, "jidDestino");
      const texto = exigirTexto(req.body, "texto");

      await enviarTexto(jidDestino, texto);
      res.json({ ok: true });
    } catch (erro) {
      res.status(400).json({ erro: String(erro.message || erro) });
    }
  });

  // Enviar mídia
  app.post("/mensagem/midia",async (req, res) => {
    const { numero, caminhoAudio, ehPTT } = req.body;

  if (!caminhoAudio || typeof caminhoAudio !== "string") {
    return res.status(400).json({ ok: false, erro: "caminhoAudio inválido" });
  }

  const resposta = await fetch(caminhoAudio); // ✅ agora é URL de verdade
  //await enviarAudio(numero, resposta, ehPTT);

  const arrayBuffer = await resposta.arrayBuffer();
    const audio = await socketWhatsApp.sendMessage(numero, {
     audio: { url: "https://checkinnoingles.s3.us-east-1.amazonaws.com/meututor/desafios/005-desafio.mp3" },
     mimetype: "audio/mpeg",
     ptt: false
   });

  // aqui você envia com Baileys (exemplo genérico)
  // await sock.sendMessage(numero, { audio: buffer, ptt: !!ehPTT, mimetype: "audio/mpeg" });

return res.json({
      ok: true,
    });


  });
  // Simular digitando
  app.post("/presenca/digitando", async (req, res) => {
    try {
      const jidDestino = exigirTexto(req.body, "jidDestino");
      const milissegundos = Number(req.body?.milissegundos || 1200);
      await simularDigitando(jidDestino, milissegundos);
      res.json({ ok: true });
    } catch (erro) {
      res.status(400).json({ erro: String(erro.message || erro) });
    }
  });

  // Reagir
  app.post("/mensagem/reacao", async (req, res) => {
    try {
      const jidDestino = exigirTexto(req.body, "jidDestino");
      const emoji = exigirTexto(req.body, "emoji");

      // Espera-se que o cliente envie a key completa, obtida do evento messages.upsert
      const chaveMensagem = req.body?.chaveMensagem;
      if (!chaveMensagem || typeof chaveMensagem !== "object") {
        throw new Error("chaveMensagem inválida (objeto esperado).");
      }

      await reagirMensagem(jidDestino, chaveMensagem, emoji);
      res.json({ ok: true });
    } catch (erro) {
      res.status(400).json({ erro: String(erro.message || erro) });
    }
  });

  // Responder conversa (reply/quote)
  app.post("/conversa/responder", async (req, res) => {
    try {
      const jidDestino = exigirTexto(req.body, "jidDestino");
      const textoResposta = exigirTexto(req.body, "textoResposta");

      const mensagemOriginal = req.body?.mensagemOriginal;
      if (!mensagemOriginal || typeof mensagemOriginal !== "object") {
        throw new Error("mensagemOriginal inválida (objeto esperado).");
      }

      await responderConversa(jidDestino, textoResposta, mensagemOriginal);
      res.json({ ok: true });
    } catch (erro) {
      res.status(400).json({ erro: String(erro.message || erro) });
    }
  });

  app.listen(PORTA_HTTP, () => {
    registro.info({ PORTA_HTTP }, "Servidor HTTP em funcionamento.");
  });
}

/* ==========================
 * Partida do sistema
 * ========================== */

(async () => {
  await iniciarWhatsApp();     // WhatsApp primeiro, para evitar “API viva, WhatsApp morto”
  await iniciarHttp();
})().catch((erro) => {
  registro.error({ erro }, "Falha fatal ao iniciar.");
  process.exit(1);
});

