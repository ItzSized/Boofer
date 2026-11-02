# Booffer 👻

Un petit fantôme qui vit sur ton écran pendant que tes agents IA codent. Il te montre en direct où en sont **Antigravity** (Gemini 3.1 Pro, Gemini 4 Argon, Flash…), **Claude Code** et **Codex**, te laisse approuver les demandes sans changer de fenêtre, et fait *ding* quand c'est fini.

> Projet indépendant, non affilié à Anthropic. « Claude » et « Claude Code » sont des marques d'Anthropic.

## Télécharger (Windows 10 / 11)

👉 **[Dernière version](https://github.com/ItzSized/Boofer/releases/latest)**, rien à compiler, au choix :

- **`Booffer_…_x64_en-US.msi`** : installeur classique (recommandé)
- **`Booffer_…_x64-setup.exe`** : installeur léger
- **`Booffer.exe`** : version portable, double-clic et c'est parti

Rien d'autre à installer : les installeurs ajoutent WebView2 s'il manque (déjà là sur Windows 10/11), et il n'y a besoin ni de Node ni de Rust. Pour Claude Code : **Réglages → Claude Code → Connecter**. Antigravity et Codex sont détectés tout seuls.

## Ce qu'il fait

- **Statut en direct** : le projet, ta demande, l'action en cours (« Modifie pet.js », « Lance : npm run build »), le temps écoulé, le temps restant (estimé à partir des tâches déjà finies, lissé pour ne pas sauter dans tous les sens), le nombre d'actions, les fichiers modifiés, les échecs et les sous-agents actifs.
- **Progression totale et par étape** : quand Claude tient une liste de tâches, Booffer affiche « Étape 2/5 · Écrit les tests — 70 % » et un total (« Total 42 % »). Sans liste, une estimation du total. Le total ne recule jamais et n'atteint 100 % qu'à la fin.
- **Ping de fin** : le fantôme saute et la bulle affiche « Claudio a fini ! · Terminé en 45 s ».
- **Approbations** : quand Claude Code demande une permission, une carte affiche la commande ou le fichier avec **Autoriser / Toujours / Refuser**. Sans réponse en 55 s, ou si tu cliques « Répondre dans Claude Code », Claude Code te demande normalement.
- **Plusieurs sessions** : chaque session a sa couleur et son onglet. Booffer affiche automatiquement la session du projet ouvert dans la fenêtre au premier plan, et garde sa place dans chaque fenêtre.
- **Un vrai compagnon** : ses yeux suivent la souris, il fait coucou au survol, aime les caresses (clic), s'endort quand tu ne bouges plus et fait des petites pirouettes.
- **Skins et accessoires** : 8 skins (Classique, Fraise, Menthe, Ciel, Citrouille, Gelée, Or, Nuit) et 6 accessoires (nœud, chapeau, couronne, casque, pousse, lunettes).
- **Réglages** (icône de la barre système ou clic droit → Réglages) : thème clair / sombre / auto, sur ton éditeur seulement ou partout sur le bureau, éditeurs suivis, lancement au démarrage de Windows, suivi de la souris, délai avant de s'endormir, sons et volume, taille, approbations, et un bouton pour connecter Claude Code.
- **Ne pas déranger** : plus de sons ni de cartes de permission, pour 30 min, 1 h, jusqu'à demain matin ou sans limite, depuis la barre système ou le clic droit. Il se réactive tout seul à l'heure dite.
- **Ramener le fantôme** (barre système) : perdu hors de l'écran ou sous la barre des tâches, il revient dans son coin.
- **Statut au survol de l'icône** de la barre système : « Booffer · mon-projet : Modifie pet.js · 42 % · reste ≈ 3 min », même quand le fantôme est caché.
- **Petites phrases** : « Coucou ! », « Tadaa ! ✨ », « Psst… il a besoin de toi », et des réactions quand tu le caresses ou le réveilles.
- **Usage des modèles** (barre système → « Usage des modèles… », ou clic sur la petite carte sous le fantôme) : quelles IA tu utilises vraiment (Claude Opus 5.5, Gemini 3.1 Pro, Gemini 4 Argon, GPT-6…), leur part, leur activité sur 14 jours et les limites de ton abonnement Codex. Seuls les modèles trouvés sur ton PC apparaissent, et tout est lu localement.
- **Compactage et contexte** : une jauge « 🧠 Contexte 64 % » prévient avant que Claude Code compacte, et pendant un compactage le fantôme se serre comme un accordéon avec un % et le temps restant (d'après la durée de tes compactages précédents).
- **Suis-moi** (clic droit, barre système ou réglages) : il saute sur la fenêtre où tu es, quelle que soit l'appli. Coupé, il reste sur ton éditeur ou là où tu l'as posé sur le bureau.
- **Économiser des tokens** (Réglages → ✂️ Tokens) : compacter Claude Code plus tôt (contexte plus petit, chaque message coûte moins), réponses courtes, et un compresseur de prompt en « langage IA » (local et gratuit, ou reformulé par Claude Haiku). Raccourci : copie un prompt puis Ctrl+Alt+P.
- **Stop aux commandes dangereuses** : avant un `rm -rf`, un `git push --force`, un `git reset --hard` ou un formatage, le fantôme croise les bras et demande « Es-tu sûr de continuer ? ». Sans réponse en 55 s, c'est bloqué (Claude Code, même en mode auto).
- **Limite par IA** (Réglages → 📊 Modèles) : un plafond de tokens par jour pour Claude, Gemini et GPT, une alerte à 80 % et à 100 %, et « ⚡ en avance / 🐢 en retard » sur ton rythme.
- **En direct** (Réglages → 🟢 Direct) : les applis d'IA ouvertes et chaque agent qui tourne, avec son modèle, son contexte en tokens et le temps restant.
- **Reprompt** (clic droit ou Ctrl+Alt+P) : le prompt copié est réécrit rien que pour l'IA, plus court, en local ou avec Claude Haiku.
- **IA du navigateur**, sans rien installer : dans Chrome, Edge ou Brave, Booffer suit aussi ChatGPT, Gemini, AI Studio, Claude, Grok, Perplexity, DeepSeek, Le Chat et Copilot (l'onglet affiché de chaque fenêtre) : statut en direct, un bip et une notification quand la réponse est prête, et l'historique. Coche « ChatGPT, Gemini… (navigateur) » dans les éditeurs pour qu'il s'affiche sur ces onglets.
- **Clic sur la bulle** : ramène au premier plan la fenêtre du projet en cours.
- **Notifications Windows** quand une tâche finit et que tu n'es pas sur ton éditeur, et une alerte quand une limite d'abonnement dépasse 80 %.
- **Son coupé ?** Si les sons de Booffer sont coupés ou si ton PC est en muet, une notification te prévient quand une tâche finit, même quand tu es sur ton éditeur (Réglages → 🔕).
- **Animations au choix** (Réglages → Animations) : coupe tout d'un coup pour un fantôme immobile, ou seulement ce qui te gêne (flottement, bras, saut de fin, pirouettes, clignements, Zzz…).
- **🧪 Essayer** (Réglages) : simule une tâche, deux sessions, un compactage, une demande ou un stop pour voir le fantôme en action.
- **Raccourcis** : Ctrl+Alt+B pour l'afficher ou le cacher, Ctrl+Alt+M pour l'usage des modèles.
- **Il grandit avec toi** : chaque tâche finie donne de l'XP. Niveau 3 une lueur, niveau 5 une auréole, niveau 8 une aura dorée. Il a l'air fatigué quand le contexte est presque plein, et soulagé après un compactage.
- **Une session = un mini-fantôme** à sa couleur, qui sautille tant qu'elle travaille.
- **Résumé du jour** vers 18 h (ou clic droit → Ma journée), et un message quand une nouvelle version sort sur GitHub.
- **Historique** : les tâches terminées du jour, le temps de travail des agents et les fichiers modifiés, dans les réglages.
- **Discret** : les clics passent à travers les zones vides, et il se ferme avec le bouton ×, le clic droit ou l'icône de la barre système.

## Compiler soi-même (développeurs)

Inutile pour utiliser Booffer : chaque push sur `main` reconstruit les installeurs et met à jour la release GitHub (`.github/workflows/release.yml`).

### Prérequis

- Node.js 20+
- [Rust](https://rustup.rs) et les « Desktop development with C++ » Build Tools de Visual Studio
- WebView2 (déjà présent sur Windows 10/11)

### Compiler

```bash
npm install
npm run release               # exe seul, en ~1 min : copié à la racine du projet et relancé
npm run release -- --installer  # + installeurs .msi et .exe
```

Pour développer sans recompiler : `npm run tauri dev` (l'interface se recharge toute seule à chaque modification). Pour travailler l'interface dans un navigateur, sans Rust : `npm run dev`, puis clic droit sur le fantôme pour lancer les démos.

## Brancher Claude Code

Le plus simple : **Réglages → Claude Code → Connecter**. Booffer ajoute ses hooks à `~/.claude/settings.json` en gardant tes réglages (une copie `settings.json.booffer-backup` est faite). Relance ensuite Claude Code. Si tu avais connecté une ancienne version, Booffer ajoute tout seul les nouveaux hooks (compactage) au démarrage.

À la main : copie le bloc `hooks` de [hooks/claude-code-settings.example.json](hooks/claude-code-settings.example.json) dans `~/.claude/settings.json` (fusionne-le avec tes réglages existants). Ouvre ensuite `/hooks` dans Claude Code, ou relance-le.

Les hooks envoient leurs événements à Booffer sur `http://127.0.0.1:47823`. Si Booffer n'est pas lancé, `curl` abandonne en silence et Claude Code n'est pas gêné.

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
  settings.rs     réglages (JSON), installation des hooks Claude Code
src/
  agents/         un adaptateur par agent (Claude Code, generic)
  core/           tracker des sessions, états, bus d'événements
  ui/             fantôme (SVG, skins, accessoires), bulle, onglets, carte de permission, menu
  settings.js     fenêtre de réglages
  audio/          sons générés en Web Audio
```

Stack : [Tauri 2](https://tauri.app), JavaScript vanilla, Tailwind CSS 4, Vite.
