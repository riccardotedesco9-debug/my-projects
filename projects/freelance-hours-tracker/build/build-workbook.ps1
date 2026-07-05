# build-workbook.ps1 - generates FreelanceHoursTracker.xlsm from scratch via Excel COM.
# Requires desktop Excel + "Trust access to the VBA project object model" (auto-set/restored below).
# Refuses to overwrite an existing workbook (it may hold logged hours) unless -Force.

param(
    [switch]$Force,
    [string]$OutName = 'FreelanceHoursTracker.xlsm'
)

$ErrorActionPreference = 'Stop'
$projRoot = Split-Path -Parent $PSScriptRoot
$srcVba   = Join-Path $projRoot 'src\vba'
$outPath  = Join-Path $projRoot $OutName

if ((Test-Path $outPath) -and -not $Force) {
    throw "Output '$outPath' already exists. It may contain logged hours - rerun with -Force to rebuild."
}
foreach ($f in 'modUtil.bas','modTimer.bas','modUI.bas','modReport.bas','ThisWorkbook.txt','frmExport.txt') {
    if (-not (Test-Path (Join-Path $srcVba $f))) { throw "Missing VBA source: $f" }
}

function LRGB([int]$r, [int]$g, [int]$b) { return ($r + 256 * $g + 65536 * $b) }

$miss     = [Type]::Missing
$NAVY     = LRGB 31 56 100
$TEAL     = LRGB 15 118 110
$TEALSOFT = LRGB 178 223 219
$GREEN    = LRGB 46 125 50
$RED      = LRGB 185 28 28
$GRAY     = LRGB 107 114 128
$GRAYFILL = LRGB 243 244 246
$GRAYLINE = LRGB 209 213 219
$AMBER    = LRGB 254 243 199
$WHITE    = LRGB 255 255 255
$GOLD     = LRGB 180 83 9

$EURO       = [char]0x20AC
$fmtEur     = '"' + $EURO + '"#,##0.00'
$fmtEurBl   = '"' + $EURO + '"#,##0.00;;'
$fmtHours   = '0.00" h"'
$CH_PLAY    = [char]0x25B6
$CH_STOP    = [char]0x25A0
$CH_MDASH   = [char]0x2014

# --- AccessVBOM guard (needed to inject VBA; restored afterwards) -----------
$secPath = 'HKCU:\Software\Microsoft\Office\16.0\Excel\Security'
$origVbom = $null
try { $origVbom = (Get-ItemProperty $secPath -ErrorAction Stop).AccessVBOM } catch {}
if ($origVbom -ne 1) {
    New-Item -Path $secPath -Force | Out-Null
    Set-ItemProperty -Path $secPath -Name AccessVBOM -Value 1 -Type DWord
}

$preIds = @(Get-Process EXCEL -ErrorAction SilentlyContinue | ForEach-Object Id)
$xl = $null; $wb = $null

function New-ShapeButton($ws, [string]$anchor, [double]$w, [double]$h,
                         [string]$name, [string]$caption, [string]$onAction, [int]$fill) {
    $r = $ws.Range($anchor)
    $shp = $ws.Shapes.AddShape(5, $r.Left, $r.Top, $w, $h)   # 5 = rounded rectangle
    $shp.Name = $name
    $shp.Fill.ForeColor.RGB = $fill
    $shp.Line.Visible = 0
    $tf = $shp.TextFrame2
    $tf.TextRange.Text = $caption
    $tf.TextRange.Font.Size = 12
    $tf.TextRange.Font.Bold = -1
    $tf.TextRange.Font.Fill.ForeColor.RGB = $WHITE
    $tf.VerticalAnchor = 3                                    # middle
    $tf.TextRange.ParagraphFormat.Alignment = 2               # center
    $shp.OnAction = $onAction
    return $shp
}

function Set-InputStyle($rng) {
    $rng.Interior.Color = $GRAYFILL
    $rng.Locked = $false
    $b = $rng.Borders
    $b.LineStyle = 1
    $b.Color = $GRAYLINE
    $b.Weight = 2
}

