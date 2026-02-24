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
import multer from "multer";
import dotenv from "dotenv";
dotenv.config({
  path: "/home/bragaus/Documentos/MEUTUTOR/AGENTE_HIBRIDO_BACKEND/.env",
});
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
// ─────────────────────────────────────────────────────────────────────────────
// § II. CONSTANTES FUNDAMENTAIS DO SISTEMA — OS AXIOMAS DO EXPERIMENTO
//   Do mesmo modo que Euclides postulou seus axiomas geométricos, definimos
//   aqui os parâmetros imutáveis sobre os quais repousa todo o edifício lógico.
// ─────────────────────────────────────────────────────────────────────────────
const PORTA_DO_TELEGRAFO     = Number(process.env.PORTA_HTTP);
const DIRETORIO_CREDENCIAIS  = "./estado-auth";
const LIMITE_BYTES_REQUISICAO= Number(2 * 1024 * 1024);
const SEGREDO_DO_PORTAO      = process.env.TOKEN_API;
const CHAVE_OPENAI           = process.env.OPENAI_API_KEY;

/** URL interna do próprio servidor — ponto de acoplamento entre Baileys e a rota HTTP */
const URL_ENDPOINT_TRANSCRICAO = `http://localhost:7773/transcricao`;
console.log(URL_ENDPOINT_TRANSCRICAO)
// ─────────────────────────────────────────────────────────────────────────────
// § III. INSTANCIAÇÃO DOS INSTRUMENTOS DE MEDIÇÃO E OBSERVAÇÃO
//   O galvanômetro do cientista é aqui substituído pelo registro estruturado
//   de eventos, capaz de preservar a cronologia exata dos fenômenos observados.
// ─────────────────────────────────────────────────────────────────────────────
const registroCientifico = pino({
  level: process.env.LOG_NIVEL ?? "info",
  transport: { target: "pino-pretty", options: { colorize: true } },
});

const clienteOpenAI = new OpenAI({ apiKey: CHAVE_OPENAI });

// ─────────────────────────────────────────────────────────────────────────────
// § IV. APPARATUS HTTP — O TELÉGRAFO EM SI MESMO
//   A instância Express é declarada no escopo global do módulo, pois ela
//   representa o canal de comunicação partilhado entre todos os subsistemas,
//   análoga ao éter luminífero que permeia todo o espaço observável.
// ─────────────────────────────────────────────────────────────────────────────
const aparatoHTTP = express();

aparatoHTTP.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
aparatoHTTP.options("*", cors({ origin: true, credentials: true }));

/**
 * Instrumento de recepção de ficheiros multipartes.
 * Mantém o conteúdo binário em memória volátil (Buffer), adequado para
 * transmissão imediata às câmaras de análise da OpenAI.
 */
const receptorMultipartes = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB — limite imposto pela câmara de transcrição
});

// ─────────────────────────────────────────────────────────────────────────────
// § V. ESTADO MUTABLE DO SISTEMA — A "VARIÁVEL DE ESTADO" DA EXPERIÊNCIA
//   Variável única que preserva a referência ao soquete WhatsApp ativo,
//   permitindo o envio de mensagens em qualquer ponto do programa.
// ─────────────────────────────────────────────────────────────────────────────
let soqueteWhatsApp = null;

// ══════════════════════════════════════════════════════════════════════════════
//                     § VI. FUNÇÕES AUXILIARES PURAS
//   Estas funções não possuem efeitos colaterais observáveis, constituindo
//   assim verdadeiros "lemas" em nossa demonstração maior.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Converte um fluxo contínuo de fragmentos em um único corpus binário coerente.
 * Análogo à destilação fracionada: reunimos as frações em um único recipiente.
 *
 * @param {AsyncIterable} fluxo - Corrente de fragmentos binários
 * @returns {Promise<Buffer>}
 */
