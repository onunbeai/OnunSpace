# Onun Space: runtime local, provedores e MCP

O app web e o aplicativo Electron usam a mesma API local, o mesmo documento de projeto e o mesmo motor de motion. O navegador é a interface; Node persiste os projetos e mantém as chaves; Chromium e FFmpeg fazem o render no computador. Não é necessário WebContainer para esse fluxo.

## Executar

Requisitos: Node 22.16+ (testado com Node 26), npm, Chromium do Playwright e FFmpeg disponível no PATH. Instale as dependências com `npm install` e o navegador com `npx playwright install chromium`. Execute `npm run dev` e abra `http://127.0.0.1:5178`. O runtime responde em `http://127.0.0.1:4318`.

Para o artefato otimizado: `npm run build`, depois `npm start`; a mesma porta 4318 serve a interface e a API. Para abrir a janela nativa: `npm run build` e `npm run desktop`. O launcher Electron inicia o runtime se necessário, usa isolamento de contexto e sandbox e recusa navegações externas. É um aplicativo local executável por código-fonte; não inclui instalador assinado ou mecanismo de atualização.

Em ambientes onde o wrapper `tsx` não pode abrir seu pipe de controle, use `node --import tsx server/index.ts`, `node --import tsx server/mcp.ts` e `node --import tsx --test server/*.test.ts`.

## Dados e chaves

Cada projeto fica em `.onun/projects/<id>/project.json`, imagens e vídeos OpenRouter em `.onun/assets/` e renders em `.onun/renders/`. As gravações de projetos usam arquivo temporário + rename e controle de revisão. O diretório pode ser configurado com `ONUN_DATA_DIR`. O Electron iniciado sem um servidor existente usa `app.getPath('userData')/data`; ao reutilizar um servidor aberto, continua usando os dados desse servidor. O menu do espaço oferece backup ZIP portátil e restauração. Projetos legados `<id>.json` são copiados para a nova pasta somente depois de validar o documento; o original é preservado, e uma versão já existente na pasta sempre prevalece.

As chaves adicionadas em Configurações são salvas em `.onun/private/credentials.json` (ou `<ONUN_DATA_DIR>/private/credentials.json`) e carregadas ao reiniciar o runtime. O diretório privado usa permissão `0700` e o arquivo `0600`; o conteúdo é texto local restrito ao proprietário, sem promessa de criptografia. As gravações usam arquivo temporário, sincronização e substituição atômica. O estado de conexão só muda após a gravação concluir; erros de gravação não anunciam uma nova chave como salva. O diretório fica fora de projetos, exportações ZIP e Git.

A API nunca devolve as chaves: cada provedor retorna apenas `configured` e `source` (`stored`, `environment`, `session` ou `none`). `credentialStorage` informa `persistent` e `available`, sem caminhos nem conteúdo. Um arquivo corrompido ou destino inseguro deixa o armazenamento indisponível e impede sobrescrita silenciosa. Instâncias de teste criadas sem caminho continuam limitadas à sessão. Alternativamente, copie `.env.example` para `.env` e configure `OPENROUTER_API_KEY` ou cole a chave completa do painel Higgsfield em `HF_CREDENTIALS` (alias `HF_KEY`). A chave Higgsfield é aceita inteira, inclusive quando já contém `ID:SEGREDO`; o prefixo opcional `Key ` é removido para evitar duplicação no header. `HF_API_KEY` também aceita uma chave completa sozinha; `HF_API_KEY` + `HF_API_SECRET` permanece disponível para integrações legadas. A prioridade é `HF_CREDENTIALS`, depois `HF_KEY`, depois `HF_API_KEY`. O runtime lê `.env` ao iniciar; esse arquivo não deve ser versionado. Limpar uma chave salva remove esse valor de forma persistente. Se houver configuração de ambiente, ela volta a valer e o status informa explicitamente `source: environment`; a chave removida não reaparece ao reiniciar.

O servidor escuta somente em loopback. Escritas exigem JSON (ou `application/zip` na restauração) e `X-Onun-Client: studio`. Origens não reconhecidas, solicitações entre sites e hosts externos são recusados. Isso protege o runtime de páginas externas; processos locais da mesma conta continuam podendo usá-lo. O serviço não contém autenticação multiusuário e não deve ser publicado diretamente na internet.

