/**
 * Geometria do recorte facial. Nada aqui toca câmera, ML Kit ou ONNX — é
 * aritmética pura, para poder ser testada sem dispositivo.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const boxArea = (box: Box): number => Math.max(0, box.width) * Math.max(0, box.height);

/** O maior rosto por área. Nulo quando a lista está vazia. */
export const pickLargestBox = <T extends { box: Box }>(items: readonly T[]): T | null =>
  items.reduce<T | null>(
    (maior, item) => (maior === null || boxArea(item.box) > boxArea(maior.box) ? item : maior),
    null,
  );

/**
 * Transforma a caixa do detector num quadrado centrado, preso aos limites da
 * imagem.
 *
 * O enrollment usou MTCNN, cujas caixas são aproximadamente quadradas. Esticar
 * um retângulo direto para 160x160 deformaria o rosto e afastaria o embedding
 * do que a galeria contém. Isto é uma **aproximação** daquele enquadramento,
 * não uma reprodução: nenhuma margem é adicionada, exatamente como no
 * enrollment com `margin=0`.
 *
 * Quando o quadrado ideal não cabe na imagem, o lado encolhe até caber — é
 * preferível a um recorte deslocado ou a pixels vazios.
 */
export const toSquareBox = (box: Box, imageWidth: number, imageHeight: number): Box => {
  const limite = Math.min(imageWidth, imageHeight);
  const lado = Math.min(Math.max(box.width, box.height), limite);

  const centroX = box.x + box.width / 2;
  const centroY = box.y + box.height / 2;

  // `clamp` mantém o quadrado inteiro dentro da imagem, deslocando-o em vez
  // de cortá-lo.
  const x = clamp(centroX - lado / 2, 0, imageWidth - lado);
  const y = clamp(centroY - lado / 2, 0, imageHeight - lado);

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(lado),
    height: Math.round(lado),
  };
};

const clamp = (valor: number, minimo: number, maximo: number): number =>
  Math.min(Math.max(valor, minimo), Math.max(minimo, maximo));

/** Formata uma caixa para leitura no diagnóstico. */
export const formatBox = (box: Box | null): string =>
  box ? `x ${box.x} · y ${box.y} · w ${box.width} · h ${box.height}` : '—';