async function fluxoParaBuffer(fluxo) {
  const fragmentos = [];
  for await (const fragmento of fluxo) fragmentos.push(fragmento);
  return Buffer.concat(fragmentos);
}

/**
 * Desvela a mensagem contida em envelopes efêmeros ou de visualização única.
 * Como o naturalista que remove as camadas de tecido para examinar o órgão,
 * extraímos aqui o conteúdo fundamental da mensagem.
 *
 * @param {object} mensagemBaileys - Objeto de mensagem bruta do Baileys
 * @returns {object|null}
 */
function extrairMensagemNuclear(mensagemBaileys) {
  /* caso nao tenha conteudo no message  */
  if (!mensagemBaileys?.message) return null;

  let nucleo = mensagemBaileys.message;
  console.log(nucleo)


  // Desinvoltura do envelope efêmero (mensagens que se autodestroem)
  if (nucleo.ephemeralMessage?.message)   nucleo = nucleo.ephemeralMessage.message;

  // Desinvoltura dos envelopes de visualização única (primeira e segunda geração)
  if (nucleo.viewOnceMessage?.message)    nucleo = nucleo.viewOnceMessage.message;
  if (nucleo.viewOnceMessageV2?.message)  nucleo = nucleo.viewOnceMessageV2.message;

  return nucleo;
}

/**
 * Extrai o conteúdo textual clássico de uma mensagem, percorrendo as
 * variantes morfológicas conhecidas da espécie "mensagem WhatsApp".
 *
 * @param {object} mensagemBaileys
 * @returns {string}
 */
function extrairTextoConvencional(mensagemBaileys) {
  const conteudo = mensagemBaileys?.message;
  if (!conteudo) return "";

  return (
    conteudo.conversation                    ||
    conteudo.extendedTextMessage?.text       ||
    conteudo.imageMessage?.caption           ||
    conteudo.videoMessage?.caption           ||
    ""
  );
}

/**
 * Extrai o corpus binário do áudio contido na mensagem, seja ele
 * transmitido como nota de voz ou como documento anexo de natureza sonora.
 *
 * @param {object} mensagemBaileys
 * @returns {Promise<{buffer: Buffer, mimeType: string, fileName: string, segundos?: number, notaDeVoz?: boolean}|null>}
 */
async function extrairBufferDeAudio(mensagemBaileys) {
  const nucleo = extrairMensagemNuclear(mensagemBaileys);
  if (!nucleo) return null;

  const tipoDaEntidade = getContentType(nucleo);

  // ── Caso I: Nota de voz ou arquivo de áudio nativo do WhatsApp ──
  if (tipoDaEntidade === "audioMessage") {
    const entidadeAudio = nucleo.audioMessage;
    const corrente = await downloadContentFromMessage(entidadeAudio, "audio");
    const corpo = await fluxoParaBuffer(corrente);

    return {
      buffer:     corpo,
      mimeType:   entidadeAudio.mimetype ?? "audio/ogg; codecs=opus",
      fileName:   "audio.ogg",
      segundos:   entidadeAudio.seconds,
      notaDeVoz:  entidadeAudio.ptt ?? false,
    };
  }

  // ── Caso II: Documento anexado com tipo MIME de natureza sonora ──
  if (tipoDaEntidade === "documentMessage") {
    const documento = nucleo.documentMessage;
    const mimeDoDocumento = documento.mimetype ?? "";
    if (!mimeDoDocumento.startsWith("audio/")) return null;

    const corrente = await downloadContentFromMessage(documento, "document");
    const corpo = await fluxoParaBuffer(corrente);

    return {
      buffer:    corpo,
      mimeType:  mimeDoDocumento,
      fileName:  documento.fileName ?? "audio.bin",
    };
  }

  return null;
}