## Pastas e backup portátil

No menu do espaço, **Project backup** permite escolher o destino, gravar o ZIP e restaurar um arquivo. O destino padrão é `<diretório-de-dados>/backups/<id>`; cada projeto memoriza seu próprio caminho em `backup.json`, inclusive após reiniciar. No Electron, o botão de pasta abre o seletor nativo por um IPC limitado a essa operação. No navegador local, informe um caminho absoluto ou `~/…`.

Cada ZIP tem nome único e nunca substitui outro arquivo. A criação só retorna sucesso depois de fechar e sincronizar o arquivo real. O ZIP inclui `project.json`, as mídias referenciadas, fontes locais/referenciadas, a cena, HTML/CSS/JS e a biblioteca GSAP. URLs públicas HTTPS são baixadas para o arquivo; referências ausentes, expiradas, privadas ou de formato incompatível interrompem o backup. As chaves dos provedores não entram no ZIP. Limites: 1 GiB de conteúdo, 256 MiB por arquivo e 6.000 arquivos.

A restauração verifica nomes permitidos, limites de expansão, integridade SHA-256 e o schema do projeto, rejeitando caminhos externos ou repetidos. Sempre cria um projeto com novo ID e mídias em sua própria pasta `assets`; o projeto original não é alterado. O ZIP também pode ser aberto com um descompactador comum. `project.json` mantém referências relativas aos arquivos internos.

API: `GET/PUT /api/projects/:id/backup-settings`, `POST /api/projects/:id/backups`, `GET /api/projects/:id/backups/:backupId/file` e `POST /api/backups/restore` (corpo ZIP). Pelo MCP, `project_backup_info` lê a configuração e `project_backup_create` cria o arquivo, com `destination` absoluto opcional.

## Integrações de geração

