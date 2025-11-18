#!/bin/bash

# Validation script for thinkube-style migration
# This script checks that all components have been properly migrated

echo "================================================"
echo "  Thinkube Style Migration Validation Script   "
echo "================================================"
echo ""

ERRORS=0
WARNINGS=0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for incorrect imports from @/components/ui (excluding stat-card which is local)
echo "Checking for incorrect @/components/ui imports..."
INCORRECT_IMPORTS=$(grep -r "@/components/ui" frontend/app frontend/components --include="*.tsx" --include="*.ts" 2>/dev/null | grep -v "stat-card" | grep -v "node_modules" || true)

if [ -n "$INCORRECT_IMPORTS" ]; then
    echo -e "${RED}❌ Found incorrect imports:${NC}"
    echo "$INCORRECT_IMPORTS"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ No incorrect @/components/ui imports found${NC}"
fi

echo ""

# Check for thinkube-style imports
echo "Checking for thinkube-style imports..."
THINKUBE_IMPORTS=$(grep -r "from ['\"]thinkube-style" frontend/app frontend/components --include="*.tsx" --include="*.ts" 2>/dev/null | wc -l)

if [ $THINKUBE_IMPORTS -gt 0 ]; then
    echo -e "${GREEN}✅ Found $THINKUBE_IMPORTS thinkube-style imports${NC}"
else
    echo -e "${RED}❌ No thinkube-style imports found${NC}"
    ERRORS=$((ERRORS + 1))
fi

echo ""

# Check that all imports use category folders (not main barrel export)
echo "Checking import patterns..."
BARREL_IMPORTS=$(grep -r "from ['\"]thinkube-style['\"]" frontend/app frontend/components --include="*.tsx" --include="*.ts" 2>/dev/null || true)

if [ -n "$BARREL_IMPORTS" ]; then
    echo -e "${RED}❌ Found barrel imports (should use category folders):${NC}"
    echo "$BARREL_IMPORTS"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ All imports use category folders${NC}"
fi

echo ""

# Check for Tk-prefixed component usage
echo "Checking for Tk-prefixed components..."
TK_COMPONENTS=$(grep -r "<Tk" frontend/app frontend/components --include="*.tsx" 2>/dev/null | wc -l)

if [ $TK_COMPONENTS -gt 0 ]; then
    echo -e "${GREEN}✅ Found $TK_COMPONENTS Tk-prefixed component usages${NC}"
else
    echo -e "${YELLOW}⚠️  No Tk-prefixed components found (might be an issue)${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""

# Check for non-Tk components that should be migrated
echo "Checking for non-migrated components..."
NON_TK=$(grep -r "<\(Button\|Badge\|Card\|Input\|Label\|Select\|Dialog\|Alert\|Table\|Progress\|Switch\|Checkbox\|RadioGroup\|Tooltip\|Separator\|Avatar\)[\s>]" frontend/app frontend/components --include="*.tsx" 2>/dev/null | grep -v "Tk" | grep -v "RadioGroupItem" | grep -v "node_modules" || true)

if [ -n "$NON_TK" ]; then
    echo -e "${YELLOW}⚠️  Found potentially non-migrated components:${NC}"
    echo "$NON_TK" | head -5
    echo "... (showing first 5)"
    WARNINGS=$((WARNINGS + 1))
else
    echo -e "${GREEN}✅ All components appear to be migrated${NC}"
fi

echo ""

# Check that thinkube-style is in package.json
echo "Checking package.json..."
if grep -q "thinkube-style" package.json 2>/dev/null; then
    echo -e "${GREEN}✅ thinkube-style found in package.json${NC}"
else
    echo -e "${RED}❌ thinkube-style not found in package.json${NC}"
    ERRORS=$((ERRORS + 1))
fi

echo ""

# Check TypeScript compilation
echo "Checking TypeScript compilation..."
cd frontend
npx tsc --noEmit 2>&1 | head -20
TSC_EXIT_CODE=${PIPESTATUS[0]}
cd ..

if [ $TSC_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ TypeScript compilation successful${NC}"
else
    echo -e "${YELLOW}⚠️  TypeScript compilation has issues (see above)${NC}"
    WARNINGS=$((WARNINGS + 1))
fi

echo ""
echo "================================================"
echo "                   SUMMARY                     "
echo "================================================"

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ MIGRATION VALIDATION PASSED!${NC}"
    echo "All components have been successfully migrated to thinkube-style."
elif [ $ERRORS -eq 0 ]; then
    echo -e "${YELLOW}✅ Migration complete with $WARNINGS warning(s)${NC}"
    echo "The migration is functional but review the warnings above."
else
    echo -e "${RED}❌ MIGRATION HAS ISSUES${NC}"
    echo "Found $ERRORS error(s) and $WARNINGS warning(s)"
    echo "Please review the issues above and fix them."
fi

echo ""
echo "Next steps:"
echo "1. Run 'npm run dev' in the frontend directory to test the application"
echo "2. Check that all UI components render correctly"
echo "3. Test all interactive features"
echo "4. Deploy to production when ready"

exit $ERRORS