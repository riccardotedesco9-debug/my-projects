# smoke-test.ps1 - end-to-end test of the built workbook on a throwaway COPY.
# Drives the real macros via COM: start -> switch task (zero-gap) -> stop,
# then a silent PDF export. Exits non-zero if any assertion fails.
# All COM calls after the timer starts are retry-wrapped: the 1-second
# OnTime tick runs VBA, and inbound COM calls landing mid-tick are
# rejected by Excel (RPC_E_SERVERCALL_RETRYLATER).

param(
    [string]$WorkbookPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'FreelanceHoursTracker.xlsm'),
    [string]$WorkDir = (Join-Path $env:TEMP 'fht-smoke')
)

$ErrorActionPreference = 'Stop'
$script:fails = 0

function Assert([bool]$cond, [string]$msg) {
    if ($cond) { Write-Host "PASS: $msg" }
    else { Write-Host "FAIL: $msg" -ForegroundColor Red; $script:fails++ }
}

function ComRetry([scriptblock]$sb) {
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            $result = & $sb
            # -NoEnumerate: a returned COM Range would otherwise be unrolled
            # into its individual cells by the pipeline.
            Write-Output -NoEnumerate $result
            return
        }
        catch {
            if ($attempt -eq 20) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
}

if (-not (Test-Path $WorkbookPath)) { throw "Workbook not found: $WorkbookPath (run build first)" }
if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null
$copyPath = Join-Path $WorkDir 'FreelanceHoursTracker.xlsm'
Copy-Item $WorkbookPath $copyPath
$originalStamp = (Get-Item $WorkbookPath).LastWriteTimeUtc

$preIds = @(Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object Id)
$xl = $null; $wb = $null

