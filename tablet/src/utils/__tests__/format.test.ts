import {
  clampUnit,
  formatConfidence,
  formatDuration,
  normalizeConfidence,
  pluralize,
} from '../format';

describe('normalizeConfidence', () => {
  it('mantém valores já normalizados', () => {
    expect(normalizeConfidence(0.87)).toBeCloseTo(0.87);
  });

  it('converte valores em escala de 0 a 100', () => {
    expect(normalizeConfidence(87)).toBeCloseTo(0.87);
  });

  it('limita valores fora da faixa', () => {
    expect(normalizeConfidence(180)).toBe(1);
    expect(normalizeConfidence(-5)).toBe(0);
  });

  it('trata valores inválidos como zero', () => {
    expect(normalizeConfidence(Number.NaN)).toBe(0);
  });
});

describe('clampUnit', () => {
  it('mantém o valor dentro de 0 e 1', () => {
    expect(clampUnit(1.4)).toBe(1);
    expect(clampUnit(-0.3)).toBe(0);
    expect(clampUnit(0.42)).toBeCloseTo(0.42);
  });
});

describe('formatConfidence', () => {
  it('formata como percentual inteiro', () => {
    expect(formatConfidence(0.945)).toBe('95%');
    expect(formatConfidence(0)).toBe('0%');
  });
});

describe('formatDuration', () => {
  it('usa milissegundos abaixo de um segundo', () => {
    expect(formatDuration(420)).toBe('420 ms');
  });

  it('usa segundos com vírgula decimal', () => {
    expect(formatDuration(1500)).toBe('1,5 s');
  });
});

describe('pluralize', () => {
  it('escolhe singular e plural corretamente', () => {
    expect(pluralize(1, 'equipamento', 'equipamentos')).toBe('1 equipamento');
    expect(pluralize(7, 'equipamento', 'equipamentos')).toBe('7 equipamentos');
  });
});
