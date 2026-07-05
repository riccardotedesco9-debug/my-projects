Attribute VB_Name = "modReport"
Option Explicit

' Report builder + PDF export.
' The export flow prompts for client + month via frmExport, late-bound
' through VBA.UserForms.Add so a missing/broken form degrades to an
' InputBox flow instead of a compile error.

Private Const HDR_ROW As Long = 9
Private Const FIRST_BODY_ROW As Long = 10
Private Const MAX_CLEAR_ROW As Long = 2000
Private Const COL_FIRST As Long = 2   ' column B
Private Const COL_LAST As Long = 9    ' column I

Public Sub PingCompile()
End Sub

Public Sub PromptAndExport()
    DialogThenBuild True
End Sub

Public Sub RefreshPreview()
    DialogThenBuild False
End Sub

Private Sub DialogThenBuild(ByVal doExport As Boolean)
    Dim clientName As String, monthStart As Date, showAmounts As Boolean
    If Not AskExportChoices(clientName, monthStart, showAmounts) Then Exit Sub
    BuildReport clientName, monthStart, showAmounts
    If doExport Then
        ExportPDF clientName, monthStart
    Else
        wshReport.Activate
    End If
End Sub

' Used by the automated smoke test: current month, no dialog.
Public Sub SilentMonthExport(ByVal clientName As String)
    Dim monthStart As Date
    monthStart = DateSerial(Year(Date), Month(Date), 1)
    BuildReport clientName, monthStart, True
    ExportPDF clientName, monthStart
End Sub

Private Function AskExportChoices(ByRef clientName As String, ByRef monthStart As Date, _
                                  ByRef showAmounts As Boolean) As Boolean
    AskExportChoices = False
    Dim clients As Collection
    Set clients = ClientNames()
    If clients.Count = 0 Then
        Notify "No clients on the Clients sheet yet."
        Exit Function
    End If

    Dim i As Long
    On Error GoTo Fallback
    Dim frm As Object
    Set frm = VBA.UserForms.Add("frmExport")
    frm.Controls("cboClient").AddItem "All Clients"
    For i = 1 To clients.Count
        frm.Controls("cboClient").AddItem clients(i)
    Next i
    frm.Controls("cboClient").ListIndex = 0
    For i = 0 To 17
        frm.Controls("cboMonth").AddItem Format$(MonthOffset(i), "mmmm yyyy")
    Next i
    frm.Controls("cboMonth").ListIndex = 0
    frm.Controls("chkAmounts").Value = (GetState("stReportShowAmounts") = True)
    frm.Show
    If frm.Tag <> "OK" Then
        Unload frm
        Exit Function
    End If
    clientName = CStr(frm.Controls("cboClient").Value)
    monthStart = MonthOffset(frm.Controls("cboMonth").ListIndex)
    showAmounts = CBool(frm.Controls("chkAmounts").Value)
    Unload frm
    On Error GoTo 0
    AskExportChoices = True
    Exit Function

Fallback:
    Err.Clear
    On Error GoTo 0
    Dim msg As String, pick As String
    msg = "Export for which client?" & vbCrLf & "0 = All Clients"
    For i = 1 To clients.Count
        msg = msg & vbCrLf & i & " = " & clients(i)
    Next i
    pick = InputBox(msg, "Export Timesheet", "0")
    If pick = "" Or Not IsNumeric(pick) Then Exit Function
    If CLng(pick) < 0 Or CLng(pick) > clients.Count Then Exit Function
    If CLng(pick) = 0 Then clientName = "All Clients" Else clientName = clients(CLng(pick))

    pick = InputBox("Which month?" & vbCrLf & "0 = this month, 1 = last month, 2 = two months back ...", _
                    "Export Timesheet", "0")
    If pick = "" Or Not IsNumeric(pick) Then Exit Function
    monthStart = MonthOffset(CLng(pick))
    showAmounts = (GetState("stReportShowAmounts") = True)
    AskExportChoices = True
End Function

