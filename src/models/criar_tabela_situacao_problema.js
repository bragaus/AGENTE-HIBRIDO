import dotenv from "dotenv";
dotenv.config({ path: "/home/bragaus/Documentos/MEUTUTOR/AGENTE_HIBRIDO_BACKEND/.env" });
import { desafios } from "./situacao_problema.js"; // ajuste o path
import { Sequelize, DataTypes, Model } from "sequelize";
import { sequelize } from "../BANCO_DE_DADOS/sequelize.js";
console.log(process.env.DATABASE_URL)

async function main() {
  try {
    await sequelize.authenticate();
    await desafios.sync({ alter: true }); // alter:false = não mexe em tabela existente
    await sequelize.close();
  } catch (err) {
    console.error("❌ Erro:", err);
    process.exit(1);
  }
}

main();
