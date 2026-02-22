import dotenv from "dotenv";
dotenv.config({ path: "/home/bragaus/Documentos/MEUTUTOR/AGENTE_HIBRIDO_BACKEND/.env" });
import { Sequelize } from "sequelize";
console.log(process.env.DATABASE_URL)
export const sequelize = new Sequelize(process.env.DATABASE_URL, {
    username: process.env.NOME_DO_USUARIO,
    password: process.env.SENHA_DO_BANCO,
    database: process.env.NOME_DO_BANCO,
    host: process.env.HOST,
    port: process.env.PORTA_DO_POSTGRES,
    dialect: process.env.DIALECT,
    logging: true,
});