Public Sub BuildReport(ByVal clientName As String, ByVal monthStart As Date, ByVal showAmounts As Boolean)
    Dim monthEnd As Date
    monthEnd = DateSerial(Year(monthStart), Month(monthStart) + 1, 1)
    Dim ws As Worksheet
    Set ws = wshReport
    Dim lastCol As Long
    lastCol = IIf(showAmounts, COL_LAST, COL_LAST - 2)

    Application.ScreenUpdating = False
    ws.Unprotect PROTECT_PW

    ' Header fields (write the period as a real date with an explicit
    ' format - a "July 2026" string gets coerced to a date shown "Jul-26")
    ws.Range("C5").Value = CStr(GetState("stFreelancerName"))
    ws.Range("C6").NumberFormat = "mmmm yyyy"
    ws.Range("C6").Value = monthStart
    ws.Range("C7").Value = clientName
    ws.Range("G5").Value = "Generated: " & Format$(Now, "dd/mm/yyyy hh:mm")

    ' Reset header + body area
    Dim wipe As Range
    Set wipe = ws.Range(ws.Cells(HDR_ROW, COL_FIRST), ws.Cells(MAX_CLEAR_ROW, COL_LAST))
    wipe.ClearContents
    wipe.Font.Bold = False
    wipe.Font.Italic = False
    wipe.Borders.LineStyle = xlLineStyleNone
    ws.Range(ws.Cells(HDR_ROW, COL_FIRST), ws.Cells(HDR_ROW, COL_LAST)).Interior.ColorIndex = xlColorIndexNone
    ws.Range(ws.Cells(HDR_ROW, COL_FIRST), ws.Cells(HDR_ROW, COL_LAST)).Font.ColorIndex = xlColorIndexAutomatic

    ' Column headers
    Dim heads As Variant
    heads = Array("Date", "Client", "Task", "Start", "End", "Hours", "Rate", "Amount")
    Dim c As Long
    For c = COL_FIRST To lastCol
        ws.Cells(HDR_ROW, c).Value = heads(c - COL_FIRST)
    Next c
    With ws.Range(ws.Cells(HDR_ROW, COL_FIRST), ws.Cells(HDR_ROW, lastCol))
        .Interior.Color = RGB(31, 56, 100)
        .Font.Color = vbWhite
        .Font.Bold = True
    End With

    ' Collect matching sessions
    Dim rows() As Variant, n As Long
    n = CollectRows(clientName, monthStart, monthEnd, rows)

    Dim r As Long, i As Long
    Dim totalHours As Double, totalAmount As Double
    r = FIRST_BODY_ROW
    If n = 0 Then
        ws.Cells(r, COL_FIRST).Value = "No sessions logged for this selection."
        ws.Cells(r, COL_FIRST).Font.Italic = True
        r = r + 1
    Else
        For i = 1 To n
            ws.Cells(r, 2).Value = Int(CDate(rows(i, 1)))   ' date
            ws.Cells(r, 3).Value = rows(i, 3)               ' client
            ws.Cells(r, 4).Value = rows(i, 4)               ' task
            ws.Cells(r, 5).Value = rows(i, 1)               ' start
            ws.Cells(r, 6).Value = rows(i, 2)               ' end
            ws.Cells(r, 7).Value = rows(i, 5)               ' hours
            If showAmounts Then
                ws.Cells(r, 8).Value = rows(i, 6)           ' rate
                ws.Cells(r, 9).Value = rows(i, 7)           ' amount
            End If
            totalHours = totalHours + rows(i, 5)
            totalAmount = totalAmount + rows(i, 7)
            r = r + 1
        Next i
        ' Datetime writes override the preset time-only formats - restore.
        ws.Range(ws.Cells(FIRST_BODY_ROW, 5), ws.Cells(r - 1, 6)).NumberFormat = "hh:mm"
        ws.Range(ws.Cells(FIRST_BODY_ROW, 2), ws.Cells(r - 1, 2)).NumberFormat = "dd/mm/yyyy"
    End If

    ' Totals row
    ws.Cells(r, 4).Value = "TOTAL"
    ws.Cells(r, 7).Value = totalHours
    If showAmounts Then ws.Cells(r, 9).Value = totalAmount
    With ws.Range(ws.Cells(r, COL_FIRST), ws.Cells(r, lastCol))
        .Font.Bold = True
        .Borders(xlEdgeTop).LineStyle = xlContinuous
        .Borders(xlEdgeTop).Weight = xlMedium
    End With

    ' Footer + signature
    r = r + 2
    ws.Cells(r, COL_FIRST).Value = "Hours self-reported and certified correct."
    With ws.Cells(r, COL_FIRST).Font
        .Italic = True
        .Color = RGB(107, 114, 128)
    End With
    r = r + 2
    ws.Cells(r, COL_FIRST).Value = "Signed: ____________________"
    ws.Cells(r, 7).Value = "Date: ______________"

    ws.PageSetup.PrintArea = "B3:" & ColLetter(lastCol) & (r + 1)

    ProtectUI ws
    Application.ScreenUpdating = True
End Sub

