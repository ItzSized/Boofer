# Booffer 👻

Un petit fantôme qui vit sur ton écran pendant que tes agents IA codent. Il te montre en direct où en est Claude Code, te laisse approuver ses demandes sans changer de fenêtre, et fait *ding* quand c'est fini.

> Projet indépendant, non affilié à Anthropic. « Claude » et « Claude Code » sont des marques d'Anthropic.

## Ce qu'il fait

- **Statut en direct** : le projet, ta demande, l'action en cours (« Modifie pet.js », « Lance : npm run build »), le temps écoulé, le nombre d'actions, les fichiers modifiés, la tâche en cours (« 2/5 »), les échecs et les sous-agents actifs.
- **Pourcentage** : exact quand Claude tient une liste de tâches, estimé sinon. Il ne recule jamais et n'atteint 100 % qu'à la fin.
- **Ping de fin** : le fantôme saute et la bulle affiche « Claudio a fini ! · Terminé en 45 s ».
- **Approbations** : quand Claude Code demande une permission, une carte affiche la commande ou le fichier avec **Autoriser / Toujours / Refuser**. Sans réponse en 55 s, ou si tu cliques « Répondre dans Claude Code », Claude Code te demande normalement.
- **Plusieurs sessions** : chaque session a sa couleur et son onglet. Booffer affiche automatiquement la session du projet ouvert dans la fenêtre au premier plan, et garde sa place dans chaque fenêtre.
- **Un vrai compagnon** : ses yeux suivent la souris, il fait coucou au survol, aime les caresses (clic), s'endort quand tu ne bouges plus et fait des petites pirouettes.
- **Discret** : il ne s'affiche que sur ton éditeur (Antigravity par défaut), les clics passent à travers les zones vides, et il se ferme avec le bouton ×, le clic droit ou l'icône de la barre système.

## Installation (Windows)

### Prérequis

- Node.js 20+
- [Rust](https://rustup.rs) et les « Desktop development with C++ » Build Tools de Visual Studio
- WebView2 (déjà présent sur Windows 10/11)

### Compiler

```bash
npm install
npm run tauri build
```

L'installeur est créé dans `src-tauri/target/release/bundle/nsis/` et l'exe dans `src-tauri/target/release/booffer.exe`.

Pour développer : `npm run tauri dev`. Pour travailler l'interface dans un navigateur, sans Rust : `npm run dev`, puis clic droit sur le fantôme pour lancer les démos.

## Brancher Claude Code

Copie le bloc `hooks` de [hooks/claude-code-settings.example.json](hooks/claude-code-settings.example.json) dans `~/.claude/settings.json` (fusionne-le avec tes réglages existants). Ouvre ensuite `/hooks` dans Claude Code, ou relance-le.

Les hooks envoient leurs événements à Booffer sur `http://127.0.0.1:47823`. Si Booffer n'est pas lancé, `curl` abandonne en silence et Claude Code n'est pas gêné.

## Changer d'éditeur

Booffer ne s'affiche que sur les fenêtres dont l'exécutable contient `TARGET_APP` (`"antigravity"` par défaut), dans [src-tauri/src/pet.rs](src-tauri/src/pet.rs). Mets `"code"` pour VS Code ou `"cursor"` pour Cursor.

## Suivre tes propres scripts Claude API

```js
import { trackStream } from "./reporters/anthropic.js";

const stream = client.messages.stream({ /* ... */ });
trackStream(stream, { label: "Résumé du PDF" });
const message = await stream.finalMessage();
```

Exemple complet : `npm run demo:api`.

## Ajouter un agent

Tout passe par `POST http://127.0.0.1:47823/event/<source>` avec un corps JSON.

1. Crée `src/agents/mon-agent.js`, qui étend `AgentAdapter` et implémente `normalize(payload)` → `{ id, state, label?, progress?, project?, details? }`.
2. Ajoute-le dans [src/agents/index.js](src/agents/index.js).

Les états possibles sont dans [src/core/states.js](src/core/states.js). Un outil qui sait déjà envoyer ce format peut utiliser la source `generic` sans code.

## Architecture

```
src-tauri/src/
  lib.rs          serveur local (événements + permissions), icône de la barre système
  pet.rs          fenêtre : détection de l'éditeur au premier plan, place par fenêtre, suivi souris
  permission.rs   requêtes de permission gardées ouvertes jusqu'à ta réponse
src/
  agents/         un adaptateur par agent (Claude Code, generic)
  core/           tracker des sessions, états, bus d'événements
  ui/             fantôme (SVG), bulle, onglets, carte de permission, menu, comportements
  audio/          sons générés en Web Audio
```

Stack : [Tauri 2](https://tauri.app), JavaScript vanilla, Tailwind CSS 4, Vite.
