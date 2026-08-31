/**
 * ARQUIVO GERADO por contrato/gerar.py — não edite à mão.
 *
 * Catálogo de EPIs do EPI Fetin. Os `codigo` são exatamente o que
 * trafega em MQTT, HTTP e banco — o servidor não conhece outro nome.
 *
 * O `icone` é um nome de MaterialCommunityIcons, a mesma família que
 * o painel administrativo usa via @mdi/js. Os dois desenham o mesmo
 * traço nas duas telas.
 *
 * Fonte: contrato/epis.json na raiz do monorepo.
 */

export type CodigoEpi =
  | 'capacete'
  | 'colete'
  | 'oculos'
  | 'botas'
  | 'auricular'
  | 'mascara'
  | 'luvas';

export interface ItemEpi {
  codigo: CodigoEpi;
  rotulo: string;
  descricao: string;
  /** nome em MaterialCommunityIcons (@expo/vector-icons) */
  icone: string;
}

export const CATALOGO_EPI: Record<CodigoEpi, ItemEpi> = {
  capacete: { codigo: 'capacete', rotulo: 'Capacete', descricao: 'Proteção da cabeça', icone: 'hard-hat' },
  colete: { codigo: 'colete', rotulo: 'Colete', descricao: 'Proteção do tronco', icone: 'tshirt-crew' },
  oculos: { codigo: 'oculos', rotulo: 'Óculos', descricao: 'Proteção ocular', icone: 'safety-goggles' },
  botas: { codigo: 'botas', rotulo: 'Botas', descricao: 'Proteção dos pés', icone: 'shoe-formal' },
  auricular: { codigo: 'auricular', rotulo: 'Protetor Auricular', descricao: 'Proteção auditiva', icone: 'headphones' },
  mascara: { codigo: 'mascara', rotulo: 'Máscara', descricao: 'Proteção respiratória', icone: 'face-mask' },
  luvas: { codigo: 'luvas', rotulo: 'Luvas', descricao: 'Proteção das mãos', icone: 'hand-back-right' },
};

export const CODIGOS_EPI = Object.keys(CATALOGO_EPI) as CodigoEpi[];

/** Ícone de reserva para código que o servidor tem e este catálogo não. */
export const ICONE_DESCONHECIDO = 'help-circle-outline';

/**
 * Nunca indexe CATALOGO_EPI direto com string vinda do servidor.
 * Um código novo cadastrado no painel chegaria aqui como undefined e
 * a tela quebraria em runtime; assim ele aparece com ícone genérico e
 * o próprio nome, que é sinal visível de que os catálogos divergiram.
 */
export function epiDoCatalogo(codigo: string): ItemEpi {
  return (
    CATALOGO_EPI[codigo as CodigoEpi] ?? {
      codigo: codigo as CodigoEpi,
      rotulo: codigo,
      descricao: 'Não está no catálogo do app',
      icone: ICONE_DESCONHECIDO,
    }
  );
}
