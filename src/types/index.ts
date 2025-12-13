/**
 * Tipos e interfaces do projeto
 */

export interface ParsedMessage {
  type: 'entrada' | 'saida' | 'diario' | 'saldo' | 'resumo' | 'hoje' | 'semana' | 'mes' | 'performance' | 'comparar' | 'previsao';
  value?: number; // Opcional para comandos de consulta
  date: Date;
  rawText: string;
  shouldReplace?: boolean; // true para substituir, false (padrão) para somar
  targetDate?: Date; // Para comandos como "saldo 16/12"
}

export interface SheetConfig {
  month: number; // 1-12
  year: number;
  startRow: number;
  endRow: number;
  columnOffset: number; // Deslocamento para a direita (0 para janeiro, offset para outros meses)
}

export interface SheetColumns {
  day: string;      // Coluna B
  entrada: string;  // Coluna C
  saida: string;    // Coluna D
  diario: string;   // Coluna E
  saldo: string;    // Coluna F
}

export interface UpdateRequest {
  type: 'entrada' | 'saida' | 'diario';
  value: number;
  day: number;
  month: number;
  year: number;
  shouldReplace?: boolean; // true para substituir, false (padrão) para somar
}

export interface BotResponse {
  success: boolean;
  message: string;
  details?: {
    type: string;
    value: string;
    date: string;
    column: string;
  };
}

export interface DayData {
  day: number;
  month: number;
  year: number;
  entrada: number;
  saida: number;
  diario: number;
  saldo: number;
}

export interface PeriodSummary {
  periodo: string;
  totalEntradas: number;
  totalSaidas: number;
  totalDiario: number;
  saldoFinal: number;
  dias: DayData[];
}

export interface MonthSummary {
  month: number;
  year: number;
  totalEntradas: number;      // Linha 40
  totalSaidas: number;         // Linha 40
  totalDiario: number;         // Linha 40
  saidaTotal: number;          // Linha 43 (Saídas + Diário)
  performance: number;         // Linha 43 (Entradas - Saída Total)
  diasComDados: number;
  mediaDiaria: number;
}
