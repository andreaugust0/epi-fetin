import {
  FACENET_IMAGE_SIZE,
  PreprocessError,
  l2Norm,
  rgbaToChwTensor,
  standardizePixel,
} from '../facenetPreprocess';
import { FACENET_INPUT_LENGTH } from '../facenetProbeCore';

/** RGBA sintético de `size`x`size`, com um valor fixo por canal. */
const makeRgba = (size: number, r: number, g: number, b: number): Uint8Array => {
  const buffer = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buffer[i * 4] = r;
    buffer[i * 4 + 1] = g;
    buffer[i * 4 + 2] = b;
    buffer[i * 4 + 3] = 255;
  }
  return buffer;
};

describe('padronização de pixels', () => {
  it('reproduz (x - 127.5) / 128 do facenet-pytorch', () => {
    expect(standardizePixel(0)).toBeCloseTo(-0.99609375, 8);
    expect(standardizePixel(127)).toBeCloseTo(-0.00390625, 8);
    expect(standardizePixel(128)).toBeCloseTo(0.00390625, 8);
    expect(standardizePixel(255)).toBeCloseTo(0.99609375, 8);
  });

  it('mantém a saída dentro de [-1, 1]', () => {
    for (let pixel = 0; pixel <= 255; pixel += 1) {
      const valor = standardizePixel(pixel);
      expect(valor).toBeGreaterThan(-1);
      expect(valor).toBeLessThan(1);
    }
  });

  it('não é pixel/255 nem normalização do ImageNet', () => {
    // Um cinza médio vira ~0, não 0.5 — é o erro clássico deste passo.
    expect(standardizePixel(128)).not.toBeCloseTo(128 / 255, 3);
    expect(Math.abs(standardizePixel(128))).toBeLessThan(0.01);
  });
});

describe('conversão RGBA para tensor CHW', () => {
  it('produz exatamente 76800 valores para 160x160', () => {
    const tensor = rgbaToChwTensor(makeRgba(FACENET_IMAGE_SIZE, 10, 20, 30));

    expect(tensor).toHaveLength(FACENET_INPUT_LENGTH);
    expect(tensor).toHaveLength(76800);
    expect(tensor).toBeInstanceOf(Float32Array);
  });

  it('agrupa por canal, não por pixel', () => {
    const size = 2;
    const tensor = rgbaToChwTensor(makeRgba(size, 0, 128, 255), size);
    const pixels = size * size;

    // Todo o canal R primeiro, depois G, depois B.
    for (let i = 0; i < pixels; i += 1) {
      expect(tensor[i]).toBeCloseTo(standardizePixel(0), 6);
      expect(tensor[pixels + i]).toBeCloseTo(standardizePixel(128), 6);
      expect(tensor[pixels * 2 + i]).toBeCloseTo(standardizePixel(255), 6);
    }
  });

  it('preserva a ordem RGB e descarta o alpha', () => {
    const size = 1;
    const rgba = new Uint8Array([10, 20, 30, 200]);
    const tensor = rgbaToChwTensor(rgba, size);

    expect(tensor).toHaveLength(3);
    expect(tensor[0]).toBeCloseTo(standardizePixel(10), 6);
    expect(tensor[1]).toBeCloseTo(standardizePixel(20), 6);
    expect(tensor[2]).toBeCloseTo(standardizePixel(30), 6);
    // O alpha não aparece em lugar nenhum do tensor.
    expect(Array.from(tensor)).not.toContain(standardizePixel(200));
  });

  it('recusa buffer de tamanho inesperado em vez de truncar', () => {
    expect(() => rgbaToChwTensor(new Uint8Array(100), FACENET_IMAGE_SIZE)).toThrow(PreprocessError);
  });

  it('a mensagem de erro diz o tamanho recebido e o esperado', () => {
    expect(() => rgbaToChwTensor(new Uint8Array(8), 2)).toThrow(/8 valores, esperado 16/);
  });
});

describe('norma L2', () => {
  it('calcula a norma de um vetor conhecido', () => {
    expect(l2Norm([3, 4])).toBeCloseTo(5, 8);
  });

  it('devolve 1 para um vetor unitário', () => {
    const v = [0.6, 0.8];
    expect(l2Norm(v)).toBeCloseTo(1, 8);
  });
});
