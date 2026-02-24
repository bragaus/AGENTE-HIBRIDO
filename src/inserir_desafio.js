// inserir_desafio.js
import "dotenv/config";
import { Sequelize, DataTypes, Model, Transaction } from "sequelize";

/**
 * Dependências mínimas:
 *   npm i sequelize pg pg-hstore
 *
 * Ambiente:
 *   DATABASE_URL="postgres://usuario:senha@host:5432/banco"
 */

const url_do_theatro = process.env.DATABASE_URL;
if (!url_do_theatro) {
  throw new Error("Falta DATABASE_URL no ambiente. Sem isso, o Postgres não canta.");
}

/**
 * Pool + logging off = menos ruído, mais rendimento.
 * prepared statements: o Sequelize usa bind parameters por padrão nas queries.
 */
const motor_das_leys = new Sequelize(url_do_theatro, {
  dialect: "postgres",
  logging: false,
  pool: {
    max: 10,
    min: 0,
    idle: 10_000,
    acquire: 30_000,
    evict: 10_000,
  },
  define: {
    timestamps: false,
    freezeTableName: true,
  },
});

class Desafios extends Model {}

Desafios.init(
  {
    ID: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    CursoID: { type: DataTypes.INTEGER, allowNull: false },
    OutroID: { type: DataTypes.INTEGER, allowNull: true, field: "OutroID" },

    Tipo: { type: DataTypes.STRING(30), allowNull: false },
    Titulo: { type: DataTypes.STRING(40), allowNull: false },
    DescricaoBreve: { type: DataTypes.STRING(80), allowNull: false },

    SituacaoProblemaTexto: { type: DataTypes.STRING(256), allowNull: false },
    SituacaoProblemaAudio: { type: DataTypes.BLOB("long"), allowNull: true }, // BYTEA

    Midia01: { type: DataTypes.BLOB("long"), allowNull: true }, // BYTEA
    Arquivo01: { type: DataTypes.BLOB("long"), allowNull: true }, // BYTEA

    RespostaParaSituacaoTexto: { type: DataTypes.STRING(512), allowNull: true },
    RespostaParaSituacaoAudio: { type: DataTypes.BLOB("long"), allowNull: true },

    DicaParaSituacaoTexto: { type: DataTypes.STRING(256), allowNull: true },
    DicaParaSituacaoAudio: { type: DataTypes.BLOB("long"), allowNull: true },

    SaibaMais: { type: DataTypes.STRING(80), allowNull: true },

    GrauDeDificuldade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    QuantidadeDeAcertos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    QuantidadeDeErros: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    Situacao: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "Em construção" },
  },
  {
    sequelize: motor_das_leys,
    tableName: "desafios",
    timestamps: false,
  }
);

function buffer_ou_nada(phantasma) {
  if (phantasma == null) return null;

  // já veio como Buffer (ideal)
  if (Buffer.isBuffer(phantasma)) return phantasma;

  // veio como base64 (com ou sem prefixo data:)
  if (typeof phantasma === "string") {
    const puro = phantasma.includes(",") ? phantasma.split(",").pop() : phantasma;
    return Buffer.from(puro, "base64");
  }

  throw new TypeError("Os campos BYTEA exigem Buffer ou base64 (string).");
}

/**
 * INSERT enxuto, com transacção e validação de mínimos.
 * - Não chama sync() (performance + não mexe no schema).
 * - fields: reduz o que vai pra query (evita lixo acidental no payload).
 */
