import { GoogleSheetsService } from './googleSheets';
import { UpdateRequest, SheetConfig, BotResponse, DayData, PeriodSummary, MonthSummary } from '../types';
import { DateHelper } from '../utils/dateHelper';

/**
 * Gerencia atualizações na planilha de finanças
 */
export class SheetUpdater {
  private sheetsService: GoogleSheetsService;

  constructor() {
    this.sheetsService = new GoogleSheetsService();
  }

  /**
   * Retorna a configuração da planilha para um determinado mês/ano
   * 
   * Estrutura:
   * - JANEIRO: linhas 6-36, colunas B-F
   * - FEVEREIRO: linhas 6-34 (ano bissexto, 29 dias), colunas H-L (offset de 6)
   * - MARÇO: linhas 6-36, colunas N-R (offset de 12)
   * - ABRIL: linhas 6-35 (30 dias), colunas T-X (offset de 18)
   * - etc...
   */
  private getSheetConfig(month: number, year: number): SheetConfig {
    // Calcula o offset de colunas baseado no mês
    // Janeiro = 0, Fevereiro = 6, Março = 12, etc.
    const columnOffset = (month - 1) * 6;

    // Linha inicial é sempre 6
    const startRow = 6;

    // Determina a linha final baseado no mês
    let endRow = 36; // Padrão: 31 dias (dia 31 = linha 36)
    
    // Ajusta para meses com menos dias
    if (month === 2) {
      // Fevereiro
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      endRow = isLeapYear ? 34 : 33; // 29 ou 28 dias
    } else if ([4, 6, 9, 11].includes(month)) {
      // Abril, Junho, Setembro, Novembro
      endRow = 35; // 30 dias (dia 30 = linha 35)
    }

    return {
      month,
      year,
      startRow,
      endRow,
      columnOffset
    };
  }

  /**
   * Converte número de coluna para letra (0 = A, 1 = B, etc.)
   */
  private columnToLetter(column: number): string {
    let temp: number;
    let letter = '';
    
    while (column >= 0) {
      temp = column % 26;
      letter = String.fromCharCode(temp + 65) + letter;
      column = Math.floor(column / 26) - 1;
    }
    
    return letter;
  }

  /**
   * Retorna a letra da coluna baseado no tipo e offset
   */
  private getColumnLetter(type: 'entrada' | 'saida' | 'diario', columnOffset: number): string {
    // Colunas base (Janeiro):
    // B = Dia (1)
    // C = Entrada (2)
    // D = Saída (3)
    // E = Diário (4)
    // F = Saldo (5)

    const baseColumns = {
      entrada: 2,  // Coluna C
      saida: 3,    // Coluna D
      diario: 4    // Coluna E
    };

    const columnNumber = baseColumns[type] + columnOffset;
    return this.columnToLetter(columnNumber);
  }

  /**
   * Calcula a linha na planilha baseado no dia do mês
   * Dia 1 = linha 6
   */
  private getRowNumber(day: number, config: SheetConfig): number {
    // A linha 6 corresponde ao dia 1
    return config.startRow + (day - 1);
  }

