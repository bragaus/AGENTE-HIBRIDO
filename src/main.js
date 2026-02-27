// bloquear logs internos
require("./utils/filterLogs")();

// baileys
const P = require("pino");
const {
  default: makeWASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require("baileys");

// módulos itnernos
const { getAuthState } = require("./auth");
const eventsConfig = require("./events");

// cache para controle interno do baileys
const { NodeCache } = require("@cacheable/node-cache");
const msgRetryCounterCache = new NodeCache();

async function startSock() {
  const { state, saveCreds } = await getAuthState();
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(
    `💻 versão do websocket v${version[0]}.${version[1]}\n💻 última versão: ${
      isLatest == true ? "sim" : "não"
    }`
  );

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys),
    },
    msgRetryCounterCache,
    generateHighQualityLinkPreview: true,
    logger: P({ level: "silent" }),
  });
  eventsConfig(sock, saveCreds);
}

module.exports = startSock; // necessário reiniciar caso a conexão caia (não apagar)

if (require.main === module) {
  startSock();
}