try {
    $xl = New-Object -ComObject Excel.Application
    $xl.Visible = $false
    $xl.DisplayAlerts = $false
    $xl.ScreenUpdating = $false

    $wb = $xl.Workbooks.Add()
    while ($wb.Worksheets.Count -lt 6) {
        $wb.Worksheets.Add($miss, $wb.Worksheets.Item($wb.Worksheets.Count)) | Out-Null
    }
    $sheetNames = @('Dashboard', 'Time Log', 'Report', 'Summary', 'Clients', 'Settings')
    for ($i = 0; $i -lt 6; $i++) { $wb.Worksheets.Item($i + 1).Name = $sheetNames[$i] }

    $wsDash = $wb.Worksheets.Item('Dashboard')
    $wsLog  = $wb.Worksheets.Item('Time Log')
    $wsRpt  = $wb.Worksheets.Item('Report')
    $wsSum  = $wb.Worksheets.Item('Summary')
    $wsCli  = $wb.Worksheets.Item('Clients')
    $wsSet  = $wb.Worksheets.Item('Settings')

    $wsDash.Tab.Color = $NAVY
    $wsLog.Tab.Color  = $TEAL
    $wsRpt.Tab.Color  = $GOLD
    $wsSum.Tab.Color  = $TEAL
    $wsCli.Tab.Color  = $GRAY
    $wsSet.Tab.Color  = $GRAY

    # --- CodeNames early so injected VBA (wshTimeLog etc.) compiles ---------
    $vbp = $wb.VBProject
    $vbp.Name = 'FreelanceTracker'
    $codeNames = @{ }
    $codeNames[$wsDash.CodeName] = 'wshDashboard'
    $codeNames[$wsLog.CodeName]  = 'wshTimeLog'
    $codeNames[$wsRpt.CodeName]  = 'wshReport'
    $codeNames[$wsSum.CodeName]  = 'wshSummary'
    $codeNames[$wsCli.CodeName]  = 'wshClients'
    $codeNames[$wsSet.CodeName]  = 'wshSettings'
    foreach ($k in @($codeNames.Keys)) { $vbp.VBComponents.Item($k).Name = $codeNames[$k] }

    # ========================= CLIENTS =====================================
    $wsCli.Columns.Item('A').ColumnWidth = 26
    $wsCli.Columns.Item('B').ColumnWidth = 14
    $wsCli.Columns.Item('D').ColumnWidth = 70
    $wsCli.Range('A1').Value2 = 'Client'
    $wsCli.Range('B1').Value2 = 'Rate'
    $wsCli.Range('A2').Value2 = 'Pet Centre'
    $wsCli.Range('A3').Value2 = 'Splash Store'
    $tblCli = $wsCli.ListObjects.Add(1, $wsCli.Range('A1:B3'), $miss, 1)
    $tblCli.Name = 'tblClients'
    $tblCli.TableStyle = 'TableStyleMedium2'
    $wsCli.Range('B2:B1000').NumberFormat = $fmtEur
    $hdr = $tblCli.HeaderRowRange
    $hdr.Interior.Color = $NAVY
    $hdr.Font.Color = $WHITE
    $hdr.Font.Bold = $true
    $wsCli.Range('D2').Value2 = 'Add a client: type the name and hourly rate in the next row - the table grows automatically.'
    $wsCli.Range('D2').Font.Italic = $true
    $wsCli.Range('D2').Font.Color = $GRAY

    # ========================= SETTINGS ====================================
    $wsSet.Columns.Item('A').ColumnWidth = 2
    $wsSet.Columns.Item('B').ColumnWidth = 36
    $wsSet.Columns.Item('C').ColumnWidth = 26
    $wsSet.Range('B2').Value2 = 'SETTINGS'
    $wsSet.Range('B2').Font.Size = 16
    $wsSet.Range('B2').Font.Bold = $true
    $wsSet.Range('B2').Font.Color = $NAVY
    $wsSet.Range('B4').Value2 = 'Your name (shown on reports)'
    $wsSet.Range('C4').Value2 = 'Riccardo Tedesco'
    $wsSet.Range('B5').Value2 = 'Show rates and amounts on reports'
    $wsSet.Range('C5').Value2 = $true
    $v = $wsSet.Range('C5').Validation
    $v.Delete()
    [void]$v.Add(3, 1, 1, 'TRUE,FALSE')
    Set-InputStyle $wsSet.Range('C4:C5')

    $wsSet.Range('B8').Value2 = 'INTERNAL - timer state, do not edit'
    $wsSet.Range('B8').Font.Bold = $true
    $wsSet.Range('B8').Font.Color = $GRAY
    $wsSet.Range('B9').Value2  = 'Status'
    $wsSet.Range('C9').Value2  = 'IDLE'
    $wsSet.Range('B10').Value2 = 'Started at'
    $wsSet.Range('C10').NumberFormat = 'dd/mm/yyyy hh:mm:ss'
    $wsSet.Range('B11').Value2 = 'Client'
    $wsSet.Range('B12').Value2 = 'Task'
    $wsSet.Range('B13').Value2 = 'Silent mode (automated tests only)'
    $wsSet.Range('C13').Value2 = $false
    $wsSet.Range('B9:C13').Font.Color = $GRAY

    # ========================= NAMES =======================================
    $wb.Names.Add('stFreelancerName',    '=Settings!$C$4')  | Out-Null
    $wb.Names.Add('stReportShowAmounts', '=Settings!$C$5')  | Out-Null
    $wb.Names.Add('stTimerStatus',       '=Settings!$C$9')  | Out-Null
    $wb.Names.Add('stStartTime',         '=Settings!$C$10') | Out-Null
    $wb.Names.Add('stCurrentClient',     '=Settings!$C$11') | Out-Null
    $wb.Names.Add('stCurrentTask',       '=Settings!$C$12') | Out-Null
    $wb.Names.Add('stSilentMode',        '=Settings!$C$13') | Out-Null
    $wb.Names.Add('dbStatus',  '=Dashboard!$B$5')  | Out-Null
    $wb.Names.Add('dbClient',  '=Dashboard!$C$7')  | Out-Null
    $wb.Names.Add('dbTask',    '=Dashboard!$C$8')  | Out-Null
    $wb.Names.Add('dbElapsed', '=Dashboard!$F$10') | Out-Null
    $wb.Names.Add('ClientList', '=INDEX(tblClients[Client],1):INDEX(tblClients[Client],ROWS(tblClients[Client]))') | Out-Null

    # ========================= TIME LOG ====================================
    $wsLog.Columns.Item('A').ColumnWidth = 12
    $wsLog.Columns.Item('B').ColumnWidth = 16
    $wsLog.Columns.Item('C').ColumnWidth = 42
    $wsLog.Columns.Item('D').ColumnWidth = 8
    $wsLog.Columns.Item('E').ColumnWidth = 8
    $wsLog.Columns.Item('F').ColumnWidth = 8
    $wsLog.Columns.Item('G').ColumnWidth = 11
    $wsLog.Columns.Item('H').ColumnWidth = 12
    $wsLog.Columns.Item('A').NumberFormat = 'dd/mm/yyyy'
    $wsLog.Range('D:E').NumberFormat = 'hh:mm'
    $wsLog.Columns.Item('F').NumberFormat = '0.00'
    $wsLog.Range('G:H').NumberFormat = $fmtEur

    $headers = @('Date', 'Client', 'Task', 'Start', 'End', 'Hours', 'Rate', 'Amount')
    for ($i = 0; $i -lt 8; $i++) { $wsLog.Cells.Item(1, $i + 1).Value2 = $headers[$i] }
    $tblLog = $wsLog.ListObjects.Add(1, $wsLog.Range('A1:H1'), $miss, 1)
    $tblLog.Name = 'tblTimeLog'
    $tblLog.TableStyle = 'TableStyleMedium2'
    if ($tblLog.ListRows.Count -eq 0) { $tblLog.ListRows.Add() | Out-Null }
    $hdr = $tblLog.HeaderRowRange
    $hdr.Interior.Color = $NAVY
    $hdr.Font.Color = $WHITE
    $hdr.Font.Bold = $true

    $cfRange = $wsLog.Range('A2:H5000')
    $fc = $cfRange.FormatConditions.Add(2, $miss, '=AND($A2<>"",SUMIFS($F:$F,$A:$A,$A2)>8)')
    $fc.Interior.Color = $AMBER
    $fc.StopIfTrue = $false
    $db = $wsLog.Range('F2:F5000').FormatConditions.AddDatabar()
    $db.BarColor.Color = $TEAL
    $fc2 = $wsLog.Range('A2:A5000').FormatConditions.Add(2, $miss, '=AND($E2<>"",INT($E2)>INT($D2))')
    $fc2.Font.Color = $RED
    $fc2.StopIfTrue = $false

    $wsLog.Activate()
    $xl.ActiveWindow.SplitRow = 1
    $xl.ActiveWindow.FreezePanes = $true

    # ========================= DASHBOARD ===================================
    $wsDash.Columns.Item('A').ColumnWidth = 2
    foreach ($cw in @(@('B',16), @('C',16), @('D',16), @('E',15), @('F',12), @('G',15))) {
        $wsDash.Columns.Item($cw[0]).ColumnWidth = $cw[1]
    }
    $r = $wsDash.Range('B2:G2'); $r.Merge()
    $r.Value2 = 'FREELANCE HOURS TRACKER'
    $r.Font.Size = 18; $r.Font.Bold = $true; $r.Font.Color = $NAVY
    $r = $wsDash.Range('B3:G3'); $r.Merge()
    $r.Formula = '=stFreelancerName'
    $r.Font.Size = 11; $r.Font.Color = $GRAY

    $wsDash.Rows.Item(5).RowHeight = 34
    $r = $wsDash.Range('B5:G5'); $r.Merge()
    $r.Value2 = [string]$CH_STOP + '  IDLE ' + $CH_MDASH + ' ready to start'
    $r.Interior.Color = $GRAY
    $r.Font.Color = $WHITE; $r.Font.Bold = $true; $r.Font.Size = 12
    $r.HorizontalAlignment = -4108
    $r.VerticalAlignment = -4108

    $wsDash.Rows.Item(7).RowHeight = 22
    $wsDash.Rows.Item(8).RowHeight = 22
    $wsDash.Range('B7').Value2 = 'Client'
    $wsDash.Range('B7').Font.Bold = $true
    $r = $wsDash.Range('C7:D7'); $r.Merge()
    Set-InputStyle $r
    $v = $wsDash.Range('C7:D7').Validation
    $v.Delete()
    [void]$v.Add(3, 1, 1, '=ClientList')
    $v.IgnoreBlank = $true
    $v.InCellDropdown = $true
    $wsDash.Range('B8').Value2 = 'Task'
    $wsDash.Range('B8').Font.Bold = $true
    $r = $wsDash.Range('C8:G8'); $r.Merge()
    Set-InputStyle $r

    $wsDash.Rows.Item(10).RowHeight = 24
    $wsDash.Rows.Item(11).RowHeight = 24
    New-ShapeButton $wsDash 'B10' 120 46 'btnStart' ([string]$CH_PLAY + '  Start') 'modTimer.StartWork' $GREEN | Out-Null
    New-ShapeButton $wsDash 'D10' 130 46 'btnStop' ([string]$CH_STOP + '  Stop & Log') 'modTimer.StopAndLog' $RED | Out-Null
    $r = $wsDash.Range('F10:G11'); $r.Merge()
    $r.NumberFormat = '@'
    $r.Value2 = '0:00:00'
    $r.Font.Size = 22; $r.Font.Bold = $true; $r.Font.Color = $NAVY
    $r.HorizontalAlignment = -4108
    $r.VerticalAlignment = -4108

    $wsDash.Range('B13').Value2 = 'AT A GLANCE'
    $wsDash.Range('E13').Value2 = 'THIS MONTH BY CLIENT'
    foreach ($cell in @('B13', 'E13')) {
        $wsDash.Range($cell).Font.Bold = $true
        $wsDash.Range($cell).Font.Size = 10
        $wsDash.Range($cell).Font.Color = $GRAY
    }
    $wsDash.Range('B14').Value2 = 'Today'
    $wsDash.Range('B15').Value2 = 'This week'
    $wsDash.Range('B16').Value2 = 'This month'
    $wsDash.Range('B17').Value2 = 'Earned this month'
    $wsDash.Range('C14').Formula = '=SUMIFS(tblTimeLog[Hours],tblTimeLog[Date],TODAY())'
    $wsDash.Range('C15').Formula = '=SUMIFS(tblTimeLog[Hours],tblTimeLog[Date],">="&(TODAY()-WEEKDAY(TODAY(),2)+1))'
    $wsDash.Range('C16').Formula = '=SUMIFS(tblTimeLog[Hours],tblTimeLog[Date],">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))'
    $wsDash.Range('C17').Formula = '=SUMIFS(tblTimeLog[Amount],tblTimeLog[Date],">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1))'
    $wsDash.Range('C14:C16').NumberFormat = $fmtHours
    $wsDash.Range('C17').NumberFormat = $fmtEur
    for ($i = 1; $i -le 4; $i++) {
        $wsDash.Cells.Item(13 + $i, 5).Formula = '=IFERROR(INDEX(tblClients[Client],' + $i + '),"")'
    }
    $wsDash.Range('F14').Formula = '=IF($E14="","",SUMIFS(tblTimeLog[Hours],tblTimeLog[Client],$E14,tblTimeLog[Date],">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1)))'
    $wsDash.Range('G14').Formula = '=IF($E14="","",SUMIFS(tblTimeLog[Amount],tblTimeLog[Client],$E14,tblTimeLog[Date],">="&DATE(YEAR(TODAY()),MONTH(TODAY()),1)))'
    [void]$wsDash.Range('F14:F17').FillDown()
    [void]$wsDash.Range('G14:G17').FillDown()
    $wsDash.Range('F14:F17').NumberFormat = $fmtHours
    $wsDash.Range('G14:G17').NumberFormat = $fmtEurBl
    $wsDash.Range('B14:B17').Font.Color = $GRAY

    # ========================= SUMMARY =====================================
    $wsSum.Columns.Item('A').ColumnWidth = 2
    $wsSum.Columns.Item('B').ColumnWidth = 22
    $wsSum.Range('C:N').ColumnWidth = 9
    $wsSum.Range('B2').Value2 = 'SUMMARY'
    $wsSum.Range('B2').Font.Size = 16
    $wsSum.Range('B2').Font.Bold = $true
    $wsSum.Range('B2').Font.Color = $NAVY

    $wsSum.Range('B4').Value2 = 'Hours'
    $wsSum.Range('B4').Font.Bold = $true
    $wsSum.Range('C5').Formula = '=DATE(YEAR(TODAY()),1,1)'
    $wsSum.Range('D5').Formula = '=EDATE(C5,1)'
    [void]$wsSum.Range('D5:N5').FillRight()
    for ($i = 1; $i -le 6; $i++) {
        $wsSum.Cells.Item(5 + $i, 2).Formula = '=IFERROR(INDEX(tblClients[Client],' + $i + '),"")'
    }
    # 0 (hidden by the ;; format) instead of "" so the color scale shows white, not a solid band
    $wsSum.Range('C6').Formula = '=IF($B6="",0,SUMIFS(tblTimeLog[Hours],tblTimeLog[Client],$B6,tblTimeLog[Date],">="&C$5,tblTimeLog[Date],"<"&EDATE(C$5,1)))'
    [void]$wsSum.Range('C6:N6').FillRight()
    [void]$wsSum.Range('C6:N11').FillDown()
    $wsSum.Range('B12').Value2 = 'Total'
    $wsSum.Range('B12').Font.Bold = $true
    $wsSum.Range('C12').Formula = '=SUM(C6:C11)'
    [void]$wsSum.Range('C12:N12').FillRight()

    $wsSum.Range('B15').Value2 = 'Earnings (' + $EURO + ')'
    $wsSum.Range('B15').Font.Bold = $true
    $wsSum.Range('C16').Formula = '=C5'
    [void]$wsSum.Range('C16:N16').FillRight()
    $wsSum.Range('B17').Formula = '=B6'
    [void]$wsSum.Range('B17:B22').FillDown()
    $wsSum.Range('C17').Formula = '=IF($B17="",0,SUMIFS(tblTimeLog[Amount],tblTimeLog[Client],$B17,tblTimeLog[Date],">="&C$16,tblTimeLog[Date],"<"&EDATE(C$16,1)))'
    [void]$wsSum.Range('C17:N17').FillRight()
    [void]$wsSum.Range('C17:N22').FillDown()
    $wsSum.Range('B23').Value2 = 'Total'
    $wsSum.Range('B23').Font.Bold = $true
    $wsSum.Range('C23').Formula = '=SUM(C17:C22)'
    [void]$wsSum.Range('C23:N23').FillRight()

    foreach ($mr in @('C5:N5', 'C16:N16')) {
        $r = $wsSum.Range($mr)
        $r.NumberFormat = 'mmm'
        $r.Font.Bold = $true
        $r.Font.Color = $GRAY
        $r.HorizontalAlignment = -4108
    }
    $wsSum.Range('C6:N12').NumberFormat = '0.00;;'
    $wsSum.Range('C17:N23').NumberFormat = $fmtEurBl
    foreach ($blk in @('C6:N11', 'C17:N22')) {
        $cs = $wsSum.Range($blk).FormatConditions.AddColorScale(2)
        $cs.ColorScaleCriteria.Item(1).FormatColor.Color = $WHITE
        $cs.ColorScaleCriteria.Item(2).FormatColor.Color = $TEALSOFT
    }
    $anchor = $wsSum.Range('B26')
    $chShape = $wsSum.Shapes.AddChart2(201, 51, $anchor.Left, $anchor.Top, 480, 230)
    $chart = $chShape.Chart
    $chart.SetSourceData($wsSum.Range('C23:N23'))
    $chart.SeriesCollection(1).XValues = $wsSum.Range('C16:N16')
    $chart.SeriesCollection(1).Format.Fill.ForeColor.RGB = $TEAL
    $chart.HasLegend = $false
    $chart.HasTitle = $true
    $chart.ChartTitle.Text = 'Earnings by month (' + $EURO + ')'

    # ========================= REPORT ======================================
    $wsRpt.Columns.Item('A').ColumnWidth = 2
    foreach ($cw in @(@('B',11), @('C',15), @('D',34), @('E',8), @('F',8), @('G',8), @('H',10), @('I',12))) {
        $wsRpt.Columns.Item($cw[0]).ColumnWidth = $cw[1]
    }
    $wsRpt.Rows.Item(1).RowHeight = 34
    $wsRpt.Range('B1').Value2 = 'Screen controls (not printed)'
    $wsRpt.Range('B1').Font.Italic = $true
    $wsRpt.Range('B1').Font.Color = $GRAY
    New-ShapeButton $wsRpt 'E1' 118 26 'btnRefresh' 'Refresh Preview' 'modReport.RefreshPreview' $NAVY | Out-Null
    New-ShapeButton $wsRpt 'G1' 110 26 'btnExport' 'Export PDF' 'modReport.PromptAndExport' $GREEN | Out-Null

    $wsRpt.Range('B3').Value2 = 'TIMESHEET'
    $wsRpt.Range('B3').Font.Size = 22
    $wsRpt.Range('B3').Font.Bold = $true
    $wsRpt.Range('B3').Font.Color = $NAVY
    $wsRpt.Range('B5').Value2 = 'Freelancer:'
    $wsRpt.Range('B6').Value2 = 'Period:'
    $wsRpt.Range('B7').Value2 = 'Client:'
    $wsRpt.Range('B5:B7').Font.Bold = $true
    $wsRpt.Range('C5').Formula = '=stFreelancerName'
    $r = $wsRpt.Range('G5:I5'); $r.Merge()
    $r.HorizontalAlignment = -4152
    $r.Font.Italic = $true
    $r.Font.Color = $GRAY

    $wsRpt.Range('B10:B600').NumberFormat = 'dd/mm/yyyy'
    $wsRpt.Range('E10:F600').NumberFormat = 'hh:mm'
    $wsRpt.Range('G10:G600').NumberFormat = '0.00'
    $wsRpt.Range('H10:I600').NumberFormat = $fmtEur

    $xl.PrintCommunication = $false
    $ps = $wsRpt.PageSetup
    $ps.PaperSize = 9              # A4
    $ps.Orientation = 1            # portrait
    $ps.Zoom = $false
    $ps.FitToPagesWide = 1
    $ps.FitToPagesTall = $false
    $ps.PrintTitleRows = '$9:$9'
    $ps.PrintArea = 'B3:I40'
    $ps.CenterHorizontally = $true
    $ps.LeftMargin = $xl.InchesToPoints(0.5)
    $ps.RightMargin = $xl.InchesToPoints(0.5)
    $ps.TopMargin = $xl.InchesToPoints(0.6)
    $ps.BottomMargin = $xl.InchesToPoints(0.6)
    $ps.LeftFooter = 'Riccardo Tedesco'
    $ps.CenterFooter = 'Page &P of &N'
    $ps.RightFooter = '&D'
    $xl.PrintCommunication = $true

    # ========================= COSMETICS + PROTECTION ======================
    foreach ($ws in @($wsDash, $wsLog, $wsRpt, $wsSum, $wsCli, $wsSet)) {
        $ws.Activate()
        $xl.ActiveWindow.DisplayGridlines = $false
    }
    # UserInterfaceOnly is re-applied by Workbook_Open on each open.
    foreach ($ws in @($wsDash, $wsRpt, $wsSum, $wsSet)) {
        [void]$ws.Protect('', $true, $true, $true, $true)
    }

    # ========================= VBA INJECTION ===============================
    foreach ($m in 'modUtil.bas', 'modTimer.bas', 'modUI.bas', 'modReport.bas') {
        $vbp.VBComponents.Import((Join-Path $srcVba $m)) | Out-Null
    }
    $twc = $vbp.VBComponents.Item('ThisWorkbook')
    $twc.CodeModule.AddFromString([IO.File]::ReadAllText((Join-Path $srcVba 'ThisWorkbook.txt'))) | Out-Null

    $formOk = $true
    try {
        $frm = $vbp.VBComponents.Add(3)     # vbext_ct_MSForm
        $frm.Name = 'frmExport'
        $frm.Properties.Item('Caption').Value = 'Export Timesheet'
        $frm.Properties.Item('Width').Value = 252
        $frm.Properties.Item('Height').Value = 208
        $d = $frm.Designer
        $c = $d.Controls.Add('Forms.Label.1', 'lblClient', $true)
        $c.Caption = 'Client'; $c.Left = 12; $c.Top = 10; $c.Width = 100; $c.Height = 14
        $c = $d.Controls.Add('Forms.ComboBox.1', 'cboClient', $true)
        $c.Left = 12; $c.Top = 26; $c.Width = 216; $c.Height = 20; $c.Style = 2
        $c = $d.Controls.Add('Forms.Label.1', 'lblMonth', $true)
        $c.Caption = 'Month'; $c.Left = 12; $c.Top = 56; $c.Width = 100; $c.Height = 14
        $c = $d.Controls.Add('Forms.ComboBox.1', 'cboMonth', $true)
        $c.Left = 12; $c.Top = 72; $c.Width = 216; $c.Height = 20; $c.Style = 2
        $c = $d.Controls.Add('Forms.CheckBox.1', 'chkAmounts', $true)
        $c.Caption = 'Include rates and amounts'; $c.Left = 12; $c.Top = 102; $c.Width = 216; $c.Height = 18
        $c = $d.Controls.Add('Forms.CommandButton.1', 'btnOK', $true)
        $c.Caption = 'OK'; $c.Left = 52; $c.Top = 132; $c.Width = 84; $c.Height = 26; $c.Default = $true
        $c = $d.Controls.Add('Forms.CommandButton.1', 'btnCancel', $true)
        $c.Caption = 'Cancel'; $c.Left = 146; $c.Top = 132; $c.Width = 84; $c.Height = 26; $c.Cancel = $true
        $frm.CodeModule.AddFromString([IO.File]::ReadAllText((Join-Path $srcVba 'frmExport.txt'))) | Out-Null
    } catch {
        $formOk = $false
        Write-Warning "frmExport injection failed ($($_.Exception.Message)); export will use the InputBox fallback."
        try { $vbp.VBComponents.Remove($frm) } catch {}
    }

    # Compile check: a compile error in any module throws here, not at first click.
    $xl.Run('modUtil.BuildSanityPing')

    # ========================= SAVE ========================================
    if ($wb.Date1904) { throw '1904 date system unexpectedly enabled - aborting.' }
    $wsDash.Activate()
    $wsDash.Range('C7').Select() | Out-Null
    if ((Test-Path $outPath) -and $Force) { Remove-Item $outPath -Force }
    $wb.SaveAs($outPath, 52)      # 52 = xlOpenXMLWorkbookMacroEnabled
    Write-Host "BUILD OK -> $outPath (UserForm: $formOk)"
}
finally {
    if ($wb -ne $null) { try { $wb.Close($false) } catch {} }
    if ($xl -ne $null) { try { $xl.Quit() } catch {} }
    foreach ($name in 'r','v','hdr','fc','fc2','db','cs','ps','anchor','chart','chShape','tblCli','tblLog',
                      'twc','frm','d','c','vbp','wsDash','wsLog','wsRpt','wsSum','wsCli','wsSet','wb','xl') {
        $obj = Get-Variable -Name $name -ValueOnly -ErrorAction SilentlyContinue
        if ($obj -is [__ComObject]) {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
        }
        Remove-Variable -Name $name -ErrorAction SilentlyContinue
    }
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()
    [GC]::Collect(); [GC]::WaitForPendingFinalizers()

    if ($origVbom -ne 1) {
        if ($origVbom -eq $null) {
            Remove-ItemProperty -Path $secPath -Name AccessVBOM -ErrorAction SilentlyContinue
        } else {
            Set-ItemProperty -Path $secPath -Name AccessVBOM -Value $origVbom -Type DWord
        }
    }

    # Make sure our hidden instance actually exited; never touch pre-existing Excel.
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