  /**
   * Atualiza um valor na planilha
   */
  async updateValue(request: UpdateRequest): Promise<BotResponse> {
    try {
      const { type, value, day, month, year, shouldReplace = false } = request;

      // Validações
      if (day < 1 || day > 31) {
        return {
          success: false,
          message: `⚠️ Data inválida!

Dia ${day} não existe.

💡 Use datas entre 1 e 31`
        };
      }

      // Obtém configuração do mês
      const config = this.getSheetConfig(month, year);

      // Valida se o dia existe neste mês
      const maxDay = config.endRow - config.startRow + 1;
      if (day > maxDay) {
        return {
          success: false,
          message: `⚠️ Data inválida!

${month}/${year} tem apenas
${maxDay} dias.

💡 Use uma data válida`
        };
      }

      // Calcula posição na planilha
      const columnLetter = this.getColumnLetter(type, config.columnOffset);
      const rowNumber = this.getRowNumber(day, config);
      const cellRange = `${columnLetter}${rowNumber}`;

      // Determina o valor final
      let finalValue = value;
      
      if (!shouldReplace) {
        // Se não for substituição, soma com o valor existente
        const currentCellValue = await this.sheetsService.readCell(cellRange);
        const currentValue = this.parseValue(currentCellValue);
        finalValue = currentValue + value;
      }

      // Formata valor em formato brasileiro
      const formattedValue = `R$ ${finalValue.toFixed(2).replace('.', ',')}`;

      // Escreve na célula
      await this.sheetsService.writeCell(cellRange, formattedValue);

      // Monta mensagem de sucesso
      const dateStr = DateHelper.formatDate(new Date(year, month - 1, day));
      const typeLabel = {
        entrada: '💰 Entrada',
        saida: '💸 Saída',
        diario: '🍽️ Diário'
      }[type];

      const typeEmoji = {
        entrada: '💰',
        saida: '💸',
        diario: '🍽️'
      }[type];

      const action = shouldReplace ? 'substituído para' : 'adicionado';
      const valueFormatted = `R$ ${value.toFixed(2).replace('.', ',')}`;
      
      return {
        success: true,
        message: shouldReplace 
          ? `✅ Valor atualizado!

${typeEmoji} ${type.charAt(0).toUpperCase() + type.slice(1)}
   ${formattedValue}

📅 Data: ${dateStr}`
          : `✅ Valor adicionado!

${typeEmoji} ${type.charAt(0).toUpperCase() + type.slice(1)}
   + ${valueFormatted}

📅 Data: ${dateStr}
💵 Total: ${formattedValue}`,
        details: {
          type: typeLabel,
          value: formattedValue,
          date: dateStr,
          column: cellRange
        }
      };

    } catch (error) {
      console.error('Erro ao atualizar planilha:', error);
      return {
        success: false,
        message: `⚠️ Erro ao salvar!

Não consegui registrar o
valor na planilha.

💡 Tente novamente em alguns
   instantes.`
      };
    }
  }

  /**
   * Lê os dados de um dia específico da planilha
   * OTIMIZADO: Usa batch read para reduzir requisições
   */
  async getDayData(day: number, month: number, year: number): Promise<DayData | null> {
    try {
      const config = this.getSheetConfig(month, year);
      const rowNumber = this.getRowNumber(day, config);
      
      // Lê as 4 colunas em uma única requisição usando range (C, D, E, F)
      const entradaCol = this.getColumnLetter('entrada', config.columnOffset);
      const saldoCol = this.columnToLetter(6 + config.columnOffset); // F = offset + 6
      const range = `${entradaCol}${rowNumber}:${saldoCol}${rowNumber}`;
      
      const values = await this.sheetsService.readRange(range);
      
      if (!values || values.length === 0) {
        return {
          day,
          month,
          year,
          entrada: 0,
          saida: 0,
          diario: 0,
          saldo: 0
        };
      }

      const [entrada, saida, diario, saldo] = values[0]; // 4 colunas: C, D, E, F

      return {
        day,
        month,
        year,
        entrada: this.parseValue(entrada || null),
        saida: this.parseValue(saida || null),
        diario: this.parseValue(diario || null),
        saldo: this.parseValue(saldo || null)
      };
    } catch (error) {
      console.error('Erro ao ler dados do dia:', error);
      return null;
    }
  }

  /**
   * Converte valor da planilha (ex: "R$ 87,10") para número
   */
  private parseValue(cellValue: string | null): number {
    if (!cellValue || cellValue.trim() === '') return 0;
    
    // Remove "R$", espaços e converte vírgula para ponto
    const cleaned = cellValue
      .replace(/R\$\s*/g, '')
      .replace(/\./g, '') // Remove separadores de milhar
      .replace(/,/g, '.') // Converte decimal
      .trim();
    
    const value = parseFloat(cleaned);
    return isNaN(value) ? 0 : value;
  }

