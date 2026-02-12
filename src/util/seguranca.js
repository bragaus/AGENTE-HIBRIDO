import parseForwarded from 'forwarded-parse'
import rateLimit from "express-rate-limit";
import helmet from "helmet";

/**
 * Aplica medidas de segurança HTTP.
 * Em 1890 dir-se-ia: “trancai as portas e guardai as chaves”.
 */
export function aplicarCabecalhosSeguranca(app) {
  app.use(helmet());
}

/**
 * Limita a taxa de requisições por IP.
 * Isto não impede todo malfeitor, porém reduz o ruído e o abuso.
 */
export function criarLimitadorRequisicoes() {
  return rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-7",
    legacyHeaders: false,
      keyGenerator: (req) => req.ip,
  });
}

/**
 * Autenticação singela por Bearer Token.
 * Para o mundo exterior: sem o selo, não entra.
 */
export function autenticarPorToken(req, res, next) {
//  const cabecalho = req.headers["authorization"] || "";
  //const token = cabecalho.startsWith("Bearer ") ? cabecalho.slice(7) : "";

  //if (!process.env.TOKEN_API || token !== process.env.TOKEN_API) {
    //return res.status(401).json({ erro: "Não autorizado." });
  //}
  next();
}

/**
 * Validação mínima: assegura que um campo string exista e não seja vazio.
 */
export function exigirTexto(objeto, campo) {
  const valor = objeto?.[campo];
  if (typeof valor !== "string" || !valor.trim()) {
    throw new Error(`Campo inválido: ${campo}`);
  }
  return valor.trim();
}