/**
 * Submete o corpus binário de áudio à câmara de transcrição da OpenAI,
 * obtendo em retorno a representação textual do conteúdo fonético.
 * Guarda de segurança: o limite de 25 MB é lei inflexível da câmara.
 *
 * @param {{ buffer: Buffer, fileName: string, idioma?: string }} parametros
 * @returns {Promise<string>}
 */
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
    model:    "gpt-4o-transcribe",
    file:     arquivoSubmetido,
    language: idioma,
  });

  return resultado.text;
}

/**
 * Algoritmo de retrocesso exponencial com ruído aditivo.
 * Inspirado na teoria do campo de Maxwell: evitamos ressonâncias
 * prejudiciais (thundering herd) introduzindo perturbações estocásticas.
 *
 * @param {number} tentativa   - Número ordinal da tentativa atual
 * @param {number} tetoMs      - Limite superior do intervalo de espera
 * @returns {number} Milissegundos de espera recomendados
 */
function calcularRetrocessoExponencial(tentativa, tetoMs = 30_000) {
  const componente_base  = Math.min(tetoMs, 500 * 2 ** tentativa);
  const perturbacao      = Math.floor(Math.random() * 250);
  return componente_base + perturbacao;
}

// ══════════════════════════════════════════════════════════════════════════════
//       § VII. TRANSMISSÃO INTERNA — ACOPLAMENTO ENTRE BAILEYS E HTTP
//   Esta função constitui a "correia de transmissão" entre o motor Baileys
//   e o mecanismo receptor da rota POST /transcricao.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Envia os dados de uma mensagem recebida para o endpoint interno /transcricao,
 * construindo um FormData multipartes com todos os campos pertinentes.
 * Se a mensagem contiver áudio, este é transcrito e incluído no envelope.
 *
 * @param {object} mensagemBaileys   - Objeto bruto proveniente do Baileys
 * @param {string} [transcricao]     - Transcrição fonética (se disponível)
 * @returns {Promise<void>}
 */