  /**
   * Formata valor para exibição (ex: 1234.56 → "R$ 1.234,56")
   */
  private formatCurrency(value: number): string {
    return value.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  /**
   * Gera mensagem formatada com os dados do dia
   */
  async getDayReport(date: Date): Promise<string> {
    const day = date.getDate();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    const data = await this.getDayData(day, month, year);

    if (!data) {
      return `⚠️ Dados indisponíveis

Não consegui buscar as
informações deste dia.

💡 Tente novamente mais tarde.`;
    }

    const dateStr = DateHelper.formatDate(date);
    const saldoIcon = this.getSaldoEmoji(data.saldo);
    const saldoMsg = this.getSaldoMessage(data.saldo);
    
    return `
---  📊 RESUMO DO DIA ---    
     ${dateStr}           

💰 Entrada
   ${this.formatCurrency(data.entrada)}

💸 Saída
   ${this.formatCurrency(data.saida)}

🍽️ Diário
   ${this.formatCurrency(data.diario)}

━━━━━━━━━━━━━━━━━━━━━

${saldoIcon} SALDO
   ${this.formatCurrency(data.saldo)}

${saldoMsg}
    `.trim();
  }

  /**
   * Retorna emoji baseado no saldo
   */
  private getSaldoEmoji(saldo: number): string {
    if (saldo > 0) return '✅';
    if (saldo < 0) return '⚠️';
    return 'ℹ️';
  }

  /**
   * Retorna mensagem motivacional baseado no saldo
   */
  private getSaldoMessage(saldo: number): string {
    if (saldo > 0) return 'Saldo positivo! Continue assim! 🎉';
    if (saldo < 0) return 'Atenção aos gastos! 📉';
    return 'Saldo zerado.';
  }

  /**
   * Gera relatório semanal
   */
  async getWeekReport(): Promise<string> {
    const today = DateHelper.getBrasiliaTime();
    const days: DayData[] = [];
    let totalEntradas = 0;
    let totalSaidas = 0;
    let totalDiario = 0;

    // Últimos 7 dias
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      
      const dayData = await this.getDayData(
        date.getDate(),
        date.getMonth() + 1,
        date.getFullYear()
      );

      if (dayData) {
        days.push(dayData);
        totalEntradas += dayData.entrada;
        totalSaidas += dayData.saida;
        totalDiario += dayData.diario;
      }
    }

    const saldoFinal = days.length > 0 ? days[days.length - 1].saldo : 0;
    const mediaDiaria = (totalEntradas + totalSaidas + totalDiario) / 7;

    return `
┌──────────────────────────┐
  📅 RESUMO SEMANAL        
  Últimos 7 dias           
└──────────────────────────┘

💰 Total de Entradas
   ${this.formatCurrency(totalEntradas)}

💸 Total de Saídas
   ${this.formatCurrency(totalSaidas)}

🍽️ Total de Diário
   ${this.formatCurrency(totalDiario)}

━━━━━━━━━━━━━━━━━━━━━━━━

💵 SALDO FINAL
   ${this.formatCurrency(saldoFinal)}

📊 Média Diária
   ${this.formatCurrency(mediaDiaria)}
    `.trim();
  }

  /**
   * Gera relatório mensal
   */
  async getMonthReport(): Promise<string> {
    const today = DateHelper.getBrasiliaTime();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const config = this.getSheetConfig(month, year);
    
    let totalEntradas = 0;
    let totalSaidas = 0;
    let totalDiario = 0;
    let diasComDados = 0;

    // Percorre todos os dias do mês até hoje
    const currentDay = today.getDate();
    for (let day = 1; day <= currentDay; day++) {
      const dayData = await this.getDayData(day, month, year);
      
      if (dayData && (dayData.entrada > 0 || dayData.saida > 0 || dayData.diario > 0)) {
        totalEntradas += dayData.entrada;
        totalSaidas += dayData.saida;
        totalDiario += dayData.diario;
        diasComDados++;
      }
    }

    const lastDayData = await this.getDayData(currentDay, month, year);
    const saldoAtual = lastDayData?.saldo || 0;

    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(today);

    return `
📆 *RESUMO MENSAL - ${monthName.toUpperCase()}/${year}*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 *Total ENTRADAS:* ${this.formatCurrency(totalEntradas)}
💸 *Total SAÍDAS:* ${this.formatCurrency(totalSaidas)}
🍽️ *Total DIÁRIO:* ${this.formatCurrency(totalDiario)}

💵 *SALDO ATUAL:* ${this.formatCurrency(saldoAtual)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Dias com registros: ${diasComDados}/${currentDay}
📈 Média diária: ${diasComDados > 0 ? this.formatCurrency((totalEntradas + totalSaidas + totalDiario) / diasComDados) : 'N/A'}
    `.trim();
  }