Public Sub ExportPDF(ByVal clientName As String, ByVal monthStart As Date)
    Dim fileName As String, fullPath As String
    fileName = "Timesheet_" & Format$(monthStart, "yyyy-mm") & "_" & _
               Sanitize(clientName) & "_" & Sanitize(CStr(GetState("stFreelancerName"))) & ".pdf"
    fullPath = ThisWorkbook.Path & Application.PathSeparator & fileName

    On Error GoTo Fail
    wshReport.ExportAsFixedFormat Type:=xlTypePDF, Filename:=fullPath, _
        Quality:=xlQualityStandard, IncludeDocProperties:=True, _
        IgnorePrintAreas:=False, OpenAfterPublish:=Not IsSilent()
    Notify "Saved: " & fullPath
    Exit Sub
Fail:
    Notify "Could not save the PDF. Is a previous export still open in your PDF viewer?" & _
           vbCrLf & vbCrLf & fullPath
End Sub

' Returns matching sessions sorted by start time.
' Columns: 1=start, 2=end, 3=client, 4=task, 5=hours, 6=rate, 7=amount
Private Function CollectRows(ByVal clientName As String, ByVal monthStart As Date, _
                             ByVal monthEnd As Date, ByRef out() As Variant) As Long
    Dim lo As ListObject
    Set lo = wshTimeLog.ListObjects("tblTimeLog")

    Dim n As Long, lr As ListRow
    ReDim out(1 To Application.WorksheetFunction.Max(1, lo.ListRows.Count), 1 To 7)
    For Each lr In lo.ListRows
        If Application.WorksheetFunction.CountA(lr.Range) > 0 Then
            ' Value2 + IsNumeric, NOT IsDate(.Value): with a time-only cell
            ' format Excel hands VBA a Double, which IsDate rejects.
            Dim rawStart As Variant
            rawStart = lr.Range.Cells(1, 4).Value2
            If (Not IsEmpty(rawStart)) And IsNumeric(rawStart) Then
                Dim startVal As Date
                startVal = CDate(rawStart)
                If startVal >= monthStart And startVal < monthEnd Then
                    If clientName = "All Clients" Or CStr(lr.Range.Cells(1, 2).Value) = clientName Then
                        n = n + 1
                        out(n, 1) = startVal
                        out(n, 2) = lr.Range.Cells(1, 5).Value
                        out(n, 3) = lr.Range.Cells(1, 2).Value
                        out(n, 4) = lr.Range.Cells(1, 3).Value
                        out(n, 5) = Val(lr.Range.Cells(1, 6).Value)
                        out(n, 6) = Val(lr.Range.Cells(1, 7).Value)
                        out(n, 7) = Val(lr.Range.Cells(1, 8).Value)
                    End If
                End If
            End If
        End If
    Next lr

    ' Insertion sort by start time (row counts here are small)
    Dim i As Long, j As Long, k As Long
    Dim tmp(1 To 7) As Variant
    For i = 2 To n
        For k = 1 To 7: tmp(k) = out(i, k): Next k
        j = i - 1
        Do While j >= 1
            If CDate(out(j, 1)) <= CDate(tmp(1)) Then Exit Do
            For k = 1 To 7: out(j + 1, k) = out(j, k): Next k
            j = j - 1
        Loop
        For k = 1 To 7: out(j + 1, k) = tmp(k): Next k
    Next i

    CollectRows = n
End Function

Private Function ClientNames() As Collection
    Dim result As New Collection
    Dim lo As ListObject
    Set lo = wshClients.ListObjects("tblClients")
    If Not lo.DataBodyRange Is Nothing Then
        Dim lr As ListRow
        For Each lr In lo.ListRows
            If Trim$(CStr(lr.Range.Cells(1, 1).Value)) <> "" Then
                result.Add Trim$(CStr(lr.Range.Cells(1, 1).Value))
            End If
        Next lr
    End If
    Set ClientNames = result
End Function

Private Function MonthOffset(ByVal monthsBack As Long) As Date
    MonthOffset = DateSerial(Year(Date), Month(Date) - monthsBack, 1)
End Function

Private Function Sanitize(ByVal s As String) As String
    Dim i As Long, ch As String, result As String
    For i = 1 To Len(s)
        ch = Mid$(s, i, 1)
        If ch Like "[A-Za-z0-9]" Then result = result & ch
    Next i
    If result = "" Then result = "Export"
    Sanitize = result
End Function

Private Function ColLetter(ByVal colNum As Long) As String
    ColLetter = Split(Cells(1, colNum).Address, "$")(1)
End Function
