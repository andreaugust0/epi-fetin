import { boxArea, formatBox, pickLargestBox, toSquareBox } from '../faceGeometry';

describe('escolha do maior rosto', () => {
  it('devolve nulo quando não há rostos', () => {
    expect(pickLargestBox([])).toBeNull();
  });

  it('escolhe por área, não por largura', () => {
    const estreitoAlto = { box: { x: 0, y: 0, width: 10, height: 100 } };
    const largoBaixo = { box: { x: 0, y: 0, width: 30, height: 20 } };

    // 1000 contra 600: o mais estreito vence porque é bem mais alto.
    expect(pickLargestBox([largoBaixo, estreitoAlto])).toBe(estreitoAlto);
  });

  it('mantém o primeiro quando há empate', () => {
    const a = { box: { x: 0, y: 0, width: 10, height: 10 } };
    const b = { box: { x: 5, y: 5, width: 10, height: 10 } };

    expect(pickLargestBox([a, b])).toBe(a);
  });

  it('calcula área e ignora dimensões negativas', () => {
    expect(boxArea({ x: 0, y: 0, width: 4, height: 5 })).toBe(20);
    expect(boxArea({ x: 0, y: 0, width: -4, height: 5 })).toBe(0);
  });
});

describe('quadratura da caixa', () => {
  it('usa o maior lado e mantém o centro', () => {
    const quadrado = toSquareBox({ x: 100, y: 100, width: 40, height: 80 }, 1000, 1000);

    expect(quadrado.width).toBe(80);
    expect(quadrado.height).toBe(80);
    // Centro original: x 120, y 140 — preservado.
    expect(quadrado.x + quadrado.width / 2).toBeCloseTo(120, 0);
    expect(quadrado.y + quadrado.height / 2).toBeCloseTo(140, 0);
  });

  it('não adiciona margem alguma', () => {
    const box = { x: 10, y: 10, width: 50, height: 50 };
    const quadrado = toSquareBox(box, 1000, 1000);

    expect(quadrado).toEqual(box);
  });

  it('desloca em vez de sair pela borda esquerda', () => {
    // Centro em x=30 com lado 100 colocaria a borda em -20.
    const quadrado = toSquareBox({ x: -20, y: 200, width: 100, height: 100 }, 1000, 1000);

    expect(quadrado.x).toBe(0);
    expect(quadrado.width).toBe(100);
  });

  it('deixa quieta a caixa que já cabe', () => {
    const quadrado = toSquareBox({ x: 5, y: 200, width: 100, height: 100 }, 1000, 1000);

    expect(quadrado.x).toBe(5);
    expect(quadrado.width).toBe(100);
  });

  it('desloca em vez de sair pela borda direita', () => {
    const quadrado = toSquareBox({ x: 950, y: 200, width: 100, height: 100 }, 1000, 1000);

    expect(quadrado.x + quadrado.width).toBeLessThanOrEqual(1000);
  });

  it('encolhe o lado quando o quadrado não cabe na imagem', () => {
    // Imagem estreita: o lado não pode passar de 200.
    const quadrado = toSquareBox({ x: 0, y: 0, width: 300, height: 300 }, 200, 1000);

    expect(quadrado.width).toBe(200);
    expect(quadrado.height).toBe(200);
    expect(quadrado.x).toBe(0);
  });

  it('o resultado sempre cabe dentro da imagem', () => {
    const casos = [
      { box: { x: -20, y: -30, width: 120, height: 60 }, w: 480, h: 640 },
      { box: { x: 400, y: 600, width: 200, height: 100 }, w: 480, h: 640 },
      { box: { x: 10, y: 10, width: 5, height: 900 }, w: 480, h: 640 },
    ];

    for (const caso of casos) {
      const q = toSquareBox(caso.box, caso.w, caso.h);
      expect(q.x).toBeGreaterThanOrEqual(0);
      expect(q.y).toBeGreaterThanOrEqual(0);
      expect(q.x + q.width).toBeLessThanOrEqual(caso.w);
      expect(q.y + q.height).toBeLessThanOrEqual(caso.h);
      expect(q.width).toBe(q.height);
    }
  });

  it('devolve valores inteiros, próprios para recorte de pixels', () => {
    const q = toSquareBox({ x: 10.7, y: 20.3, width: 33.3, height: 44.9 }, 500, 500);

    expect(Number.isInteger(q.x)).toBe(true);
    expect(Number.isInteger(q.y)).toBe(true);
    expect(Number.isInteger(q.width)).toBe(true);
    expect(Number.isInteger(q.height)).toBe(true);
  });
});

describe('formatação para o diagnóstico', () => {
  it('formata uma caixa', () => {
    expect(formatBox({ x: 1, y: 2, width: 3, height: 4 })).toBe('x 1 · y 2 · w 3 · h 4');
  });

  it('indica ausência', () => {
    expect(formatBox(null)).toBe('—');
  });
});