async function encaminharMensagemParaEndpoint(mensagemBaileys, transcricao = null) {
  const identificadorRemoto = mensagemBaileys?.key?.remoteJid ?? "desconhecido";

  console.log("================================== function do post")
  console.log(mensagemBaileys)
  console.log("====================================")
  console.log(transcricao)

  try {
    const respostaTelegrafo = await fetch(process.env.NN_URL, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({
         remetenteJid: identificadorRemoto,
         transcricaoAudio: transcricao ?? "",
       }),
    });

    console.log(respostaTelegrafo)

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

// ══════════════════════════════════════════════════════════════════════════════
//          § VIII. NÚCLEO BAILEYS — O MOTOR DA MÁQUINA TELEGRÁFICA
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Estabelece e mantém a conexão com o servidor WhatsApp via protocolo Baileys.
 * Esta função encarna o princípio da persistência: ao ser interrompida,
 * ela tenta restaurar a conexão através de retrocessos exponenciais,
 * como o barco que, mesmo após a tempestade, retorna ao seu curso.
 *
 * @returns {Promise<object>} Soquete WebSocket ativo
 */
async function iniciarConexaoWhatsApp() {
  // Recuperamos o estado quântico da sessão anterior (credenciais criptográficas)
  const { state: estadoDaSessao, saveCreds: preservarCredenciais } =
    await useMultiFileAuthState(DIRETORIO_CREDENCIAIS);

  const { version: versaoProtocolo } = await fetchLatestBaileysVersion();

  registroCientifico.info(
    { versaoProtocolo },
    "Versão do protocolo Baileys identificada — iniciando a conjunção com o servidor."
  );

  soqueteWhatsApp = makeWASocket({
    version:             versaoProtocolo,
    logger:              registroCientifico,
    auth: {
      creds: estadoDaSessao.creds,
      keys:  makeCacheableSignalKeyStore(estadoDaSessao.keys, registroCientifico),
    },
    emitOwnEvents:       false, // Ignoramos nossos próprios telegrama — evitamos o paradoxo
    markOnlineOnConnect: false, // Não perturbamos a presença social da conta
    syncFullHistory:     false, // Apenas o presente nos interessa
  });

  // ── Persistência das Credenciais: A Memória da Máquina ──
  soqueteWhatsApp.ev.on("creds.update", preservarCredenciais);

  // ── Controle de Reconexão ──
  let contadorDeTentativas = 0;

  soqueteWhatsApp.ev.on("connection.update", async (atualizacaoDeEstado) => {
    const { connection, lastDisconnect, qr: codigoQR } = atualizacaoDeEstado;

    // Fenômeno do QR: o observador deve "colapsar a função de onda" escaneando
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
      const sessaoDeslogada      = codigoDeEncerramento === DisconnectReason.loggedOut;

      registroCientifico.warn(
        { codigoDeEncerramento, sessaoDeslogada },
        "A conexão foi encerrada — investigando as causas do fenômeno."
      );

      if (sessaoDeslogada) {
        registroCientifico.error(
          "Sessão invalidada pelo servidor remoto. Faz-se necessária nova autenticação via QR."
        );
        return; // Não tentamos reconectar — seria fútil sem novas credenciais
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

  // ────────────────────────────────────────────────────────────────────────────
  // EVENTO I: messages.upsert — A Chegada do Telegrama
  //
  // Cada mensagem recebida é tratada como um novo espécime de laboratório:
  // identificamos sua natureza, extraímos seu conteúdo e o encaminhamos
  // ao endpoint de análise para processamento posterior.
  // ────────────────────────────────────────────────────────────────────────────
  soqueteWhatsApp.ev.on("messages.upsert", async (eventoDeChegada) => {
    // Aceitamos apenas notificações em tempo real e appendagens de histórico
    if (eventoDeChegada.type !== "notify" && eventoDeChegada.type !== "append") return;
      for (const mensagemRecebida of eventoDeChegada.messages ?? []) {

          //if (deveDescartarMensagem(mensagemRecebida)) continue;

          const identificadorRemoto = mensagemRecebida?.key?.remoteJid ?? "desconhecido";
          
          registroCientifico.info(
            { identificadorRemoto },
            "Novo espécime recebido — iniciando o processo de análise."
          );

          // ── Tentativa de extração e transcrição do áudio ──
          var  transcricaoFonetica = null;

          try {
            const corpusSonoro = await extrairBufferDeAudio(mensagemRecebida);

            if (corpusSonoro) {
              registroCientifico.info(
                { identificadorRemoto, bytes: corpusSonoro.buffer.length },
                "Corpus sonoro detectado — submetendo à câmara de transcrição fonética."
              );

              transcricaoFonetica = await transcreverAudioViaOpenAI({
                buffer:   corpusSonoro.buffer,
                fileName: corpusSonoro.fileName,
                idioma:   "en",
              });
              
              console.log(transcricaoFonetica)

              registroCientifico.info(
                { identificadorRemoto, transcricao: transcricaoFonetica },
                "Transcrição concluída com êxito — o fenômeno acústico foi convertido em grafemas."
              );

              const respostaPSQL = await fetch(process.env.NN_URL, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json",
                },
                body: JSON.stringify({ identificadorRemoto, transcricaoFonetica }),
              });
             
            }
      } catch (erroTranscricao) {
        registroCientifico.warn(
          { erroTranscricao, identificadorRemoto },
          "Falha na transcrição — prosseguiremos sem ela."
        );
      }
      // ── Encaminhamento ao endpoint interno ──
      // await encaminharMensagemParaEndpoint(mensagemRecebida, transcricaoFonetica);
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // EVENTO II: messages.reaction — A Reação ao Telegrama
  //
  // As reações (emojis) constituem um fenômeno paralelo às mensagens textuais,
  // análogo às anotações marginais que os estudiosos apõem aos manuscritos.
  // Observamo-las separadamente para preservar a integridade taxonômica.
  // ────────────────────────────────────────────────────────────────────────────
  return soqueteWhatsApp;
}

// ══════════════════════════════════════════════════════════════════════════════
//        § IX. MIDDLEWARE DE AUTENTICAÇÃO — O GUARDA DO PORTÃO
//   Apenas portadores do token secreto poderão fazer uso dos recursos
//   do servidor. A ciência exige rigor tanto na metodologia quanto no acesso.
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Intercepta as requisições e verifica a posse do token de autenticação.
 * Se o SEGREDO_DO_PORTAO estiver vazio, o acesso é liberado a todos —
 * útil em ambiente de desenvolvimento, perigoso em produção.
 */
function verificarTokenDeAcesso(requisicao, resposta, proximo) {
 /* if (!SEGREDO_DO_PORTAO) return proximo();

  const cabecalhoAutorizacao = String(requisicao.headers.authorization ?? "");
  const tokenValido = cabecalhoAutorizacao === `Bearer ${SEGREDO_DO_PORTAO}`;

  if (!tokenValido) {
    return resposta
      .status(401)
      .json({ ok: false, erro: "Token de acesso inválido ou ausente — acesso negado." });
  }*/

  proximo();
}

// ══════════════════════════════════════════════════════════════════════════════
//      § X. ROTAS HTTP — AS ESTAÇÕES RECEPTORAS DO SISTEMA TELEGRÁFICO
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  POST /transcricao                                                      │
 * │                                                                         │
 * │  Estação central de recepção de mensagens e transcrições.               │
 * │  Aceita um envelope multipartes contendo campos textuais e,             │
 * │  opcionalmente, arquivos binários (áudios e documentos de apoio).       │
 * │                                                                         │
 * │  Campos esperados no FormData:                                          │
 * │   - remetenteJid        : identificador JID do remetente                │
 * │   - textoConvencional   : corpo textual da mensagem                     │
 * │   - transcricaoAudio    : resultado da transcrição fonética             │
 * │   - recebidoEm          : carimbo temporal ISO 8601                     │
 * │   - mensagemCompleta    : JSON serializado do objeto bruto              │
 * │   - tipo                : "mensagem" | "reacao"                         │
 * │   - arquivoApoio        : ficheiro auxiliar (opcional, 1 ficheiro)      │
 * │   - audios              : ficheiros de áudio adicionais (opcional, 20)  │
 * └─────────────────────────────────────────────────────────────────────────┘
 */


// ══════════════════════════════════════════════════════════════════════════════
//         § XI. INICIALIZAÇÃO DO COSMOS — O "BIG BANG" DO SERVIDOR
//   Assim como o universo emergiu de um ponto singular de energia concentrada,
//   nosso servidor inicia-se a partir deste bloco assíncrono fundamental.
// ══════════════════════════════════════════════════════════════════════════════

(async () => {
  registroCientifico.info("══════════════════════════════════════════════════════");
  registroCientifico.info("  Servidor Telegráfico WhatsApp — Inicialização       ");
  registroCientifico.info("══════════════════════════════════════════════════════");

  // Passo I: Erguemos o servidor HTTP antes de conectar ao WhatsApp,
  //          pois ele precisa estar pronto para receber os primeiros telegramas
  await new Promise((resolver) => {
    aparatoHTTP.listen(PORTA_DO_TELEGRAFO, () => {
      registroCientifico.info(
        { porta: PORTA_DO_TELEGRAFO },
        "Servidor HTTP erguido — as portas do laboratório estão abertas."
      );
      resolver();
    });
  });

  // Passo II: Estabelecemos a conexão com o WhatsApp
  await iniciarConexaoWhatsApp();

  registroCientifico.info(
    "Todos os subsistemas operacionais — o experimento está em curso."
  );
})().catch((erroFatal) => {
  registroCientifico.error(
    { erroFatal },
    "Colapso irrecuperável do referencial — o cosmos entrou em singularidade. Encerrando."
  );
  process.exit(1);
});
