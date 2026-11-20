---
id: m_d230da9652cb
scope: project
project: dsh-kanban-board
kind: facts
tier: normal
status: active
title: dsh-kanban-board: старт нового проекта, состояние воркспейса
importance: 4
tags: [dsh-kanban-board, start, bootstrap, workflow-2.6.86, agent-judge]
keywords: 
supersedes: []
supersededBy: []
related: []
createdAt: 2026-11-20T21:49:25.228Z
updatedAt: 2026-11-20T21:49:25.227Z
---
Новый проект dsh-kanban-board запущен (стартовое сообщение заказчика «Старт нового проекта»). Состояние на старте, проверено исполнением: git-репозиторий создан, коммитов нет, ветка master, remote не настроен (git config user AlexanderGoryachev / Alexander.Goryachev@mediadirectiongroup.ru). Движок приёмки subagent-workflow развёрнут в docs/subagent-workflow версии 2.6.86 (SPEC.md, engine.mjs, гейты, hooks, workflow.config.json, VERSION); ключ приёмщика agent-judge уже создан (docs/subagent-workflow/acceptors.json + .wf-keys/, каталог в .gitignore). docs/tasks/ пуст — задач нет. structure/graph.json отсутствует — роли/связи проекта не описаны. Требований (README/бриф/якоря) нет. Роль агента — lead (root). Для старта нужны: бриф (что делает kanban-доска), первая задача + критерии, роли structure/graph.json (канон соседних проектов: coordinator → worker → judge + reviewer, см. default-workspace/structure/graph.json).
