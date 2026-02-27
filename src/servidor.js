/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║         SERVIDOR DE COMUNICAÇÃO TELEGRÁFICA VIA PROTOCOLO WHATSAPP          ║
 * ║                                                                              ║
 * ║  Apparatus construído segundo os princípios da Filosofia Natural Moderna,    ║
 * ║  destinado à interceptação, análise e encaminhamento de mensagens oriundas  ║
 * ║  do éter digital, com rigorosa observância dos postulados termodinâmicos    ║
 * ║  da conservação da informação.                                               ║
 * ║                                                                              ║
 * ║  Autor: Pesquisador Sênior do Gabinete de Ciências Aplicadas, Anno 1880     ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

// ─────────────────────────────────────────────────────────────────────────────
// § I. IMPORTAÇÃO DOS INSTRUMENTOS CIENTÍFICOS NECESSÁRIOS À EXPERIMENTAÇÃO
//   Assim como o naturalista municia-se de lente e bisturi antes de adentrar
//   o laboratório, importamos aqui os módulos indispensáveis à operação.
// ─────────────────────────────────────────────────────────────────────────────
import { desafios } from "./models/situacao_problema.js"; // ajuste o path
import multer from "multer";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import pino from "pino";
import qrcode from "qrcode-terminal";
import OpenAI, { toFile } from "openai";
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadContentFromMessage,
  getContentType,
} from "@whiskeysockets/baileys";
import { Sequelize, DataTypes, Model } from "sequelize";
//import aparatoTelegrafico from "./baileys.js";
// ─────────────────────────────────────────────────────────────────────────────
// § II. CONSTANTES FUNDAMENTAIS DO SISTEMA — OS AXIOMAS DO EXPERIMENTO
// ─────────────────────────────────────────────────────────────────────────────
const PORTA_DO_TELEGRAFO = Number(process.env.PORTA_HTTP);
const DIRETORIO_CREDENCIAIS = "./estado-auth";
const LIMITE_BYTES_REQUISICAO = Number(2 * 1024 * 1024);
const SEGREDO_DO_PORTAO = process.env.TOKEN_API;
const CHAVE_OPENAI = process.env.OPENAI_API_KEY;

/** URL interna do próprio servidor — ponto de acoplamento entre Baileys e a rota HTTP */
const URL_ENDPOINT_TRANSCRICAO = `http://localhost:7773/transcricao`;

