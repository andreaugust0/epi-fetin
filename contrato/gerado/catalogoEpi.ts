/**
 * ARQUIVO GERADO por contrato/gerar.py — não edite à mão.
 *
 * Espelho do catálogo do app do totem, para as duas telas
 * desenharem o mesmo traço. Fonte: contrato/epis.json.
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

export const CATALOGO_EPI: Record<
  string,
  { rotulo: string; descricao: string; icone: string }
> = {
  capacete: { rotulo: 'Capacete', descricao: 'Proteção da cabeça', icone: mdiHardHat },
  colete: { rotulo: 'Colete', descricao: 'Proteção do tronco', icone: mdiTshirtCrew },
  oculos: { rotulo: 'Óculos', descricao: 'Proteção ocular', icone: mdiSafetyGoggles },
  botas: { rotulo: 'Botas', descricao: 'Proteção dos pés', icone: mdiShoeFormal },
  auricular: { rotulo: 'Protetor Auricular', descricao: 'Proteção auditiva', icone: mdiHeadphones },
  mascara: { rotulo: 'Máscara', descricao: 'Proteção respiratória', icone: mdiFaceMask },
  luvas: { rotulo: 'Luvas', descricao: 'Proteção das mãos', icone: mdiHandBackRight },
};
