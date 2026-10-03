# Wi-Fi Otimizador 📶

O **Wi-Fi Otimizador** é uma aplicação desktop com interface web local criada para diagnosticar, analisar e otimizar redes Wi-Fi no Windows.

Ele utiliza chamadas diretas à API nativa do Windows (`wlanapi.dll`) via `ctypes` em Python, garantindo acesso completo aos beaconeers e Information Elements (largura de canal, padrões Wi-Fi 4/5/6/6E/7, segurança WPA2/WPA3, RSSI exato em dBm), independente do idioma do SO.

---

## 🚀 Funcionalidades

- **Visão Geral e Diagnóstico Inteligente**: Dá uma nota de 0 a 100 para a qualidade da sua rede e gera recomendações detalhadas para o seu roteador (canal ideal, largura de banda, modo e potência).
- **Análise de Espectro e Canais**: Gráfico em Canvas estilo analisador de espectro (2,4 GHz, 5 GHz e 6 GHz), mostrando sobreposição real de redes vizinhas e os canais mais livres.
- **Bipe Guia e Busca de Sinal ao Vivo**: Monitoramento de sinal em tempo real (dBm) com gráficos históricos e um bipe sonoro (AudioContext) que muda de tom e frequência à medida que o sinal melhora — ideal para andar com o notebook e achar a melhor posição.
- **Mapeamento de Cômodos**: Registre a média de sinal dBm em cada cômodo da sua casa.
- **Suite de Testes de Conexão**:
  - Teste de latência e perda de pacotes separando falhas do Wi-Fi local de problemas do provedor de internet.
  - Teste de velocidade de download/upload via Cloudflare.
  - Benchmark de servidores DNS (Google, Cloudflare, Quad9, AdGuard, OpenDNS).
- **Otimização do Adaptador**:
  - Limpeza de cache DNS, reconexão rápida e renovação de IP.
  - Ajuste do plano de energia do adaptador Wi-Fi para Desempenho Máximo.
  - Leitura e alteração de propriedades avançadas da placa de rede (Banda Preferencial, SMPS, etc.).

---

## 📋 Pré-requisitos

- **Sistema Operacional**: Windows 10 ou Windows 11 (64-bit).
- **Python**: versão 3.8 ou superior instalada (sem necessidade de pacotes externos adicionais).
- **Localização**: No Windows 11, certifique-se de ativar *Configurações > Privacidade e Segurança > Localização* e permitir acesso a aplicativos de área de trabalho.

---

## 🛠️ Como Executar

1. Clone o repositório:
   ```bash
   git clone https://github.com/erickjsl/wifi-otimizador.git
   cd wifi-otimizador
   ```

2. Execute o script de inicialização ou o arquivo Python:
   - Dê dois cliques em **`Iniciar.bat`**  
     *ou*
   - Execute via terminal:
     ```bash
     python server.py
     ```

3. O navegador abrirá automaticamente em `http://127.0.0.1:8765/`.

---

## 🛡️ Segurança

- O servidor local escuta **apenas** na interface `127.0.0.1`.
- A API REST exige um token único de sessão gerado a cada execução (`X-Token`), impedindo ataques CSRF a partir de navegadores web.
- Ações administrativas (como alteração de propriedades da placa ou redefinição de pilha de rede) utilizam elevação segura do Windows UAC.

---

## 📄 Licença

Este projeto é disponibilizado sob a licença MIT.