// ─────────────────────────────────────────────────────────────────────────────
// § III. INSTANCIAÇÃO DOS INSTRUMENTOS DE MEDIÇÃO E OBSERVAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
const registroCientifico = pino({
  level: process.env.LOG_NIVEL ?? "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

const clienteOpenAI = new OpenAI({ apiKey: CHAVE_OPENAI });
const sequelize = new Sequelize(process.env.DATABASE_URL);

try {
  await sequelize.authenticate();
  console.log("Connection has been established successfully.");
} catch (error) {
  console.error("Unable to connect to the database:", error);
}

let soqueteWhatsApp = null;

/* aparato cirurgico de textos  */
async function fluxoParaBuffer(fluxo) {
  const fragmentos = [];
  for await (const fragmento of fluxo) fragmentos.push(fragmento);
  return Buffer.concat(fragmentos);
}

function extrairMensagemNuclear(mensagemBaileys) {
  if (!mensagemBaileys?.message) return null;

  let nucleo = mensagemBaileys.message;
  console.log(nucleo);

  if (nucleo.ephemeralMessage?.message) nucleo = nucleo.ephemeralMessage.message;
  if (nucleo.viewOnceMessage?.message) nucleo = nucleo.viewOnceMessage.message;
  if (nucleo.viewOnceMessageV2?.message) nucleo = nucleo.viewOnceMessageV2.message;

  return nucleo;
}

async function extrairBufferDeAudio(mensagemBaileys) {
  const nucleo = extrairMensagemNuclear(mensagemBaileys);
  if (!nucleo) return null;

  console.log("getContenType");
  const tipoDaEntidade = getContentType(nucleo);
  console.log(getContentType);

  if (tipoDaEntidade === "audioMessage") {
    const entidadeAudio = nucleo.audioMessage;
    const corrente = await downloadContentFromMessage(entidadeAudio, "audio");
    const corpo = await fluxoParaBuffer(corrente);

    return {
      buffer: corpo,
      mimeType: entidadeAudio.mimetype ?? "audio/ogg; codecs=opus",
      fileName: "audio.ogg",
      segundos: entidadeAudio.seconds,
      notaDeVoz: entidadeAudio.ptt ?? false,
    };
  }

  if (tipoDaEntidade === "documentMessage") {
    const documento = nucleo.documentMessage;
    const mimeDoDocumento = documento.mimetype ?? "";
    if (!mimeDoDocumento.startsWith("audio/")) return null;

    const corrente = await downloadContentFromMessage(documento, "document");
    const corpo = await fluxoParaBuffer(corrente);

    return {
      buffer: corpo,
      mimeType: mimeDoDocumento,
      fileName: documento.fileName ?? "audio.bin",
    };
  }

  return null;
}

async function transcreverAudioViaOpenAI({ buffer, fileName, idioma = "en" }) {
  const LIMITE_MAXIMO = 25 * 1024 * 1024;

  if (buffer.length > LIMITE_MAXIMO) {
    throw new Error(
      `Corpus sonoro excessivo: ${(buffer.length / 1_048_576).toFixed(2)} MB. ` +
        `O limite da câmara de transcrição é de 25 MB.`
    );
  }

  const arquivoSubmetido = await toFile(buffer, fileName ?? "audio.ogg");

  const resultado = await clienteOpenAI.audio.transcriptions.create({
    model: "gpt-4o-transcribe",
    file: arquivoSubmetido,
    language: idioma,
  });

  return resultado.text;
}

function calcularRetrocessoExponencial(tentativa, tetoMs = 30_000) {
  const componente_base = Math.min(tetoMs, 500 * 2 ** tentativa);
  const perturbacao = Math.floor(Math.random() * 250);
  return componente_base + perturbacao;
}

async function encaminharMensagemParaEndpoint(mensagemBaileys, transcricao = null) {
  const identificadorRemoto = mensagemBaileys?.key?.remoteJid ?? "desconhecido";

  try {
    const respostaTelegrafo = await fetch(process.env.NN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        remetenteJid: identificadorRemoto,
        transcricaoAudio: transcricao ?? "",
      }),
    });

    if (!respostaTelegrafo.ok) {
      registroCientifico.warn(
        { status: respostaTelegrafo.status, remetente: identificadorRemoto },
        "O endpoint rejeitou o envelope."
      );
      return;
    }

    const corpoResposta = await respostaTelegrafo.json();
    registroCientifico.info(
      { remetente: identificadorRemoto, resposta: corpoResposta },
      "Mensagem encaminhada com êxito."
    );
  } catch (erroTransmissao) {
    registroCientifico.error(
      { erroTransmissao, remetente: identificadorRemoto },
      "Falha na transmissão interna."
    );
  }
}

var remoteJid = ""

