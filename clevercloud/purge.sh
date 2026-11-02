#!/bin/bash -l
# Purge quotidienne selon les durées de conservation (RGPD), lancée par clevercloud/cron.json.
# Heure du serveur : UTC (03:17 UTC). Shell de connexion (-l) : variables de l'application disponibles.
set -euo pipefail
cd "${APP_HOME:-$(dirname "$0")/..}"
pnpm run clever:purge
