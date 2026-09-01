import {
  FACENET_EMBEDDING_LENGTH,
  FACENET_INPUT_LENGTH,
  checkProbeOutput,
  createProbeInput,
  formatDims,
} from '../facenetProbeCore';

describe('entrada artificial do FaceNet', () => {
  it('tem os 76800 valores exigidos por [1, 3, 160, 160]', () => {
    expect(FACENET_INPUT_LENGTH).toBe(76800);
    expect(createProbeInput()).toHaveLength(76800);
  });

  it('é um Float32Array, como o tensor float32 exige', () => {
    expect(createProbeInput()).toBeInstanceOf(Float32Array);
  });

  it('mantém os valores na faixa normalizada [-1, 1]', () => {
    const input = createProbeInput();

    for (let index = 0; index < input.length; index += 1) {
      const value = input[index] as number;
      expect(value).toBeGreaterThanOrEqual(-1);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('é determinística: duas chamadas produzem a mesma entrada', () => {
    expect(Array.from(createProbeInput())).toEqual(Array.from(createProbeInput()));
  });
});

describe('verificação da saída', () => {
  it('aceita [1, 512] com 512 valores', () => {
    expect(checkProbeOutput([1, 512], FACENET_EMBEDDING_LENGTH)).toEqual({
      ok: true,
      reason: null,
    });
  });

  it('recusa formato diferente do esperado', () => {
    const check = checkProbeOutput([1, 128], 128);

    expect(check.ok).toBe(false);
    expect(check.reason).toContain('[1, 128]');
  });

  it('recusa quantidade de valores diferente do formato', () => {
    const check = checkProbeOutput([1, 512], 256);

    expect(check.ok).toBe(false);
    expect(check.reason).toContain('256');
  });

  it('recusa execução que não devolveu tensor', () => {
    expect(checkProbeOutput(undefined, undefined).ok).toBe(false);
  });
});

describe('formatação de dimensões', () => {
  it('formata para leitura na tela de diagnóstico', () => {
    expect(formatDims([1, 3, 160, 160])).toBe('[1, 3, 160, 160]');
  });

  it('aceita dimensões simbólicas do modelo', () => {
    expect(formatDims(['batch', 3, 160, 160])).toBe('[batch, 3, 160, 160]');
  });

  it('indica ausência quando não há dimensões', () => {
    expect(formatDims(undefined)).toBe('—');
    expect(formatDims([])).toBe('—');
  });
});