async function iniciarConexaoWhatsApp() {
   
   const { state: estadoDaSessao, saveCreds: preservarCredenciais } =
   await useMultiFileAuthState(DIRETORIO_CREDENCIAIS);

  const { version: versaoProtocolo } = await fetchLatestBaileysVersion();

  registroCientifico.info(
    { versaoProtocolo },
    "Versão do protocolo Baileys identificada — iniciando a conjunção com o servidor."
  );

  soqueteWhatsApp = makeWASocket({
    version: versaoProtocolo,
    logger: registroCientifico,
    auth: {
      creds: estadoDaSessao.creds,
      keys: makeCacheableSignalKeyStore(estadoDaSessao.keys, registroCientifico),
    },
    emitOwnEvents: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  soqueteWhatsApp.ev.on("creds.update", preservarCredenciais);

  let contadorDeTentativas = 0;

  soqueteWhatsApp.ev.on("connection.update", async (atualizacaoDeEstado) => {
    const { connection, lastDisconnect, qr: codigoQR } = atualizacaoDeEstado;

    if (codigoQR) {
      qrcode.generate(codigoQR, { small: true });
      registroCientifico.info(
        "Código QR gerado — aguarda-se a intervenção do observador para estabelecer a ligação."
      );
    }

    if (connection === "open") {
      contadorDeTentativas = 0;
      registroCientifico.info(
        "Conexão estabelecida com pleno êxito — o referencial inercial encontra-se estável."
      );
      return;
    }

    if (connection === "close") {
      const codigoDeEncerramento = lastDisconnect?.error?.output?.statusCode;
      const sessaoDeslogada = codigoDeEncerramento === DisconnectReason.loggedOut;

      registroCientifico.warn(
        { codigoDeEncerramento, sessaoDeslogada },
        "A conexão foi encerrada — investigando as causas do fenômeno."
      );

      if (sessaoDeslogada) {
        registroCientifico.error(
          "Sessão invalidada pelo servidor remoto. Faz-se necessária nova autenticação via QR."
        );
        return;
      }

      contadorDeTentativas += 1;
      const intervaloDeEspera = calcularRetrocessoExponencial(contadorDeTentativas);

      registroCientifico.warn(
        { contadorDeTentativas, intervaloDeEspera },
        "Iniciando protocolo de reconexão com retrocesso exponencial — a persistência é virtude científica."
      );

      setTimeout(() => {
        iniciarConexaoWhatsApp().catch((erroFatal) =>
          registroCientifico.error(
            { erroFatal },
            "Reconexão malograda — o fenômeno exige investigação manual."
          )
        );
      }, intervaloDeEspera);
    }
  });

  soqueteWhatsApp.ev.on("messages.upsert", async (pacote) => {
    // Aceitamos apenas notificações em tempo real e appendagens de histórico
    const { messages: mensagens, type: especie } = pacote;

    if (especie !== "notify" && especie !== "append") return;

    console.log(mensagens);

    for (const entrada of mensagens) {
      const mensagemRemota = entrada?.message?.conversation;
      remoteJid = entrada?.key?.remoteJid;

      if (entrada?.message?.conversation) {
        const telegrama_do_N8N = await fetch(process.env.NN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ mensagemRemota, remoteJid }),
        });
       

      }

        if (entrada?.message?.audioMessage) {

                   
                   const audioMsg = entrada.message.audioMessage;
                   if (!audioMsg) throw new Error("Sem audioMessage na mensagem.");
                   const stream = await downloadContentFromMessage(audioMsg, "audio");
                   const oggBuffer = await fluxoParaBuffer(stream);

                    const file = await toFile(oggBuffer, "audio.ogg", {
                     type: "audio/ogg",
                    });

                    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

                    const transcricao = await client.audio.transcriptions.create({
                      file,
                      model: "gpt-4o-mini-transcribe",
                      language: "en",          // opcional (ISO-639-1)
                      //response_format: "json", // opcional
                    });
                  const remoteJid =  entrada?.key?.remoteJid
                  const telegrama_do_N8N = await fetch(process.env.NN_URL, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Accept: "application/json",
                    },
                    body: JSON.stringify({ remoteJid, transcricao }),
                  });
        }
     }



  });

  return soqueteWhatsApp;
}


// ─────────────────────────────────────────────────────────────────────────────
// § IV. APPARATUS HTTP §
// ─────────────────────────────────────────────────────────────────────────────

async function iniciarHTTP() {
  const aparatoHTTP = express();

  /* app.use(criarLimitadorRequisicoes());
   * Pesquisa como fazer
   * */

  aparatoHTTP.use(express.json({ limit: LIMITE_BYTES_REQUISICAO }));
  aparatoHTTP.use(express.urlencoded({ extended: true, limit: LIMITE_BYTES_REQUISICAO }));

  aparatoHTTP.use(
    cors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  aparatoHTTP.options("*", cors({ origin: true, credentials: true }));

  aparatoHTTP.post("/texto", async (req, res) => {
      soqueteWhatsApp.sendMessage(req.body.jidDestino, { text: req.body.texto })
      console.log(req.body.jidDestino)
      console.log(req.body.texto)
      return res.status(200).json({ ok: true });
  });

  aparatoHTTP.post("/midia", async (req, res) => {
      
    

  });

  aparatoHTTP.listen(PORTA_DO_TELEGRAFO, () => {
    registroCientifico.info(
      { PORTA_DO_TELEGRAFO },
      "Telegrafo de cartas navegando no grande Éter"
    );
  });
}

(async () => {
  registroCientifico.info("══════════════════════════════════════════════════════");
  registroCientifico.info("  Ligando Servidor Telegráfico BAILEYS");
  registroCientifico.info("══════════════════════════════════════════════════════");

  await iniciarHTTP();
  await iniciarConexaoWhatsApp();

  registroCientifico.info("Todos os subsistemas operacionais — o experimento está em curso.");
})().catch((erroFatal) => {
  registroCientifico.error(
    { erroFatal },
    "Colapso irrecuperável do referencial — o cosmos entrou em singularidade. Encerrando."
  );
  process.exit(1);
});