  /**
   * Lê os totais mensais da planilha (linha 40 e 43)
   * OTIMIZADO: Usa batch read para reduzir requisições
   */
  async getMonthTotals(month: number, year: number): Promise<MonthSummary | null> {
    try {
      const config = this.getSheetConfig(month, year);
      
      // Colunas dos totais
      const entradaCol = this.columnToLetter(2 + config.columnOffset);
      const saidaCol = this.columnToLetter(3 + config.columnOffset);
      const diarioCol = this.columnToLetter(4 + config.columnOffset);
      const saidaTotalCol = this.columnToLetter(1 + config.columnOffset);
      const performanceCol = this.columnToLetter(4 + config.columnOffset);
      
      // Usa batch read para ler todas as 5 células de uma vez
      const ranges = [
        `${entradaCol}40`,
        `${saidaCol}40`,
        `${diarioCol}40`,
        `${saidaTotalCol}43`,
        `${performanceCol}43`
      ];
      
      const results = await this.sheetsService.batchRead(ranges);

      // Conta dias com dados (lendo range completo de uma vez)
      let diasComDados = 0;
      const today = DateHelper.getBrasiliaTime();
      const isCurrentMonth = month === today.getMonth() + 1 && year === today.getFullYear();
      const maxDay = isCurrentMonth ? today.getDate() : config.endRow - config.startRow + 1;
      
      // Lê todos os dias de uma vez usando um range
      const startRow = config.startRow;
      const endRow = config.startRow + maxDay - 1;
      const startCol = this.getColumnLetter('entrada', config.columnOffset);
      const endCol = this.columnToLetter(5 + config.columnOffset);
      const daysRange = `${startCol}${startRow}:${endCol}${endRow}`;
      
      try {
        const daysData = await this.sheetsService.readRange(daysRange);
        
        daysData.forEach(row => {
          if (row && row.length >= 3) {
            const entrada = this.parseValue(row[0] || null);
            const saida = this.parseValue(row[1] || null);
            const diario = this.parseValue(row[2] || null);
            
            if (entrada > 0 || saida > 0 || diario > 0) {
              diasComDados++;
            }
          }
        });
      } catch (error) {
        console.error('Erro ao contar dias com dados:', error);
        // Se falhar, mantém diasComDados = 0
      }

      const totalEntradas = this.parseValue(results.get(ranges[0]) || null);
      const totalSaidas = this.parseValue(results.get(ranges[1]) || null);
      const totalDiario = this.parseValue(results.get(ranges[2]) || null);
      const totalSaidaTotal = this.parseValue(results.get(ranges[3]) || null);
      const performanceValue = this.parseValue(results.get(ranges[4]) || null);
      
      const mediaDiaria = diasComDados > 0 
        ? (totalEntradas + totalSaidas + totalDiario) / diasComDados 
        : 0;

      return {
        month,
        year,
        totalEntradas,
        totalSaidas,
        totalDiario,
        saidaTotal: totalSaidaTotal,
        performance: performanceValue,
        diasComDados,
        mediaDiaria
      };
    } catch (error) {
      console.error('Erro ao ler totais mensais:', error);
      return null;
    }
  }

  /**
   * Gera relatório mensal completo com Performance e Saída Total
   */
  async getCompleteMonthReport(month?: number, year?: number): Promise<string> {
    const today = DateHelper.getBrasiliaTime();
    const targetMonth = month || today.getMonth() + 1;
    const targetYear = year || today.getFullYear();

    const summary = await this.getMonthTotals(targetMonth, targetYear);

    if (!summary) {
      return `⚠️ Dados indisponíveis

Não consegui buscar as
informações deste mês.

💡 Tente novamente mais tarde.`;
    }

    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(
      new Date(targetYear, targetMonth - 1, 1)
    );

    const performanceEmoji = summary.performance >= 0 ? '📈' : '📉';
    const isPositive = summary.performance >= 0;

    return `
┌───────────────────────────┐
  📆 RESUMO MENSAL          
  ${monthName.toUpperCase()}/${targetYear}${' '.repeat(Math.max(0, 15 - monthName.length - targetYear.toString().length))}│
└───────────────────────────┘

💰 Entradas
   ${this.formatCurrency(summary.totalEntradas)}

💸 Saídas
   ${this.formatCurrency(summary.totalSaidas)}

🍽️ Diário
   ${this.formatCurrency(summary.totalDiario)}

━━━━━━━━━━━━━━━━━━━━━━━━

🔻 Saída Total
   ${this.formatCurrency(summary.saidaTotal)}
   (Saídas + Diário)

${performanceEmoji} Performance
   ${this.formatCurrency(summary.performance)}
   ${isPositive ? '✅ Saldo positivo!' : '⚠️ Saldo negativo'}

━━━━━━━━━━━━━━━━━━━━━━━━

📊 Dias c/ registros
   ${summary.diasComDados} dias

📈 Média diária
   ${this.formatCurrency(summary.mediaDiaria)}

${isPositive 
  ? '✨ Parabéns! Você economizou! 🎉'
  : '⚠️ Gastos superaram as entradas'}
    `.trim();
  }

