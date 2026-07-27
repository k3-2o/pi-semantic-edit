fmt:
    bunx prettier --write .

lint:
    bunx eslint src/ tests/

types:
    bunx tsc --noEmit

audit:
    #!/usr/bin/env bash
    node -e 'const p=require("./package.json"); if (Object.keys(p.dependencies || {}).length || Object.keys(p.optionalDependencies || {}).length) { console.error("Error: runtime dependencies found."); process.exit(1); } console.log("Audit OK: zero runtime dependencies.");'

check: fmt lint types audit

test:
    bunx vitest run

ci: check test

audit-deps:
    bun audit
