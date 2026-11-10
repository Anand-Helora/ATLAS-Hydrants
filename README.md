# ATLAS-Hydrants

Application web mobile de **relevé des contrôles d'hydrants**, avec export CSV compatible avec l'ancien outil.

Cette V1 est une **reconstruction fonctionnelle** : le code et les écrans d'origine ne sont plus disponibles. Seuls le format CSV (6 colonnes) et les valeurs d'exemple `OK`, `HSH`, `Nok` sont attestés par les anciens exports. L'interface, la méthode de scan et le stockage sont des **choix explicites** de reconstruction, décrits ci-dessous ; ce n'est pas une copie à l'identique de l'ancienne interface.

Toutes les données présentes dans ce dépôt (tests, exemples, captures) sont **fictives**.

## Fonctionnement

1. Ouvrir la page (statique, sans compte ni serveur applicatif).
2. **Nouveau contrôle** : saisir l'identifiant de l'hydrant (`Titre`) ou, si le navigateur le permet, **scanner un QR code**.
3. Renseigner la date du contrôle, le statut, le Test HP, la date du dernier Test HP (facultative) et un commentaire (facultatif).
4. **Enregistrer** : le contrôle est sauvegardé dans le navigateur de l'appareil.
5. Toucher un contrôle de la liste pour le **modifier** ou le **supprimer** (confirmation demandée).
6. **Prévisualiser et exporter le CSV**, puis **Télécharger le CSV**.

### Champs

| Champ | Obligatoire | Valeurs |
| --- | --- | --- |
| Titre (identifiant) | oui | texte libre sur une ligne, 120 caractères max. |
| Date du contrôle | oui | date (années 2000 à 2099), aujourd'hui par défaut |
| Statut | oui | `OK` ou `HSH` (valeurs observées) |
| Test HP | oui | `OK`, `Nok` ou **Vide** (choix explicite, exporte une cellule vide) |
| Date du dernier Test HP | non | date, ou vide (bouton « Effacer ») |
| Commentaires | non | texte libre, 2000 caractères max. |

La signification de `HSH` et de `Nok` n'est pas interprétée par l'application, et aucun autre état n'est proposé. Rendre le Statut obligatoire et imposer un choix explicite pour le Test HP sont des choix de cette V1 (pour distinguer un « vide » volontaire d'un oubli) ; ils peuvent être revus dans une issue dédiée.

**Doublons** : un même identifiant ne peut figurer qu'une fois dans la liste (comparaison insensible à la casse et aux espaces de début/fin). Si l'identifiant saisi ou scanné existe déjà, l'application le signale et propose d'ouvrir le contrôle existant.

