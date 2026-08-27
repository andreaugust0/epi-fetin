/**
 * Tokens de design do EPI Fetin.
 *
 * Copiados de `src/theme/` do app do totem, valor por valor, para que as duas
 * telas do sistema pareçam o mesmo produto. Ao mudar algo lá, mude aqui.
 *
 * Origem: Bunnyzzx/Detecao-de-EPI-Fetin @ mobile-rn — colors.ts, radii.ts,
 * spacing.ts, typography.ts, shadows.ts.
 */

import {
  mdiFaceMask,
  mdiHandBackRight,
  mdiHardHat,
  mdiHeadphones,
  mdiSafetyGoggles,
  mdiShoeFormal,
  mdiTshirtCrew,
} from '@mdi/js';

/**
 * Catálogo espelhado de `src/constants/epiCatalog.ts` do app.
 *
 * Os `id` são os mesmos que trafegam no MQTT. Um código que o servidor
 * conheça mas não esteja aqui aparece com ícone genérico — de propósito:
 * é sinal visível de que os dois catálogos divergiram, em vez de o item
 * sumir em silêncio.
 */
export const CATALOGO_EPI: Record<
  string,
  { rotulo: string; descricao: string; icone: string }
> = {
  capacete: { rotulo: 'Capacete', descricao: 'Proteção da cabeça', icone: mdiHardHat },
  colete: { rotulo: 'Colete', descricao: 'Proteção do tronco', icone: mdiTshirtCrew },
  oculos: { rotulo: 'Óculos', descricao: 'Proteção ocular', icone: mdiSafetyGoggles },
  botas: { rotulo: 'Botas', descricao: 'Proteção dos pés', icone: mdiShoeFormal },
  auricular: {
    rotulo: 'Protetor Auricular',
    descricao: 'Proteção auditiva',
    icone: mdiHeadphones,
  },
  mascara: { rotulo: 'Máscara', descricao: 'Proteção respiratória', icone: mdiFaceMask },
  luvas: { rotulo: 'Luvas', descricao: 'Proteção das mãos', icone: mdiHandBackRight },
};

/** Ícone de reserva para código que o servidor tem e o catálogo não. */
export const ICONE_DESCONHECIDO =
  'M12 2A10 10 0 1 0 22 12 10 10 0 0 0 12 2m0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8m-1-5h2v2h-2zm2-1.5h-2v-1a3 3 0 0 1 1.2-2.4A1.5 1.5 0 1 0 10.5 9h-2A3.5 3.5 0 1 1 14 12z';

export function epiDoCatalogo(codigo: string) {
  return (
    CATALOGO_EPI[codigo] ?? {
      rotulo: codigo,
      descricao: 'Não está no catálogo do app',
      icone: ICONE_DESCONHECIDO,
    }
  );
}
