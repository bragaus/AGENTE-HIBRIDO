import fs from "node:fs";
import path from "node:path";

/**
 * Lê arquivo local com verificação de caminho (anti path traversal).
 * Em termos antigos: “não aceiteis cartas que venham por atalhos suspeitos”.
 */
export function lerArquivoLocalCautelosamente(caminhoArquivo) {
  const caminhoAbsoluto = path.resolve(caminhoArquivo);

  // Política: só aceitar caminhos dentro do diretório atual do projeto
  const raizProjeto = path.resolve(process.cwd());
  if (!caminhoAbsoluto.startsWith(raizProjeto + path.sep)) {
    throw new Error("Caminho de arquivo não permitido.");
  }

  if (!fs.existsSync(caminhoAbsoluto)) {
    throw new Error("Arquivo não encontrado.");
  }

  return { caminhoAbsoluto };
}

/**
 * Determina um mimetype razoável pelo sufixo.
 * Para produção séria, preferi uma tabela completa; aqui mantemos o essencial.
 */
export function mimetypePorExtensao(caminhoAbsoluto) {
  const ext = path.extname(caminhoAbsoluto).toLowerCase();
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

