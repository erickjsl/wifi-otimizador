# CertiFi Pro - Certificação e Otimização Wi-Fi 📶📱

O **CertiFi Pro** é uma aplicação profissional de diagnóstico, auditoria, otimização e certificação de conformidade de redes Wi-Fi.

Ele pode ser executado como **PWA (Progressive Web App)** nativo no Android/iOS ou empacotado como aplicativo **APK Android** nativo com suporte a notificações do sistema.

---

## 🚀 Novas Funcionalidades (Versão Certificação)

- **📜 Módulo de Certificação Wi-Fi**:
  - Seleção de norma/SLA (**Residencial Padrão**, **Residencial Premium / Home Office**, **Corporativo / Comercial**).
  - Medição e avaliação de conformidade por cômodo (Sinal dBm, Latência, Perda de Pacotes, Banda).
  - Emissão e visualização de **Laudo Técnico / Certificado de Conformidade** em formato A4 impresso/PDF com código de validação único.
- **🔔 Notificações Nativas no Android**:
  - Alerta sonoro e notificação push do sistema quando um Laudo de Conformidade é gerado ou aprovado.
  - Notificação de aviso quando o sinal dBm cai abaixo do limite de SLA no ambiente.
- **📱 Instalação como App PWA ou APK**:
  - Pode ser instalado com 1 clique diretamente pelo navegador Chrome no Android.
  - Projeto Android nativo completo disponível na pasta `android-app/`.

---

## 🛠️ Como Instalar no Android (Modo PWA)

1. Abra o navegador Chrome no seu dispositivo Android e acesse o endereço do servidor.
2. O Chrome exibirá a mensagem **"Adicionar à tela inicial"** ou **"Instalar CertiFi Pro"**.
3. O ícone do aplicativo aparecerá na sua tela inicial funcionando como um app nativo em tela cheia!

---

## 📦 Como Compilar o APK Android Nativo

1. Abra a pasta `android-app/` no **Android Studio**.
2. Vá em `Build > Build Bundle(s) / APK(s) > Build APK(s)`.
3. O instalador `app-debug.apk` será gerado na pasta `android-app/app/build/outputs/apk/`.

---

## 📄 Licença

Este projeto é disponibilizado sob a licença MIT.