async function lavrar_desafio_no_cartorio({
  // variáveis 1880-ish
  curso_id,
  outro_id = null,
  typo,
  titulo,
  descripcao_breve,
  situacao_problema_texto,

  situacao_problema_audio = null,
  midia01 = null,
  archivo01 = null,

  resposta_texto = null,
  resposta_audio = null,
  dica_texto = null,
  dica_audio = null,

  saiba_mais = null,

  grau_de_difficuldade = 1,
  quantidade_de_acertos = 0,
  quantidade_de_erros = 0,
  situacao = "Em construção",
}) {
  // Guardas (baratos e cruéis)
  if (!Number.isInteger(curso_id)) throw new Error("curso_id deve ser inteiro.");
  if (outro_id != null && !Number.isInteger(outro_id)) throw new Error("outro_id deve ser inteiro ou null.");

  if (!typo || !titulo || !descripcao_breve || !situacao_problema_texto) {
    throw new Error("Campos obrigatórios: typo, titulo, descripcao_breve, situacao_problema_texto.");
  }

  const lavratura = {
    CursoID: curso_id,
    OutroID: outro_id,

    Tipo: typo,
    Titulo: titulo,
    DescricaoBreve: descripcao_breve,

    SituacaoProblemaTexto: situacao_problema_texto,
    SituacaoProblemaAudio: buffer_ou_nada(situacao_problema_audio),

    Midia01: buffer_ou_nada(midia01),
    Arquivo01: buffer_ou_nada(archivo01),

    RespostaParaSituacaoTexto: resposta_texto,
    RespostaParaSituacaoAudio: buffer_ou_nada(resposta_audio),

    DicaParaSituacaoTexto: dica_texto,
    DicaParaSituacaoAudio: buffer_ou_nada(dica_audio),

    SaibaMais: saiba_mais,

    GrauDeDificuldade: grau_de_difficuldade,
    QuantidadeDeAcertos: quantidade_de_acertos,
    QuantidadeDeErros: quantidade_de_erros,

    Situacao: situacao,
  };

  const chaves = Object.keys(lavratura);

  return motor_das_leys.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
    async (transaccao) => {
      const creado = await Desafios.create(lavratura, {
        transaction: transaccao,
        fields: chaves,
        returning: true, // devolve a linha (inclui ID)
        validate: true,
      });

      // devolve JSON limpo (sem getters mágicos)
      return creado.get({ plain: true });
    }
  );
}

// ---------- execução (exemplo) ----------
await motor_das_leys.authenticate();

const desafio_novo = await lavrar_desafio_no_cartorio({
  curso_id: 7,
  outro_id: null,
  typo: "grammatica",
  titulo: "O verbo que não se rende",
  descripcao_breve: "Complete a frase com o tempo verbal correcto.",
  situacao_problema_texto: "I ____ to school yesterday.",
  // situacao_problema_audio: Buffer.from(...), // ou base64 string
  // midia01: Buffer.from(...),
  // archivo01: Buffer.from(...),
  resposta_texto: "went",
  dica_texto: "Pense no passado simples: ontem é um relógio que já deu meia-noite.",
  saiba_mais: "Past Simple (Irregular Verbs)",
  grau_de_difficuldade: 2,
});

console.log("✅ Desafio inserido:", { ID: desafio_novo.ID, Titulo: desafio_novo.Titulo });

await motor_das_leys.close();
/**
 * Dependências mínimas:
 *   npm i sequelize pg pg-hstore
 *
 * Ambiente:
 *   DATABASE_URL="postgres://usuario:senha@host:5432/banco"
 */

const url_do_theatro = process.env.DATABASE_URL;
if (!url_do_theatro) {
  throw new Error("Falta DATABASE_URL no ambiente. Sem isso, o Postgres não canta.");
}

/**
 * Pool + logging off = menos ruído, mais rendimento.
 * prepared statements: o Sequelize usa bind parameters por padrão nas queries.
 */
const motor_das_leys = new Sequelize(url_do_theatro, {
  dialect: "postgres",
  logging: false,
  pool: {
    max: 10,
    min: 0,
    idle: 10_000,
    acquire: 30_000,
    evict: 10_000,
  },
  define: {
    timestamps: false,
    freezeTableName: true,
  },
});

class Desafios extends Model {}

Desafios.init(
  {
    ID: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    CursoID: { type: DataTypes.INTEGER, allowNull: false },
    OutroID: { type: DataTypes.INTEGER, allowNull: true, field: "OutroID" },

    Tipo: { type: DataTypes.STRING(30), allowNull: false },
    Titulo: { type: DataTypes.STRING(40), allowNull: false },
    DescricaoBreve: { type: DataTypes.STRING(80), allowNull: false },

    SituacaoProblemaTexto: { type: DataTypes.STRING(256), allowNull: false },
    SituacaoProblemaAudio: { type: DataTypes.BLOB("long"), allowNull: true }, // BYTEA

    Midia01: { type: DataTypes.BLOB("long"), allowNull: true }, // BYTEA
    Arquivo01: { type: DataTypes.BLOB("long"), allowNull: true }, // BYTEA

    RespostaParaSituacaoTexto: { type: DataTypes.STRING(512), allowNull: true },
    RespostaParaSituacaoAudio: { type: DataTypes.BLOB("long"), allowNull: true },

    DicaParaSituacaoTexto: { type: DataTypes.STRING(256), allowNull: true },
    DicaParaSituacaoAudio: { type: DataTypes.BLOB("long"), allowNull: true },

    SaibaMais: { type: DataTypes.STRING(80), allowNull: true },

    GrauDeDificuldade: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    QuantidadeDeAcertos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    QuantidadeDeErros: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

    Situacao: { type: DataTypes.STRING(40), allowNull: false, defaultValue: "Em construção" },
  },
  {
    sequelize: motor_das_leys,
    tableName: "desafios",
    timestamps: false,
  }
);

