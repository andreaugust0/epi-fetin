import { FaceDetector, FaceDetectorError } from '../faceDetector';

/**
 * Detector com a resposta nativa controlada pelo teste.
 *
 * `initialize()` faz `import()` dinâmico do módulo nativo, que o VM do Jest
 * não executa; como o alvo aqui é a leitura do retorno, o duplo é injetado
 * direto no campo interno. A feiura fica contida neste arquivo.
 */
const detectorCom = (resposta: unknown): FaceDetector => {
  const detector = new FaceDetector();
  (detector as unknown as { detector: unknown }).detector = {
    status: 'ready',
    initialize: async () => undefined,
    detectFaces: async () => resposta,
  };
  return detector;
};

/** Rosto no formato que o ML Kit realmente devolve: `origin` e `size`. */
const mlkitFace = (x: number, y: number, w: number, h: number) => ({
  frame: { origin: { x, y }, size: { x: w, y: h } },
  headEulerAngleX: 1,
  headEulerAngleY: 2,
  headEulerAngleZ: 3,
  trackingID: 7,
});

describe('contrato de retorno do ML Kit', () => {
  it('aceita o retorno real do Android, que não traz `success` nem `error`', async () => {
    // É exatamente o record nativo: só `faces` e `imagePath`.
    const detector = detectorCom({
      faces: [mlkitFace(10, 20, 30, 40)],
      imagePath: 'file:///foto.jpg',
    });

    const rostos = await detector.detect('file:///foto.jpg');

    expect(rostos).toHaveLength(1);
    expect(rostos[0]?.box).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('não rejeita um retorno válido por causa de `success` ausente', async () => {
    const detector = detectorCom({ faces: [mlkitFace(0, 0, 5, 5)] });

    await expect(detector.detect('file:///foto.jpg')).resolves.toHaveLength(1);
  });

  it('converte origin/size para x/y/width/height', async () => {
    const detector = detectorCom({ faces: [mlkitFace(100, 200, 300, 400)] });

    const [rosto] = await detector.detect('file:///foto.jpg');

    expect(rosto?.box.width).toBe(300);
    expect(rosto?.box.height).toBe(400);
  });

  it('propaga ângulos de cabeça e trackingId', async () => {
    const detector = detectorCom({ faces: [mlkitFace(0, 0, 1, 1)] });

    const [rosto] = await detector.detect('file:///foto.jpg');

    expect(rosto?.headEulerAngleX).toBe(1);
    expect(rosto?.headEulerAngleY).toBe(2);
    expect(rosto?.headEulerAngleZ).toBe(3);
    expect(rosto?.trackingId).toBe(7);
  });

  it('usa nulo quando os campos opcionais não vêm', async () => {
    const detector = detectorCom({
      faces: [{ frame: { origin: { x: 0, y: 0 }, size: { x: 1, y: 1 } } }],
    });

    const [rosto] = await detector.detect('file:///foto.jpg');

    expect(rosto?.headEulerAngleX).toBeNull();
    expect(rosto?.trackingId).toBeNull();
  });
});

describe('nenhum rosto não é falha técnica', () => {
  it('devolve lista vazia sem lançar', async () => {
    const detector = detectorCom({ faces: [], imagePath: 'file:///foto.jpg' });

    await expect(detector.detect('file:///foto.jpg')).resolves.toEqual([]);
  });
});

describe('retornos realmente inválidos', () => {
  it('lança quando o nativo não devolve nada', async () => {
    // A biblioteca devolve `undefined` quando a chamada nativa lança.
    const detector = detectorCom(undefined);

    await expect(detector.detect('file:///foto.jpg')).rejects.toThrow(/não devolveu resultado/);
  });

  it('lança quando o retorno é nulo', async () => {
    const detector = detectorCom(null);

    await expect(detector.detect('file:///foto.jpg')).rejects.toThrow(FaceDetectorError);
  });

  it('lança quando `faces` está ausente', async () => {
    const detector = detectorCom({ imagePath: 'file:///foto.jpg' });

    await expect(detector.detect('file:///foto.jpg')).rejects.toThrow(/Resposta inválida/);
  });

  it('lança quando `faces` não é uma lista', async () => {
    const detector = detectorCom({ faces: 'nenhum' });

    await expect(detector.detect('file:///foto.jpg')).rejects.toThrow(/Resposta inválida/);
  });

  it('lança quando o detector não foi inicializado', async () => {
    const detector = new FaceDetector();

    await expect(detector.detect('file:///foto.jpg')).rejects.toThrow(/não foi inicializado/);
  });
});

describe('múltiplos rostos', () => {
  it('devolve todos, sem escolher — a seleção é do chamador', async () => {
    const detector = detectorCom({
      faces: [mlkitFace(0, 0, 10, 10), mlkitFace(50, 50, 80, 80), mlkitFace(200, 5, 20, 20)],
    });

    const rostos = await detector.detect('file:///foto.jpg');

    expect(rostos).toHaveLength(3);
    expect(rostos.map((r) => r.box.width)).toEqual([10, 80, 20]);
  });
});
