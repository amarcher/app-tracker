#!/bin/bash
# Add a new project to the app-traffic dashboard
# Usage: ./scripts/add-project.sh <project-name> <domain> <ga4-measurement-id> <ga4-property-id>
#
# Prerequisites (one-time setup, already done):
#   - GCP project with GA4 Data API enabled
#   - Service account: ga4-reader@animal-penpals-dashboard.iam.gserviceaccount.com
#   - Neon database with api_usage table
#
# Steps this script automates:
#   1. Adds gtag.js to the project's index.html
#   2. Adds DASHBOARD_DATABASE_URL to Vercel env vars
#   3. Prints remaining manual steps (grant SA access in GA4)
#
# What still requires browser (GA4 limitations):
#   - Creating a GA4 property (no CLI support)
#   - Creating a web data stream to get the measurement ID
#   - Granting the service account Viewer access
#   These are done in analytics.google.com — see instructions below.

set -e

PROJECT_NAME="${1:?Usage: $0 <project-name> <domain> <ga4-measurement-id> <ga4-property-id>}"
DOMAIN="${2:?Missing domain}"
GA4_MEASUREMENT_ID="${3:?Missing GA4 measurement ID (G-XXXXXXXXXX)}"
GA4_PROPERTY_ID="${4:?Missing GA4 property ID (numeric)}"

NEON_URL="${DASHBOARD_DATABASE_URL:?Set DASHBOARD_DATABASE_URL in your .env or environment}"
SERVICE_ACCOUNT="ga4-reader@animal-penpals-dashboard.iam.gserviceaccount.com"

echo "=== Adding ${PROJECT_NAME} (${DOMAIN}) to dashboard ==="
echo ""

# Step 1: Check if gtag.js already exists in index.html
if grep -q "googletagmanager.com/gtag" index.html 2>/dev/null; then
  EXISTING_ID=$(grep -o 'G-[A-Z0-9]*' index.html | head -1)
  echo "✓ GA4 already present in index.html (${EXISTING_ID})"
else
  echo "Adding GA4 (${GA4_MEASUREMENT_ID}) to index.html..."

  # Insert gtag.js before closing </head>
  GTAG_SNIPPET="    <!-- Google Analytics 4 -->\n    <script async src=\"https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}\"></script>\n    <script>\n      window.dataLayer = window.dataLayer || [];\n      function gtag(){dataLayer.push(arguments);}\n      gtag('js', new Date());\n      gtag('config', '${GA4_MEASUREMENT_ID}');\n    </script>"

  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s|</head>|${GTAG_SNIPPET}\n  </head>|" index.html
  else
    sed -i "s|</head>|${GTAG_SNIPPET}\n  </head>|" index.html
  fi

  echo "✓ GA4 added to index.html"
fi

# Step 2: Add DASHBOARD_DATABASE_URL to Vercel if not already set
echo ""
echo "Setting DASHBOARD_DATABASE_URL on Vercel..."
if vercel env ls 2>/dev/null | grep -q "DASHBOARD_DATABASE_URL"; then
  echo "✓ DASHBOARD_DATABASE_URL already set on Vercel"
else
  echo "${NEON_URL}" | vercel env add DASHBOARD_DATABASE_URL production 2>/dev/null && \
    echo "✓ DASHBOARD_DATABASE_URL added to Vercel" || \
    echo "⚠ Could not add env var (may need manual setup)"
fi

# Step 3: Check for .env file
echo ""
if [ -f .env ]; then
  if grep -q "DASHBOARD_DATABASE_URL" .env; then
    echo "✓ DASHBOARD_DATABASE_URL already in .env"
  else
    echo "DASHBOARD_DATABASE_URL=${NEON_URL}" >> .env
    echo "✓ DASHBOARD_DATABASE_URL added to .env"
  fi
else
  echo "⚠ No .env file found — add DASHBOARD_DATABASE_URL manually"
fi

echo ""
echo "=== Summary ==="
echo "Project:        ${PROJECT_NAME}"
echo "Domain:         ${DOMAIN}"
echo "Measurement ID: ${GA4_MEASUREMENT_ID}"
echo "Property ID:    ${GA4_PROPERTY_ID}"
echo "Service Account: ${SERVICE_ACCOUNT}"
echo ""
echo "=== Remaining manual step ==="
echo "Grant the service account Viewer access in GA4:"
echo "  1. Go to https://analytics.google.com"
echo "  2. Admin > Account Access Management"
echo "  3. Click + > Add users"
echo "  4. Email: ${SERVICE_ACCOUNT}"
echo "  5. Role: Viewer"
echo "  6. Uncheck 'Notify new users by email'"
echo "  7. Click Add"
echo ""
echo "Then update app-traffic dashboard to include property ${GA4_PROPERTY_ID}"