OpenRouter usa o catálogo dinâmico de modelos, `POST /api/v1/images` para imagem, `POST /api/v1/videos` e polling para vídeo, e chat com saída JSON para cenas de motion. Parâmetros não aceitos pelo modelo são recusados pelo provedor; o catálogo expõe capacidades para a interface. O servidor guarda imagens PNG e baixa o vídeo concluído sem expor a chave. Documentação: [imagens](https://openrouter.ai/docs/guides/overview/multimodal/image-generation), [vídeos](https://openrouter.ai/docs/guides/overview/multimodal/video-generation).

Higgsfield envia a credencial completa em `Authorization: Key <credencial>`. A interface recebe uma única chave; não exige secret separado nem dois-pontos. A [documentação de autenticação](https://docs.higgsfield.ai/docs/authentication) e o [SDK v2](https://github.com/higgsfield-ai/higgsfield-js) apresentam `ID:SEGREDO` como formato da credencial completa; a validade da chave copiada do painel é decidida pelo provedor. O adaptador usa os IDs nativos e os schemas JSON de 81 endpoints de geração documentados (15 de imagem e 66 de vídeo), verificados em 26/09/2026. O catálogo completo é distribuído em `server/higgsfield-catalog.json`, retorna `source: cached`, `verifiedAt` e `scope: public-documentation`, e não depende de uma chamada de descoberta ao abrir o seletor. Isso descreve a API pública, sem confirmar acesso de uma conta nem incorporar modelos do aplicativo de consumo. Soul ID é treinamento e fica fora da seleção de geração. Endpoints antigos ausentes, como FLUX Kontext, são recusados localmente.

Cada schema define capacidades, parâmetros, defaults e referências. Fluxos que exigem vídeo ou outras entradas indisponíveis no editor permanecem identificados como não suportados. Texto/imagem/referências podem escolher a variante compatível da mesma família e qualidade, sem mudar de provedor, descartar referências ou substituir operações de edição não suportadas. Valores explícitos inválidos são recusados antes do upload; apenas o tamanho legado genérico `1K` pode adotar a resolução padrão documentada. Duração omitida adota o default do modelo.

Referências locais PNG/JPEG/WebP são enviadas pelo fluxo oficial de upload assinado e viram URLs públicas antes da geração. A chave é enviada somente à API Higgsfield; o PUT no armazenamento usa os cabeçalhos assinados retornados, sem Authorization do provedor. Gerações usam `https://api.higgsfield.ai/<id-nativo>` e polling de requests; cancelar aceita a resposta 202 sem corpo documentada. 401 indica autenticação recusada, enquanto 403 indica permissão insuficiente. URLs de resultados remotos podem expirar. Fontes e limites do catálogo estão em [higgsfield-catalog.md](./higgsfield-catalog.md).

Os adaptadores foram implementados e testados com respostas controladas, sem usar créditos ou chaves reais. Uma geração paga só estará validada depois de conectar uma conta e concluir uma solicitação. Imagens e vídeos desses provedores são gerados na nuvem; a edição e o render de motion são locais. Nenhum modelo de difusão ou LLM local foi instalado.

A fila permite quatro gerações simultâneas, acompanha até 200 jobs e limita corpos JSON a 20 MB. Metadados dos jobs ficam em `.onun/jobs` com gravação atômica, sem chaves nem referências de entrada. O runtime acompanha o provedor mesmo quando o navegador está fechado. Ao reiniciar, retoma apenas consultas de jobs com identificador remoto salvo; nunca repete a submissão paga. Um registro interrompido sem identificador remoto vira erro explícito de acompanhamento, orientando consultar o histórico do provedor antes de gerar novamente.

Cada resultado concluído gera um bloco próprio ao lado do gerador, conectado por uma aresta. O projeto persiste todos os resultados, com IDs estáveis por job e índice, preservando gerações anteriores e evitando duplicações no polling. Resultados concluídos na interface anterior são materializados uma vez. Falhas de atualização do projeto mantêm o resultado no journal para reconciliação ao reiniciar.

O polling normal ocorre a cada 15 segundos; erros transitórios de consulta usam espera crescente até 60 segundos, sem novo POST de geração. Depois de 30 minutos, uma consulta final ainda pode recuperar um resultado já concluído; apenas solicitações ainda pendentes encerram o acompanhamento local. Falhas terminais do provedor não são repetidas. `GET /api/jobs?projectId=<id>` lista status e metadados públicos sem prompts ou credenciais. Cancelar OpenRouter interrompe o acompanhamento local, sem garantir cancelamento ou estorno remoto. `requestId` evita submissões duplicadas entre jobs que permanecem no histórico local.

## Conectar Claude ou Codex via MCP

Inicie o runtime antes do MCP. O servidor MCP usa stdio e consulta a API local, portanto as mudanças aparecem no mesmo projeto aberto na interface. Ele não recebe permissões gerais de shell ou filesystem e nunca retorna chaves.

Configuração de MCP para clientes com JSON, usando caminhos absolutos:

```json
{
  "mcpServers": {
    "onun-space": {
      "command": "node",
      "args": [
        "--import",
        "/absolute/path/to/OnunSpace/node_modules/tsx/dist/loader.mjs",
        "/absolute/path/to/OnunSpace/server/mcp.ts"
      ],
      "env": { "ONUN_RUNTIME_URL": "http://127.0.0.1:4318" }
    }
  }
}
```

Em Codex, adicione um servidor MCP stdio com o mesmo comando e argumentos, ou a entrada equivalente:

```toml
[mcp_servers.onun-space]
command = "node"
args = ["--import", "/absolute/path/to/OnunSpace/node_modules/tsx/dist/loader.mjs", "/absolute/path/to/OnunSpace/server/mcp.ts"]
env = { ONUN_RUNTIME_URL = "http://127.0.0.1:4318" }
```

Substitua `/absolute/path/to/OnunSpace` pelo caminho da sua instalação. O painel Conexão MCP gera a configuração com os caminhos corretos para o computador atual.

São 31 ferramentas: `runtime_status`, `projects_list`, `project_get`, `project_create`, `project_update`, `project_batch`, `project_validate`, `project_export`, `project_backup_info`, `project_backup_create`, `assets_list`, `asset_import`, `scene_get`, `scene_upsert`, `layer_add`, `layer_update`, `layer_remove`, `timeline_update`, `scene_code_set`, `canvas_node_upsert`, `canvas_node_remove`, `canvas_connect`, `canvas_disconnect`, `models_list`, `generation_create`, `generation_status`, `generation_cancel`, `render_create`, `render_status`, `render_list`, `render_cancel`.

`project_batch` aplica até 200 operações em uma única revisão, sem salvar parcialmente quando alguma operação falha. As operações incluem `project.rename`, `node.upsert`, `node.patch`, `node.remove`, `edge.connect`, `edge.remove`, `scene.replace`, `layer.upsert`, `layer.patch`, `layer.remove`, `keyframes.replace` e `code.replace`. `asset_import` recebe bytes via data URL, verifica a assinatura de PNG/JPEG/WebP e devolve um caminho limitado ao diretório de assets; não abre arquivos arbitrários do computador.

As skills do projeto são expostas como recursos somente leitura: `onun://skills/motion`, `onun://skills/motion/authoring` e `onun://skills/motion-review`. Keyframes aceitam `ease` opcional, com o easing da camada como fallback.

O recurso `onun://projects/{projectId}` lê o estado atual do projeto, e o prompt MCP `motion-director` orienta composição, edição, validação e exportação. `runtime_status` publica as capacidades e os limites reais do runtime.

Leia `onun://motion-contract` para o schema e uma cena válida. Fluxo recomendado: ler o projeto, editar camadas e keyframes, verificar a cena na interface, criar o render e acompanhar seu job. `project_update` exige a revisão lida anteriormente para preservar alterações feitas no editor.

`scene_code_set` permite HTML/CSS/JS de motion. Use `sceneRoot` para selecionar elementos e a instância `timeline` de GSAP para todas as animações. O render avança explicitamente `frame / fps`; timers, relógio real e aleatoriedade não determinística não devem ser usados. O código roda no contexto isolado de preview/render, sem acesso ao Node do aplicativo.

## Fronteira online

Este repositório contém a edição local independente. A edição online em https://app.onunai.com/app/space pertence à plataforma Onun, mantida separadamente, com identidade e armazenamento por usuário. O runtime local deste repositório não deve ser publicado como uma API multiusuário. Arquivos `.onun` transportam projetos entre instalações e edições.

## Evidência de verificação

`node --import tsx --test server/app.test.ts server/mcp.test.ts server/store.test.ts server/jobs.test.ts server/mcp-runtime.test.ts` passou em 26/09/2026. O teste MCP abre um processo stdio real pelo SDK, cria e altera um projeto, lê as alterações pela API usada pela interface, confirma o rollback de um lote inválido e exporta um MP4 real de 128 × 128, 10 fps e 0,2 segundo via Chromium/FFmpeg. O arquivo é baixado pela API e sua assinatura MP4 é verificada. Os testes adicionais cobrem handshake/schema MCP, recursos, prompt, revisão concorrente, persistência, credenciais, proteção de origem, importação de assets, geração idempotente com respostas controladas, assinatura PNG e falhas de provedor. Não é uma medição de capacidade para uso em nuvem.

`node desktop/smoke.mjs` também passou em 26/09/2026, abrindo a interface compilada no Electron e consultando a API local. Confirmado: `contextIsolation`, `sandbox` e `webSecurity` ativos; `nodeIntegration` desativado. Evidências: `artifacts/desktop-smoke.json` e `artifacts/desktop-smoke.png`. O binário Electron foi baixado na primeira execução e a janela de teste foi fechada ao concluir; o runtime já aberto continuou funcionando.

`server/backups.test.ts` verifica migração preservando o legado, ZIP real com mídia e fonte, destino persistente após reiniciar, restauração, download e rejeição de traversal, conteúdo corrompido, duplicatas e ZIP truncado. O teste stdio também cria e baixa um ZIP real. `node --import tsx scripts/backup-smoke.ts` valida criação, destino lembrado, download, restauração e Escape na UI com toda a API direcionada a um runtime temporário isolado, sem ler nem escrever projetos do usuário. Evidência em `.figma-app/artifacts/actual/backup-smoke.json`.

`node desktop/backup-smoke.mjs` verifica a bridge isolada do seletor de pasta em um Electron real, com runtime, porta e dados temporários. A seleção e o cancelamento do diálogo nativo são simulados; o teste verifica o IPC, a validação do caminho, o preload restrito e a ausência de Node no renderer. A seleção manual de uma pasta na janela do sistema não faz parte desse teste. Evidência em `artifacts/desktop-backup-smoke.json`.
