# merge-all-prs.ps1
# Crea o reanuda fork/community y mergea los PRs que aun no estan integrados
# Orden: BUGs primero, luego UX, luego FEAT (menor riesgo a mayor)
# Uso: .\scripts\merge-all-prs.ps1

$ErrorActionPreference = 'Stop'

$prs = @(
    # BUGs primero - menor riesgo, mayor impacto
    @{ num = 1188; title = "Fix: stop silently failing on note creation" },
    @{ num = 1221; title = "fix: clear stale kanbanFileModes, _loaded flag, fallback window" },
    @{ num = 1222; title = "Fix: date/time-trigger leaking into filename" },
    @{ num = 1225; title = "fix: support Outline navigation for Kanban lanes" },
    @{ num = 1226; title = "fix: reject whitespace-only card and list titles" },
    @{ num = 1227; title = "Fix: preserve Markdown mode after leaving Kanban" },
    @{ num = 1228; title = "fix: validate configured new-note folders" },
    @{ num = 1229; title = "fix: prevent link drop navigation" },
    # UX - cambios de interfaz/comportamiento
    @{ num = 1216; title = "fix: cards use --radius-m (iOS/iPadOS 26 blob corners)" },
    @{ num = 1206; title = "Improve border-radius on mobile and fix scrollbar behavior" },
    @{ num = 1238; title = "Clean tags from generated note titles" },
    @{ num = 1239; title = "Make horizontal lanes fill board height" },
    @{ num = 1241; title = "Warn before discarding unsaved card drafts" },
    @{ num = 1244; title = "Fix upside-down CJK in collapsed lane titles" },
    @{ num = 1211; title = "Add optional insert-card button between cards" },
    # FEATs - cambios mayores al final
    @{ num = 1210; title = "Add undo and redo for Kanban actions" },
    @{ num = 1194; title = "Add cross-board card transfer" },
    @{ num = 1198; title = "feat: auto-create linked notes on card add" },
    @{ num = 1223; title = "Add board-level filter by inline field" }
)

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  MERGEANDO PRs en rama fork/community"
Write-Host "================================================================" -ForegroundColor Cyan

# No tocar una resolucion en curso ni ocultar cambios del usuario.
git rev-parse --verify --quiet MERGE_HEAD *> $null
if ($LASTEXITCODE -eq 0) {
    throw 'Hay un merge en curso. Resuelve los conflictos, guarda el commit y vuelve a ejecutar el script.'
}
if (git status --porcelain --untracked-files=no) {
    throw 'Hay cambios sin guardar. Guarda un commit antes de continuar la integracion.'
}

# Reutilizar la rama existente sin borrar su historial.
$branchExists = git branch --list "fork/community"
if ($branchExists) {
    if ((git branch --show-current) -ne 'fork/community') {
        git checkout fork/community
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo abrir fork/community.' }
    }
} else {
    Write-Host "Creando rama fork/community desde main..." -ForegroundColor Cyan
    git checkout -b fork/community main
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear fork/community.' }
}
Write-Host ""

$merged = @()
$alreadyMerged = @()
$total = $prs.Count
$i = 0

foreach ($pr in $prs) {
    $i++
    $num    = $pr.num
    $title  = $pr.title
    $branch = "pr/$num"

    git merge-base --is-ancestor $branch HEAD
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[$i/$total] PR #${num}: ya integrada" -ForegroundColor Green
        $alreadyMerged += $num
        continue
    }
    if ($LASTEXITCODE -ne 1) { throw "No se pudo comprobar la rama $branch." }

    Write-Host "[$i/$total] Mergeando PR #${num}: $title" -ForegroundColor Yellow

    $mergeOutput = git merge --no-ff $branch -m "Merge PR #${num}: $title" 2>&1
    $exit = $LASTEXITCODE

    if ($exit -eq 0) {
        Write-Host "  OK ✓" -ForegroundColor Green
        $merged += $num
    } else {
        Write-Host "  Conflicto: se conserva el merge para resolverlo" -ForegroundColor Red
        Write-Host "  $mergeOutput" -ForegroundColor DarkRed
        throw "Resuelve la PR #${num}, guarda el commit y vuelve a ejecutar el script."
    }
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  RESUMEN"
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "Mergeados exitosamente ($($merged.Count)): $($merged -join ', ')" -ForegroundColor Green
Write-Host "Ya integradas ($($alreadyMerged.Count)): $($alreadyMerged -join ', ')" -ForegroundColor Green
Write-Host ""
Write-Host "Estado del repo:" -ForegroundColor Cyan
git log --oneline -5
Write-Host ""
git status --short
