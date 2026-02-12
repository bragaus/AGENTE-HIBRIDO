import "dotenv/config";
import express from "express";
import pino from "pino";
import qrcode from "qrcode-terminal";
import FormData from "form-data";
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
  const chunks = [];
  for await (const chunk of readable) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function baixarAudioComoBuffer(audioMessage) {
  const stream = await downloadContentFromMessage(audioMessage, "audio");
  const buffer = await bufferFromStream(stream);
  return buffer;
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
          console.log(mensagem.message.audioMessage)
console.log(mensagem.message.audioMessage)
    const buffer = await baixarAudioComoBuffer(mensagem.message.audioMessage);
console.log(buffer)
    const form = new FormData();
    form.append("data", buffer, {
      filename: "audio.ogg",
      contentType: "audio/ogg",
    });

    // opcional: metadados em JSON junto
    form.append("meta", JSON.stringify({ mimetype: "audio/ogg" }));

    const r = await fetch("https://n8n.planoartistico.com/webhook-test/2411140f-2dad-44c2-a5f5-70b5b8612e54", {
      method: "POST",
      headers: form.getHeaders(), 
      body: form,
    });

    const txt = await r.text();
    registro.info({ txt }, "Mensagem recebida.");
      }
          /*
        const jidRemoto = mensagem?.key?.remoteJid;
        const texto = extrairTextoDaMensagem(mensagem);

        registro.info({ jidRemoto, texto }, "Mensagem recebida.");

        // Exemplo: comando simples e resposta citada (reply)
        if (texto?.toLowerCase() === "ping") {
          await responderConversa(jidRemoto, "Pong, com a pontualidade de um relógio suíço.", mensagem);
        }
      }
    } catch (erro) {
      registro.error({ erro }, "Erro ao tratar messages.upsert.");
    }*/
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
      console.logg(caminhoAudio)
    const { numero, caminhoAudio, ehPTT } = req.body;

  if (!caminhoAudio || typeof caminhoAudio !== "string") {
    return res.status(400).json({ ok: false, erro: "caminhoAudio inválido" });
  }

  const resposta = await fetch(caminhoAudio); // ✅ agora é URL de verdade
  //await enviarAudio(numero, resposta, ehPTT);

  const arrayBuffer = await resposta.arrayBuffer();
const audio = await socketWhatsApp.sendMessage(numero, {
     audio: { url: "https://checkinnoingles.s3.us-east-1.amazonaws.com/zzz/meututor/001-Desafio.mp3" },
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