  /**
   * Gera relatório de performance isolado
   */
  async getPerformanceReport(): Promise<string> {
    const today = DateHelper.getBrasiliaTime();
    const summary = await this.getMonthTotals(today.getMonth() + 1, today.getFullYear());

    if (!summary) {
      return `⚠️ Dados indisponíveis

Não consegui calcular a
performance do mês.

💡 Tente novamente mais tarde.`;
    }

    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(today);
    const performanceEmoji = summary.performance >= 0 ? '📈' : '📉';
    const percentage = summary.totalEntradas > 0 
      ? ((summary.performance / summary.totalEntradas) * 100).toFixed(1)
      : '0';
    
    const isPositive = summary.performance >= 0;

    return `
┌───────────────────────────┐
 ${performanceEmoji} PERFORMANCE          
 ${monthName.toUpperCase()}${' '.repeat(Math.max(0, 18 - monthName.length))}
└───────────────────────────┘

💰 Entradas
   ${this.formatCurrency(summary.totalEntradas)}

🔻 Saída Total
   ${this.formatCurrency(summary.saidaTotal)}
   (Saídas + Diário)

━━━━━━━━━━━━━━━━━━━━━━━━

${isPositive ? '✅' : '⚠️'} RESULTADO
   ${this.formatCurrency(summary.performance)}

📊 Percentual
   ${percentage}% ${isPositive ? 'de economia' : 'de déficit'}

━━━━━━━━━━━━━━━━━━━━━━━━

${isPositive 
  ? `✨ Você está economizando!
Continue com esse ritmo! 🎉`
  : `⚠️ Atenção aos gastos!
Déficit de ${this.formatCurrency(Math.abs(summary.performance))}`}
    `.trim();
  }

  /**
   * Compara mês atual com mês anterior
   */
  async getComparisonReport(): Promise<string> {
    const today = DateHelper.getBrasiliaTime();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    
    let previousMonth = currentMonth - 1;
    let previousYear = currentYear;
    
    if (previousMonth === 0) {
      previousMonth = 12;
      previousYear -= 1;
    }

    const [current, previous] = await Promise.all([
      this.getMonthTotals(currentMonth, currentYear),
      this.getMonthTotals(previousMonth, previousYear)
    ]);

    if (!current || !previous) {
      return `⚠️ Dados indisponíveis

Não consegui buscar as
informações para comparação.

💡 Tente novamente mais tarde.`;
    }

    const currentMonthName = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(
      new Date(currentYear, currentMonth - 1, 1)
    );
    const previousMonthName = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(
      new Date(previousYear, previousMonth - 1, 1)
    );

    const diffEntradas = current.totalEntradas - previous.totalEntradas;
    const diffSaidas = current.saidaTotal - previous.saidaTotal;
    const diffPerformance = current.performance - previous.performance;

    const getArrow = (diff: number) => diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
    const getVariation = (diff: number) => diff >= 0 ? 'a mais' : 'a menos';

    return `
┌──────────────────────────┐
  📊 COMPARAÇÃO MENSAL      
└──────────────────────────┘

${currentMonthName.toUpperCase()} vs ${previousMonthName.toUpperCase()}

╔══════════════════════════╗
       💰 ENTRADAS             
╚══════════════════════════╝

${currentMonthName}: ${this.formatCurrency(current.totalEntradas)}
${previousMonthName}: ${this.formatCurrency(previous.totalEntradas)}

${getArrow(diffEntradas)} Variação
   ${this.formatCurrency(Math.abs(diffEntradas))} ${getVariation(diffEntradas)}


╔══════════════════════════╗
      🔻 SAÍDA TOTAL          
╚══════════════════════════╝

${currentMonthName}: ${this.formatCurrency(current.saidaTotal)}
${previousMonthName}: ${this.formatCurrency(previous.saidaTotal)}

${getArrow(diffSaidas)} Variação
   ${this.formatCurrency(Math.abs(diffSaidas))} ${getVariation(diffSaidas)}


╔══════════════════════════╗
      📈 PERFORMANCE          
╚══════════════════════════╝

${currentMonthName}: ${this.formatCurrency(current.performance)}
${previousMonthName}: ${this.formatCurrency(previous.performance)}

${getArrow(diffPerformance)} Diferença
   ${this.formatCurrency(Math.abs(diffPerformance))} ${diffPerformance >= 0 ? 'melhor' : 'pior'}
   
${diffPerformance >= 0 
  ? '✅ Performance melhorou! 🎉' 
  : '⚠️ Performance piorou'}
    `.trim();
  }

