import {
  EMBEDDING_DIM,
  FACE_DISTANCIA_MAX,
  FACE_RAZAO_MIN,
  MatchError,
  assertValidEmbedding,
  cosineDistance,
  matchAgainstGallery,
  type GalleryEntry,
} from '../matchEmbedding';

/** Vetor unitário sintético: 1 numa posição, 0 no resto. */
const unitAt = (index: number): number[] => {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[index] = 1;
  return v;
};

/** Vetor unitário entre dois eixos, para distâncias intermediárias. */
const blend = (a: number, b: number, peso: number): number[] => {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[a] = Math.cos(peso);
  v[b] = Math.sin(peso);
  return v;
};

const gallery = (): GalleryEntry[] => [
  { id: 1, nome: 'Alfa', embedding: unitAt(0) },
  { id: 2, nome: 'Beta', embedding: unitAt(1) },
  { id: 3, nome: 'Gama', embedding: unitAt(2) },
];

describe('distância de cosseno', () => {
  it('é zero entre vetores idênticos', () => {
    expect(cosineDistance(unitAt(0), unitAt(0))).toBeCloseTo(0, 10);
  });

  it('é 1 entre vetores ortogonais', () => {
    expect(cosineDistance(unitAt(0), unitAt(1))).toBeCloseTo(1, 10);
  });

  it('é 2 entre vetores opostos', () => {
    const oposto = unitAt(0).map((v) => -v);
    expect(cosineDistance(unitAt(0), oposto)).toBeCloseTo(2, 10);
  });
});

describe('validação de embeddings', () => {
  it('recusa dimensão diferente de 512', () => {
    expect(() => assertValidEmbedding([1, 2, 3], 'teste')).toThrow(MatchError);
    expect(() => assertValidEmbedding([1, 2, 3], 'teste')).toThrow(/dimensão 3/);
  });

  it('recusa NaN', () => {
    const v = unitAt(0);
    v[10] = Number.NaN;
    expect(() => assertValidEmbedding(v, 'teste')).toThrow(/não finito/);
  });

  it('recusa Infinity', () => {
    const v = unitAt(0);
    v[10] = Number.POSITIVE_INFINITY;
    expect(() => assertValidEmbedding(v, 'teste')).toThrow(/não finito/);
  });

  it('aceita um vetor válido', () => {
    expect(() => assertValidEmbedding(unitAt(0), 'teste')).not.toThrow();
  });
});

describe('comparação com a galeria', () => {
  it('ordena os candidatos por distância crescente', () => {
    const probe = blend(0, 1, 0.3);
    const resultado = matchAgainstGallery(probe, gallery());

    expect(resultado.candidates).toHaveLength(3);
    const distancias = resultado.candidates.map((c) => c.distance);
    expect(distancias).toEqual([...distancias].sort((a, b) => a - b));
    expect(resultado.best?.nome).toBe('Alfa');
  });

  it('devolve todos os candidatos, não só o vencedor', () => {
    const resultado = matchAgainstGallery(unitAt(0), gallery());

    expect(resultado.candidates.map((c) => c.nome).sort()).toEqual(['Alfa', 'Beta', 'Gama']);
  });

  it('auto-comparação de um item da galeria dá distância ~0', () => {
    const g = gallery();
    const primeiro = g[0] as GalleryEntry;
    const resultado = matchAgainstGallery(primeiro.embedding, g);

    expect(resultado.best?.nome).toBe('Alfa');
    expect(resultado.best?.distance).toBeCloseTo(0, 10);
  });

  it('não gera razão inválida quando a melhor distância é ~zero', () => {
    const g = gallery();
    const resultado = matchAgainstGallery((g[0] as GalleryEntry).embedding, g);

    // Sem proteção isto viraria Infinity.
    expect(resultado.ratio).toBeNull();
    expect(Number.isFinite(resultado.ratio ?? 0)).toBe(true);
  });

  it('calcula a razão entre segunda e melhor distância', () => {
    const probe = blend(0, 1, 0.3);
    const resultado = matchAgainstGallery(probe, gallery());
    const best = resultado.best?.distance as number;
    const second = resultado.second?.distance as number;

    expect(resultado.ratio).toBeCloseTo(second / best, 8);
  });

  it('aprova quando passa nos dois limiares', () => {
    // Praticamente idêntico a Alfa, mas não exatamente.
    const probe = blend(0, 1, 0.05);
    const resultado = matchAgainstGallery(probe, gallery());

    expect(resultado.best?.distance).toBeLessThanOrEqual(FACE_DISTANCIA_MAX);
    expect(resultado.ratio).toBeGreaterThanOrEqual(FACE_RAZAO_MIN);
    expect(resultado.passes).toBe(true);
  });

  it('reprova por distância quando ninguém está próximo', () => {
    // Eixo que a galeria não ocupa: ortogonal a todos, distância 1 de cada.
    const resultado = matchAgainstGallery(unitAt(5), gallery());

    expect(resultado.best?.distance).toBeCloseTo(1, 8);
    expect(resultado.passesDistance).toBe(false);
    expect(resultado.passes).toBe(false);
  });

  it('reprova por razão quando dois candidatos empatam', () => {
    // Equidistante de Alfa e Beta: ambíguo por construção.
    const g: GalleryEntry[] = [
      { id: 1, nome: 'Alfa', embedding: blend(0, 1, 0.1) },
      { id: 2, nome: 'Beta', embedding: blend(0, 1, -0.1) },
    ];
    const resultado = matchAgainstGallery(unitAt(0), g);

    expect(resultado.passesDistance).toBe(true);
    expect(resultado.ratio).toBeLessThan(FACE_RAZAO_MIN);
    expect(resultado.passes).toBe(false);
  });

  it('com um único cadastrado, a distância decide sozinha', () => {
    const g: GalleryEntry[] = [{ id: 1, nome: 'Alfa', embedding: blend(0, 1, 0.05) }];
    const resultado = matchAgainstGallery(unitAt(0), g);

    expect(resultado.second).toBeNull();
    expect(resultado.ratio).toBeNull();
    expect(resultado.passes).toBe(resultado.passesDistance);
  });

  it('recusa embedding capturado inválido antes de comparar', () => {
    expect(() => matchAgainstGallery([1, 2, 3], gallery())).toThrow(/Embedding capturado/);
  });

  it('não altera os limiares de referência', () => {
    expect(FACE_DISTANCIA_MAX).toBe(0.4);
    expect(FACE_RAZAO_MIN).toBe(1.15);
  });
});