function buffer_ou_nada(phantasma) {
  if (phantasma == null) return null;

  // já veio como Buffer (ideal)
  if (Buffer.isBuffer(phantasma)) return phantasma;

  // veio como base64 (com ou sem prefixo data:)
  if (typeof phantasma === "string") {
    const puro = phantasma.includes(",") ? phantasma.split(",").pop() : phantasma;
    return Buffer.from(puro, "base64");
  }

  throw new TypeError("Os campos BYTEA exigem Buffer ou base64 (string).");
}

/**
 * INSERT enxuto, com transacção e validação de mínimos.
 * - Não chama sync() (performance + não mexe no schema).
 * - fields: reduz o que vai pra query (evita lixo acidental no payload).
 */
async function lavrar_desafio_no_cartorio({
  // variáveis 1880-ish
  curso_id,
  outro_id = null,
  typo,
  titulo,
  descripcao_breve,
  situacao_problema_texto,

  situacao_problema_audio = null,
  midia01 = null,
  archivo01 = null,

  resposta_texto = null,
  resposta_audio = null,
  dica_texto = null,
  dica_audio = null,

  saiba_mais = null,

  grau_de_difficuldade = 1,
  quantidade_de_acertos = 0,
  quantidade_de_erros = 0,
  situacao = "Em construção",
}) {
  // Guardas (baratos e cruéis)
  if (!Number.isInteger(curso_id)) throw new Error("curso_id deve ser inteiro.");
  if (outro_id != null && !Number.isInteger(outro_id)) throw new Error("outro_id deve ser inteiro ou null.");

  if (!typo || !titulo || !descripcao_breve || !situacao_problema_texto) {
    throw new Error("Campos obrigatórios: typo, titulo, descripcao_breve, situacao_problema_texto.");
  }

  const lavratura = {
    CursoID: curso_id,
    OutroID: outro_id,

    Tipo: typo,
    Titulo: titulo,
    DescricaoBreve: descripcao_breve,

    SituacaoProblemaTexto: situacao_problema_texto,
    SituacaoProblemaAudio: buffer_ou_nada(situacao_problema_audio),

    Midia01: buffer_ou_nada(midia01),
    Arquivo01: buffer_ou_nada(archivo01),

    RespostaParaSituacaoTexto: resposta_texto,
    RespostaParaSituacaoAudio: buffer_ou_nada(resposta_audio),

    DicaParaSituacaoTexto: dica_texto,
    DicaParaSituacaoAudio: buffer_ou_nada(dica_audio),

    SaibaMais: saiba_mais,

    GrauDeDificuldade: grau_de_difficuldade,
    QuantidadeDeAcertos: quantidade_de_acertos,
    QuantidadeDeErros: quantidade_de_erros,

    Situacao: situacao,
  };

  const chaves = Object.keys(lavratura);

  return motor_das_leys.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED },
    async (transaccao) => {
      const creado = await Desafios.create(lavratura, {
        transaction: transaccao,
        fields: chaves,
        returning: true, // devolve a linha (inclui ID)
        validate: true,
      });

      // devolve JSON limpo (sem getters mágicos)
      return creado.get({ plain: true });
    }
  );
}

// ---------- execução (exemplo) ----------
await motor_das_leys.authenticate();

const desafio_novo = await lavrar_desafio_no_cartorio({
  curso_id: 7,
  outro_id: null,
  typo: "grammatica",
  titulo: "O verbo que não se rende",
  descripcao_breve: "Complete a frase com o tempo verbal correcto.",
  situacao_problema_texto: "I ____ to school yesterday.",
  // situacao_problema_audio: Buffer.from(...), // ou base64 string
  // midia01: Buffer.from(...),
  // archivo01: Buffer.from(...),
  resposta_texto: "went",
  dica_texto: "Pense no passado simples: ontem é um relógio que já deu meia-noite.",
  saiba_mais: "Past Simple (Irregular Verbs)",
  grau_de_difficuldade: 2,
});

console.log("✅ Desafio inserido:", { ID: desafio_novo.ID, Titulo: desafio_novo.Titulo });

await motor_das_leys.close();
