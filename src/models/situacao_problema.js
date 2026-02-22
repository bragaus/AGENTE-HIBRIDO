import { Sequelize, DataTypes, Model } from "sequelize";
import dotenv from "dotenv";
import { sequelize } from "../BANCO_DE_DADOS/sequelize.js"
export class desafios extends Model {}

desafios.init(
  {
    ID: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },

    CursoID: { type: DataTypes.INTEGER, allowNull: false },
    OutroID: { type: DataTypes.INTEGER, allowNull: true, field: "OutroID" },

    Tipo: { type: DataTypes.STRING(30), allowNull: false },
    Titulo: { type: DataTypes.STRING(40), allowNull: false },
    DescricaoBreve: { type: DataTypes.STRING(80), allowNull: false },

    SituacaoProblemaTexto: { type: DataTypes.STRING(256), allowNull: false },
    SituacaoProblemaAudio: { type: DataTypes.BLOB("long"), allowNull: true }, // BYTEA

    Midia01: { type: DataTypes.BLOB("long"), allowNull: true },   // BYTEA
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
    sequelize, 
    tableName: "desafios",
    timestamps: false,
  }
);
