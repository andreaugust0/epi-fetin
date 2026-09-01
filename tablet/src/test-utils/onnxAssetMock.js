// Metro resolve o `require` de um asset binário (como o modelo .onnx) para um
// ID numérico de módulo; o Jest não tem esse resolvedor, então mapeamos aqui
// para o mesmo formato. Só passa a importar de fato quando algum teste
// alcança `FaceNetSession.ts` — antes disso nada exercitava esse caminho.
module.exports = 1;