  /**
   * Gera previsão de fim de mês
   */
  async getForecastReport(): Promise<string> {
    const today = DateHelper.getBrasiliaTime();
    const currentDay = today.getDate();
    const month = today.getMonth() + 1;
    const year = today.getFullYear();
    const config = this.getSheetConfig(month, year);
    const daysInMonth = config.endRow - config.startRow + 1;
    const daysRemaining = daysInMonth - currentDay;

    const summary = await this.getMonthTotals(month, year);

    if (!summary || summary.diasComDados === 0) {
      return `⚠️ Dados insuficientes

Preciso de mais registros
para fazer a previsão.

💡 Adicione valores de
   entradas e saídas para
   gerar a projeção.`;
    }

    // Média diária de saídas (saídas + diário)
    const mediaSaidas = summary.totalSaidas / summary.diasComDados;
    const mediaDiario = summary.totalDiario / summary.diasComDados;
    const mediaSaidaTotal = (summary.totalSaidas + summary.totalDiario) / summary.diasComDados;

    // Projeção para fim do mês
    const projecaoSaidas = summary.totalSaidas + (mediaSaidas * daysRemaining);
    const projecaoDiario = summary.totalDiario + (mediaDiario * daysRemaining);
    const projecaoSaidaTotal = summary.saidaTotal + (mediaSaidaTotal * daysRemaining);
    const projecaoPerformance = summary.totalEntradas - projecaoSaidaTotal;

    const monthName = new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(today);
    const isPositive = projecaoPerformance >= 0;

    return `
┌──────────────────────────┐
  🔮 PREVISÃO FIM DE MÊS   
  ${monthName.toUpperCase()}${' '.repeat(Math.max(0, 18 - monthName.length))}
└──────────────────────────┘

📅 Progresso
   Dia ${currentDay} de ${daysInMonth}
   
⏳ Faltam
   ${daysRemaining} dias


╔══════════════════════════╗
    📊 MÉDIAS DIÁRIAS       
╚══════════════════════════╝

💸 Saídas
   ${this.formatCurrency(mediaSaidas)}/dia

🍽️ Diário
   ${this.formatCurrency(mediaDiario)}/dia

🔻 Total
   ${this.formatCurrency(mediaSaidaTotal)}/dia


╔══════════════════════════╗
   🎯 PROJEÇÃO FIM DO MÊS  
╚══════════════════════════╝

💰 Entradas
   ${this.formatCurrency(summary.totalEntradas)}
   (valor fixo)

💸 Saídas
   ${this.formatCurrency(projecaoSaidas)}

🍽️ Diário
   ${this.formatCurrency(projecaoDiario)}

🔻 Saída Total
   ${this.formatCurrency(projecaoSaidaTotal)}

━━━━━━━━━━━━━━━━━━━━━━━━

${isPositive ? '📈' : '📉'} Performance Prevista
   ${this.formatCurrency(projecaoPerformance)}

━━━━━━━━━━━━━━━━━━━━━━━━

${isPositive 
  ? `✅ ÓTIMA NOTÍCIA!

Mantendo esse ritmo, você
fecha o mês com saldo
POSITIVO! 🎉`
  : `⚠️ ATENÇÃO!

Mantendo esse ritmo, o mês
fecha NEGATIVO em
${this.formatCurrency(Math.abs(projecaoPerformance))}

💡 Reduza gastos para
   equilibrar as contas!`}
    `.trim();
  }
}


