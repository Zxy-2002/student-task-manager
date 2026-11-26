#!/usr/bin/env bash
# Fail if any production GitHub Secret is missing.
# Environment variable names ARE the GitHub Secret names configured on the
# "production" environment. Prints those names only — never their values.
set -euo pipefail

required=(
  SESSION_SECRET
  OAUTH_GITHUB_CLIENT_ID
  OAUTH_GITHUB_CLIENT_SECRET
  DEPLOY_TOKEN
)

missing=()
for secret in "${required[@]}"; do
  if [[ -z "${!secret:-}" ]]; then
    missing+=("$secret")
  fi
done

if [[ ${#missing[@]} -eq 0 ]]; then
  echo "all production secrets present"
  exit 0
fi

for secret in "${missing[@]}"; do
  echo "::error::Missing GitHub Secret in the production environment: ${secret}"
done

echo "::error::Missing GitHub Secret(s) in the production environment: ${missing[*]}. Add each listed name under Settings → Environments → production → Environment secrets. Required names: SESSION_SECRET, OAUTH_GITHUB_CLIENT_ID, OAUTH_GITHUB_CLIENT_SECRET, DEPLOY_TOKEN. OAUTH_GITHUB_CLIENT_ID and OAUTH_GITHUB_CLIENT_SECRET are the GitHub Secret names because GitHub does not allow secret names that start with GITHUB_ (the app still reads GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET at runtime). Values are not printed."
exit 1
