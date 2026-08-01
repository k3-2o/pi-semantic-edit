# TS files that exist right now (src/ appears in Phase 1)
FILES := `find src tests -name '*.ts' 2>/dev/null | tr '\n' ' '; true`

fmt:
    @if [ -n "{{FILES}}" ]; then bunx prettier --write {{FILES}}; fi

lint:
    @if [ -n "{{FILES}}" ]; then bunx eslint {{FILES}}; fi

types:
    bunx tsc --noEmit

audit:
    #!/usr/bin/env bash
    node -e 'const p=require("./package.json"); if (Object.keys(p.dependencies || {}).length || Object.keys(p.optionalDependencies || {}).length) { console.error("Error: runtime dependencies found."); process.exit(1); } console.log("Audit OK: zero runtime dependencies.");'

check: fmt lint types audit

test:
    bun test

ci: check test

audit-deps:
    bun audit
