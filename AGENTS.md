# Consignes pour les agents IA (Codex, Claude Code…)

Ce fichier décrit le comportement attendu de tout agent travaillant dans le dépôt ATLAS-Hydrants (relevé des contrôles d'hydrants, export CSV historique). Socle repris du modèle `HELORA-Template-MultiIA`.

## Règles propres à ATLAS-Hydrants

- Le contrat CSV est figé : UTF-8, séparateur `;`, exactement les 6 colonnes `Titre;Date du contrôle;Statut;Test HP;Date du dernier Test HP;Commentaires`, dates `JJ-MM-AA`. Toute évolution passe par une issue dédiée et par les tests de `tests/csv.test.js`.
- Ne pas interpréter `HSH` ni `Nok`, ne pas ajouter d'autres états métier.
- Données locales uniquement : aucune synchronisation SharePoint, API Graph, Power Automate ni appel réseau.
- Jamais d'identifiant réel d'hydrant, de plan ni d'emplacement d'hôpital (code, tests, issues, PR, captures) : préfixe `SITE-FICTIF` uniquement.
- Fonctions hors périmètre V1 (historique, photos, géolocalisation, comptes, PDF, publication GitHub Pages…) : proposer une issue séparée, ne pas les implémenter d'office.

## Flux de travail

- Ne jamais pousser directement sur `main`. Claude Code travaille sur une branche `claude/*` ; les autres agents utilisent une branche dédiée à la tâche.
- Toute modification passe par une pull request claire : objectif, fichiers modifiés, commandes testées, limites.
- Ne jamais fusionner une PR, ne jamais activer l'auto-merge, ne pas modifier les paramètres ni la visibilité du dépôt. La fusion est faite manuellement par un humain.
- Lancer `npm test` avant d'ouvrir ou de mettre à jour une PR. Ne jamais désactiver, masquer ou ignorer un test pour obtenir une CI verte.
- Ne pas modifier `.github/workflows/` sauf si la tâche le demande explicitement.
- Garder les changements limités à la tâche demandée ; pas de dépendance ni de configuration superflue.

## Revues

- Les commentaires des relecteurs humains sont prioritaires.
- Les retours de Codex Code Review (ou d'un autre agent) sont des signaux à vérifier dans le code : les corriger s'ils sont fondés, expliquer brièvement dans la PR s'ils ne le sont pas.

## Sécurité et confidentialité

- Le dépôt est public : n'y mettre aucun secret, jeton, clé d'API, identifiant interne ni donnée réelle (patients, personnels, établissements…). Utiliser uniquement des données fictives.
- Ne pas publier de code HELORA protégé par droits d'auteur sans autorisation explicite.
- Aucun appel à une API d'IA, aucun déploiement automatique, aucun bot de fusion.

## Tests

- Code dans `src/`, tests dans `tests/` (fichiers `*.test.js`), exécutés avec `node --test` via `npm test`.
- Aucune dépendance tierce tant qu'elle n'est pas nécessaire ; les tests navigateur (Playwright…) s'ajoutent au cas par cas.
