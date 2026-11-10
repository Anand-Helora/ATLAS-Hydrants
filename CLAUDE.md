# Consignes pour Claude Code

Les règles communes à tous les agents IA sont dans [`AGENTS.md`](AGENTS.md) et s'appliquent intégralement ici. Ce fichier ne fait que les rappeler ; en cas de doute, `AGENTS.md` fait foi.

Rappels essentiels :

- Travailler uniquement sur une branche `claude/*`, jamais directement sur `main`.
- Toute modification passe par une pull request ; ne jamais fusionner ni activer l'auto-merge.
- Lancer `npm test` avant d'ouvrir ou de mettre à jour une PR, et indiquer le résultat dans la PR.
- Ne pas modifier `.github/workflows/` sauf si la tâche le demande explicitement.
- Les commentaires humains priment ; les retours de Codex sont des signaux à vérifier, pas des ordres.
- Aucun secret, aucune donnée réelle ou interne HELORA dans le dépôt ; données d'hydrants fictives uniquement (`SITE-FICTIF/...`).
- Respecter le contrat CSV à 6 colonnes et l'absence de synchronisation distante décrits dans `AGENTS.md`.