**Modifications non enregistrées** : quitter le formulaire (bouton Retour, retour du téléphone, fermeture ou rafraîchissement de l'onglet) avec des modifications non enregistrées demande une confirmation.

## Démarrage local

Prérequis : [Node.js](https://nodejs.org/) 20 ou plus récent. Aucune installation de paquet n'est nécessaire.

```bash
npm start
```

Puis ouvrir <http://127.0.0.1:8080/>. Le serveur (`scripts/serve.js`) est un mini serveur statique de développement sans dépendance, qui n'écoute que sur la machine locale et ne sert que `index.html`, `styles.css` et `src/`. Ouvrir directement `index.html` (`file://`) ne fonctionne pas : les navigateurs bloquent les modules JavaScript dans ce cas.

Tout hébergeur de fichiers statiques peut servir l'application (aucune publication automatique n'est configurée dans ce dépôt).

### Tests

```bash
npm test
```

`node --test` exécute les tests unitaires de `tests/` ; la CI GitHub Actions les lance sur chaque pull request vers `main`.

## Scan QR

- Le bouton **Scanner un QR code** n'apparaît que si le navigateur le permet : contexte sécurisé (**HTTPS** ou `localhost`), API [`BarcodeDetector`](https://developer.mozilla.org/docs/Web/API/BarcodeDetector) avec le format `qr_code`, et accès caméra. Sinon, un message l'indique et la **saisie manuelle** reste toujours possible. Aucune bibliothèque de décodage tierce n'est chargée.
- En pratique : disponible sur Chrome pour Android ; généralement **indisponible** sur Safari iOS et Firefox, où l'on saisit l'identifiant à la main.
- La caméra n'est activée qu'après un appui sur le bouton. Elle est coupée dès qu'un code est lu, sur « Arrêter le scan », au retour à la liste, à l'enregistrement et quand la page est masquée.
- Le contenu lu est seulement copié dans le champ Titre (espaces de bord retirés) : vérifier l'identifiant avant d'enregistrer.
- Sur un smartphone qui accède à un poste de développement en `http://<adresse-ip>:8080`, le contexte n'est pas sécurisé : le scan est donc masqué (saisie manuelle uniquement).

## Périmètre de la sauvegarde

- Les contrôles sont stockés **uniquement dans le navigateur de l'appareil** : IndexedDB (privilégié), sinon `localStorage`. Si aucun stockage persistant n'est disponible (certaines navigations privées), un bandeau rouge prévient que les données seront perdues au rafraîchissement.
- Les données restent après un rafraîchissement ou un redémarrage, **sur le même appareil et le même navigateur**. Elles ne sont **pas** partagées entre appareils, ni sauvegardées ailleurs.
- **Pas de synchronisation SharePoint**, pas d'API Graph, pas de Power Automate, aucun envoi réseau (la page interdit même toute connexion sortante via sa politique de sécurité de contenu).
- Effacer les données du site dans le navigateur supprime les contrôles. **Exporter le CSV régulièrement.**
- L'export ne vide pas la liste : supprimer manuellement les contrôles une fois le fichier transmis, si besoin.

## Export CSV

Format attesté par l'ancien export :

```csv
Titre;Date du contrôle;Statut;Test HP;Date du dernier Test HP;Commentaires
SITE-FICTIF/A/00/001/HYD01;04-11-26;HSH;Nok;;Observation fictive
SITE-FICTIF/A/00/002/HYD02;04-11-26;OK;OK;04-11-26;
```

- UTF-8, séparateur `;`, exactement ces 6 colonnes dans cet ordre.
- Dates au format **JJ-MM-AA**, converties par découpage de texte (aucun décalage de jour lié au fuseau horaire).
- Champs vides exportés comme cellules vides.
- **BOM UTF-8** ajouté par défaut pour qu'Excel francophone affiche correctement les accents (case à décocher dans l'écran d'export).
- Fins de ligne **CRLF**, y compris après la dernière ligne.
- Échappement : un champ contenant `;`, `"`, un retour à la ligne, ou des espaces de début/fin est entouré de guillemets, et ses `"` sont doublés.
- **Protection contre l'injection de formules** : dans les champs libres (`Titre`, `Commentaires`), une valeur qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot est préfixée par une apostrophe `'` dans le fichier exporté (Excel l'affiche alors comme du texte). La valeur saisie reste inchangée dans l'application ; seule la copie exportée est transformée. Exemple : `=1+1` est exporté `'=1+1`, un commentaire `- fuite` est exporté `'- fuite`. Couverture : `tests/csv.test.js`.
- Ordre des lignes : ordre de création des contrôles.
- Nom proposé : `atlas-hydrants-controles-AAAA-MM-JJ.csv`.

### Import dans SharePoint (en dehors de cette application)

L'application **ne transmet rien** : elle produit un fichier que l'utilisateur télécharge. Le transfert vers SharePoint (ou tout autre outil) se fait **manuellement**, en dehors de l'application, selon la procédure habituelle de l'équipe (par exemple ouvrir le CSV dans Excel puis importer/coller dans la liste). Vérifier le fichier avant import.

## Structure

```
index.html                 Page unique (liste, formulaire, export)
styles.css                 Styles mobile-first, mode sombre
src/model.js               Champs, valeurs autorisées, validation, doublons
src/csv.js                 Format et export CSV historique
src/storage.js             Persistance locale (IndexedDB / localStorage / mémoire)
src/qr.js                  Détection et lecture QR (BarcodeDetector)
src/app.js                 Interface (DOM uniquement)
scripts/serve.js           Serveur statique de développement
tests/*.test.js            Tests unitaires (node --test)
tests/fixtures/            Exemple CSV fictif de l'ancien format
.github/workflows/ci.yml   CI sur les pull requests vers main
AGENTS.md / CLAUDE.md      Consignes pour les agents IA
```

Le socle (CI, `package.json`, `.gitignore`, consignes des agents) est repris et adapté du dépôt modèle public `Anand-Helora/HELORA-Template-MultiIA`.

## Tests navigateur et vérification manuelle sur smartphone

La CI ne contient **pas** de tests navigateur (pas de dépendance Playwright dans le dépôt) : elle teste la logique (`src/model.js`, `src/csv.js`, `src/storage.js`, `src/qr.js`). L'interface (`src/app.js`) se vérifie manuellement :

1. Lancer `npm start` sur un poste, ou servir les fichiers en HTTPS pour tester le scan QR.
2. Sur le smartphone, ouvrir la page. Vérifier le bandeau « Données stockées sur cet appareil, pas de synchronisation SharePoint ».
3. **Nouveau contrôle** → Enregistrer sans rien saisir : des messages d'erreur clairs apparaissent sous l'identifiant, le statut et le Test HP.
4. Saisir `SITE-FICTIF/A/00/001/HYD01`, date `04/11/2026`, Statut `HSH`, Test HP `Nok`, commentaire `Observation fictive` → Enregistrer. Le contrôle apparaît dans la liste.
5. Créer `SITE-FICTIF/A/00/002/HYD02`, Statut `OK`, Test HP `OK`, dernier Test HP `04/11/2026`.
6. Nouveau contrôle avec `site-fictif/a/00/001/hyd01` : l'avertissement de doublon s'affiche ; l'enregistrement est refusé.
7. **Rafraîchir la page** (ou fermer/rouvrir le navigateur) : les deux contrôles sont toujours là.
8. Ouvrir le premier contrôle, modifier le commentaire, toucher **Retour** sans enregistrer : une confirmation est demandée. Puis modifier et enregistrer ; rafraîchir : la modification est conservée.
9. **Prévisualiser et exporter** → Télécharger. Ouvrir le fichier : il correspond à l'exemple ci-dessus (accents corrects dans Excel).
10. Supprimer un contrôle : une confirmation est demandée.
11. Scan QR (navigateur compatible, HTTPS) : appuyer sur **Scanner un QR code**, autoriser la caméra, viser un QR code fictif ; l'identifiant est rempli et la caméra s'éteint. Toucher Retour pendant un scan éteint la caméra.

## Limitations

- Une seule inspection par identifiant dans la liste courante (pas d'historique multi-inspections).
- Pas de synchronisation, pas de sauvegarde distante, pas de comptes : la perte ou la réinitialisation de l'appareil/du navigateur fait perdre les contrôles non exportés.
- Années limitées à 2000–2099 (l'export n'écrit que deux chiffres pour l'année).
- Pas d'import CSV dans l'application.
- Scan QR dépendant du navigateur (voir ci-dessus).

Hors périmètre V1 (à proposer dans une issue séparée) : historique, synchronisation SharePoint, stockage cloud, comptes et rôles, photos, géolocalisation, PDF, tableau de bord, publication GitHub Pages.

## Sécurité et confidentialité

- Le dépôt est public : **aucune donnée réelle** (identifiants d'hydrants, plans, emplacements d'hôpital), aucun jeton, aucune clé d'API. Utiliser uniquement des données fictives, y compris dans les issues et PR.
- Aucune connexion réseau sortante (politique `connect-src 'none'`), aucun script tiers.
- Le contenu saisi est affiché uniquement via `textContent` (pas d'injection HTML).
- Les données sont stockées en clair dans le navigateur de l'appareil : utiliser un appareil professionnel verrouillé.
