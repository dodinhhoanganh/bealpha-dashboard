#!/usr/bin/env bash
# ── DNS Email Security Verification Script ────────────────
# Fix #8:  Verify SPF record (single record, both includes)
# Fix #15: Verify DKIM key length (2048-bit)
#
# Usage: bash scripts/verify-dns.sh [domain]
# Default domain: adedmusic.com

set -euo pipefail

DOMAIN="${1:-adedmusic.com}"
DKIM_SELECTOR="${2:-google}"
PASS=0
WARN=0
FAIL=0

echo "=== Email DNS Verification: ${DOMAIN} ==="
echo ""

# ── SPF Check ────────────────────────────────────────────
echo "[SPF] Checking TXT records..."
SPF=$(dig TXT "${DOMAIN}" +short 2>/dev/null | grep "v=spf1" || true)
SPF_COUNT=$(echo "$SPF" | grep -c "v=spf1" || true)

if [ "$SPF_COUNT" -eq 0 ]; then
  echo "  FAIL: No SPF record found!"
  FAIL=$((FAIL+1))
elif [ "$SPF_COUNT" -gt 1 ]; then
  echo "  FAIL: Multiple SPF records found (must be exactly 1)!"
  echo "  $SPF"
  FAIL=$((FAIL+1))
else
  echo "  OK: $SPF"
  if echo "$SPF" | grep -q "_spf.google.com"; then
    echo "  OK: Google SPF include present"
    PASS=$((PASS+1))
  else
    echo "  WARN: Missing include:_spf.google.com"
    WARN=$((WARN+1))
  fi
  if echo "$SPF" | grep -q "hostinger"; then
    echo "  OK: Hostinger SPF include present"
    PASS=$((PASS+1))
  fi
fi

# ── DKIM Check ───────────────────────────────────────────
echo ""
echo "[DKIM] Checking ${DKIM_SELECTOR}._domainkey.${DOMAIN}..."
DKIM=$(dig TXT "${DKIM_SELECTOR}._domainkey.${DOMAIN}" +short 2>/dev/null || true)

if [ -z "$DKIM" ]; then
  echo "  FAIL: No DKIM record found for selector '${DKIM_SELECTOR}'"
  FAIL=$((FAIL+1))
else
  # Check key length via p= value length (2048-bit = ~344 base64 chars)
  P_VALUE=$(echo "$DKIM" | tr -d '"' | tr -d ' ' | grep -oP 'p=\K[^;]+' || true)
  P_LEN=${#P_VALUE}
  echo "  OK: DKIM record found"
  if [ "$P_LEN" -ge 300 ]; then
    echo "  OK: Key length ${P_LEN} chars (2048-bit)"
    PASS=$((PASS+1))
  elif [ "$P_LEN" -ge 100 ]; then
    echo "  WARN: Key length ${P_LEN} chars (likely 1024-bit — upgrade to 2048)"
    WARN=$((WARN+1))
  else
    echo "  FAIL: Key too short (${P_LEN} chars)"
    FAIL=$((FAIL+1))
  fi
fi

# ── DMARC Check ──────────────────────────────────────────
echo ""
echo "[DMARC] Checking _dmarc.${DOMAIN}..."
DMARC=$(dig TXT "_dmarc.${DOMAIN}" +short 2>/dev/null || true)

if [ -z "$DMARC" ]; then
  echo "  FAIL: No DMARC record found!"
  FAIL=$((FAIL+1))
else
  echo "  OK: $DMARC"
  if echo "$DMARC" | grep -q "p=reject"; then
    echo "  OK: Policy = reject (strictest)"
    PASS=$((PASS+1))
  elif echo "$DMARC" | grep -q "p=quarantine"; then
    echo "  OK: Policy = quarantine"
    PASS=$((PASS+1))
  elif echo "$DMARC" | grep -q "p=none"; then
    echo "  WARN: Policy = none (monitoring only — escalate to quarantine/reject)"
    WARN=$((WARN+1))
  fi
fi

# ── Summary ──────────────────────────────────────────────
echo ""
echo "=== Results: ${PASS} passed, ${WARN} warnings, ${FAIL} failures ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