try {
    $xl = New-Object -ComObject Excel.Application
    $xl.Visible = $false
    $xl.DisplayAlerts = $false
    $xl.AutomationSecurity = 1      # run macros without prompting
    $wb = $xl.Workbooks.Open($copyPath)

    # Enable silent mode + seed a rate for Pet Centre on the throwaway copy
    $wsSet = $wb.Worksheets.Item('Settings')
    $wsSet.Unprotect('')
    $wb.Names.Item('stSilentMode').RefersToRange.Value2 = $true
    $wsCli = $wb.Worksheets.Item('Clients')
    $loCli = $wsCli.ListObjects.Item('tblClients')
    $loCli.DataBodyRange.Cells.Item(1, 2).Value2 = 45    # Pet Centre rate

    # --- Session 1: start for Pet Centre ---------------------------------
    $wb.Names.Item('dbClient').RefersToRange.Value2 = 'Pet Centre'
    $wb.Names.Item('dbTask').RefersToRange.Value2 = 'Smoke test'
    $t0 = Get-Date
    ComRetry { $xl.Run('modTimer.StartWork') } | Out-Null

    $status = ComRetry { $wb.Names.Item('stTimerStatus').RefersToRange.Value2 }
    Assert ($status -eq 'RUNNING') "status RUNNING after StartWork (got '$status')"
    $startSerial = ComRetry { $wb.Names.Item('stStartTime').RefersToRange.Value2 }
    $startDt = [DateTime]::FromOADate($startSerial)
    Assert ([math]::Abs(($startDt - $t0).TotalSeconds) -lt 15) 'stStartTime within 15s of now'

    Start-Sleep -Seconds 3

    # --- Switch: start Splash Store while running (auto-logs session 1) ---
    ComRetry { $wb.Names.Item('dbClient').RefersToRange.Value2 = 'Splash Store' }
    ComRetry { $wb.Names.Item('dbTask').RefersToRange.Value2 = 'Switch test' }
    ComRetry { $xl.Run('modTimer.StartWork') } | Out-Null

    $status = ComRetry { $wb.Names.Item('stTimerStatus').RefersToRange.Value2 }
    Assert ($status -eq 'RUNNING') 'status RUNNING after switch'
    $curClient = ComRetry { $wb.Names.Item('stCurrentClient').RefersToRange.Value2 }
    Assert ($curClient -eq 'Splash Store') "current client is Splash Store after switch (got '$curClient')"

    $wsLog = ComRetry { $wb.Worksheets.Item('Time Log') }
    $loLog = ComRetry { $wsLog.ListObjects.Item('tblTimeLog') }
    # Session 1 reuses the blank seed row, so the count stays 1 until the next stop.
    $rowsNow = ComRetry { $loLog.ListRows.Count }
    Assert ($rowsNow -eq 1) "switch logged session 1 into the seed row (rows: $rowsNow)"
    $r1client = ComRetry { $loLog.DataBodyRange.Cells.Item(1, 2).Value2 }
    Assert ($r1client -eq 'Pet Centre') 'switch wrote session 1 (Pet Centre) to the log'

    Start-Sleep -Seconds 3

    # --- Stop session 2 ----------------------------------------------------
    ComRetry { $xl.Run('modTimer.StopAndLog') } | Out-Null
    $status = ComRetry { $wb.Names.Item('stTimerStatus').RefersToRange.Value2 }
    Assert ($status -eq 'IDLE') 'status IDLE after StopAndLog'
    Assert ((ComRetry { $loLog.ListRows.Count }) -eq 2) 'log has exactly 2 rows'
    Assert (ComRetry { $wb.Saved }) 'workbook saved after StopAndLog (crash-safety save)'

    # Scalar reads only: a COM Range returned through a function gets
    # unrolled into cells by the PS 5.1 pipeline, so never pass one out.
    function LogCell([int]$r, [int]$c) {
        # $loLog/$r/$c resolve via the call-stack scope chain inside ComRetry
        return (ComRetry { $loLog.DataBodyRange.Cells.Item($r, $c).Value2 })
    }
    # Row 1: Pet Centre
    Assert ((LogCell 1 2) -eq 'Pet Centre') 'row1 client = Pet Centre'
    Assert ((LogCell 1 3) -eq 'Smoke test') 'row1 task = Smoke test'
    $s1 = LogCell 1 4
    $e1 = LogCell 1 5
    Assert ($e1 -gt $s1) 'row1 End > Start'
    $sec1 = ($e1 - $s1) * 86400
    Assert ($sec1 -ge 1 -and $sec1 -le 30) "row1 duration plausible ($([math]::Round($sec1,1))s)"
    $h1 = LogCell 1 6
    Assert ([math]::Abs($h1 - ($e1 - $s1) * 24) -le 0.005) 'row1 Hours matches (End-Start)*24 within rounding'
    $rate1 = LogCell 1 7
    Assert ($rate1 -eq 45) "row1 Rate = 45 from client lookup (got $rate1)"
    $amt1 = LogCell 1 8
    Assert ([math]::Abs($amt1 - [math]::Round($h1 * 45, 2)) -lt 0.001) 'row1 Amount = Hours x Rate'
    $d1 = [DateTime]::FromOADate((LogCell 1 1))
    Assert ($d1.Date -eq (Get-Date).Date) 'row1 Date = today'
    # Display formats survived the datetime writes (##### regression guard)
    $fmtStart = ComRetry { $loLog.DataBodyRange.Cells.Item(1, 4).NumberFormat }
    Assert ($fmtStart -eq 'hh:mm') "row1 Start format is hh:mm (got '$fmtStart')"

    # Row 2: Splash Store; zero-gap switch => row1 End == row2 Start exactly
    Assert ((LogCell 2 2) -eq 'Splash Store') 'row2 client = Splash Store'
    $s2 = LogCell 2 4
    Assert ($s2 -eq $e1) 'zero-gap switch: row1 End == row2 Start exactly'
    $rate2 = LogCell 2 7
    Assert ($rate2 -eq 0) "row2 Rate = 0 (blank rate seeded) (got $rate2)"

    # --- Silent PDF export -------------------------------------------------
    ComRetry { $xl.Run('modReport.SilentMonthExport', 'Pet Centre') } | Out-Null
    $pdfName = 'Timesheet_' + (Get-Date -Format 'yyyy-MM') + '_PetCentre_RiccardoTedesco.pdf'
    $pdfPath = Join-Path $WorkDir $pdfName
    Assert (Test-Path $pdfPath) "PDF exported: $pdfName"
    if (Test-Path $pdfPath) {
        Assert ((Get-Item $pdfPath).Length -gt 5KB) 'PDF is > 5 KB'
    }
    # Report CONTENT: the exported sheet must actually contain the session
    # (guards against a filter regression producing an empty "valid" PDF)
    $wsRpt = ComRetry { $wb.Worksheets.Item('Report') }
    $rptClient = ComRetry { $wsRpt.Range('C10').Value2 }
    Assert ($rptClient -eq 'Pet Centre') "report body row 1 shows the Pet Centre session (got '$rptClient')"
    $rptDate = ComRetry { $wsRpt.Range('B10').Value2 }
    Assert ($rptDate -gt 0 -and [DateTime]::FromOADate($rptDate).Date -eq (Get-Date).Date) 'report body row 1 date = today'
    # Report period + time formats correct after build
    $fmtC6 = ComRetry { $wsRpt.Range('C6').NumberFormat }
    Assert ($fmtC6 -eq 'mmmm yyyy') "report Period format is 'mmmm yyyy' (got '$fmtC6')"
    $fmtE10 = ComRetry { $wsRpt.Range('E10').NumberFormat }
    Assert ($fmtE10 -eq 'hh:mm') "report Start col format is hh:mm (got '$fmtE10')"

    ComRetry { $xl.Run('modReport.SilentMonthExport', 'All Clients') } | Out-Null
    $pdfAll = Join-Path $WorkDir ('Timesheet_' + (Get-Date -Format 'yyyy-MM') + '_AllClients_RiccardoTedesco.pdf')
    Assert (Test-Path $pdfAll) 'All-Clients PDF exported'

    ComRetry { $wb.Close($false) } | Out-Null
    $wb = $null
}
finally {
    if ($null -ne $wb) { try { $wb.Close($false) } catch {} }
    if ($null -ne $xl) { try { $xl.Quit() } catch {} }
    foreach ($name in 'body','loLog','wsLog','wsRpt','loCli','wsCli','wsSet','wb','xl') {
        $obj = Get-Variable -Name $name -ValueOnly -ErrorAction SilentlyContinue
        if ($obj -is [__ComObject]) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($obj) }
        Remove-Variable -Name $name -ErrorAction SilentlyContinue
    }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()

    $deadline = (Get-Date).AddSeconds(12)
    do {
        $leftover = @(Get-Process EXCEL -ErrorAction SilentlyContinue | Where-Object { $preIds -notcontains $_.Id })
        if ($leftover.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if ($leftover.Count -gt 0) {
        Write-Warning "Stopping leftover hidden Excel instance(s): $($leftover.Id -join ', ')"
        $leftover | Stop-Process -Force
    }
}

Assert ((Get-Item $WorkbookPath).LastWriteTimeUtc -eq $originalStamp) 'original workbook untouched'

Write-Host ''
if ($script:fails -eq 0) {
    Write-Host 'SMOKE TEST: ALL PASS' -ForegroundColor Green
} else {
    Write-Host "SMOKE TEST: $($script:fails) FAILURE(S)" -ForegroundColor Red
}
exit $script:fails