describe('propagação do id da galeria', () => {
  it('cada candidato carrega o id da GalleryEntry de origem, não um índice', () => {
    // IDs deliberadamente fora de ordem e não sequenciais a partir de 0: se o
    // código regredisse para usar a posição no array, o teste pegaria.
    const g: GalleryEntry[] = [
      { id: 30, nome: 'Alfa', embedding: unitAt(0) },
      { id: 10, nome: 'Beta', embedding: unitAt(1) },
      { id: 20, nome: 'Gama', embedding: unitAt(2) },
    ];
    const resultado = matchAgainstGallery(unitAt(1), g);

    const porNome = new Map(resultado.candidates.map((c) => [c.nome, c.id]));
    expect(porNome.get('Alfa')).toBe(30);
    expect(porNome.get('Beta')).toBe(10);
    expect(porNome.get('Gama')).toBe(20);
  });

  it('best.id corresponde ao id real de quem venceu', () => {
    const g: GalleryEntry[] = [
      { id: 111, nome: 'Alfa', embedding: unitAt(0) },
      { id: 222, nome: 'Beta', embedding: unitAt(1) },
    ];
    const resultado = matchAgainstGallery(unitAt(0), g);

    expect(resultado.best?.nome).toBe('Alfa');
    expect(resultado.best?.id).toBe(111);
  });

  it('second.id corresponde ao id real do segundo colocado', () => {
    const probe = blend(0, 1, 0.3);
    const g: GalleryEntry[] = [
      { id: 111, nome: 'Alfa', embedding: unitAt(0) },
      { id: 222, nome: 'Beta', embedding: unitAt(1) },
      { id: 333, nome: 'Gama', embedding: unitAt(2) },
    ];
    const resultado = matchAgainstGallery(probe, g);

    expect(resultado.second?.nome).toBe('Beta');
    expect(resultado.second?.id).toBe(222);
  });

  it('a propagação do id não muda ordenação, ratio, nem passes', () => {
    const probe = blend(0, 1, 0.05);
    const resultado = matchAgainstGallery(probe, gallery());

    // Mesmos números já cobertos acima ("aprova quando passa nos dois
    // limiares"), agora reafirmados junto da checagem de id.
    expect(resultado.best?.id).toBe(1);
    expect(resultado.best?.distance).toBeLessThanOrEqual(FACE_DISTANCIA_MAX);
    expect(resultado.ratio).toBeGreaterThanOrEqual(FACE_RAZAO_MIN);
    expect(resultado.passes).toBe(true);
  });
});
