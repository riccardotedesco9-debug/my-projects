Attribute VB_Name = "modTimer"
Option Explicit

' Two-state timer (IDLE <-> RUNNING) with seamless task switching:
' pressing Start while a session runs offers to log it and start the
' new one with zero gap (old end time = new start time), so juggling
' several jobs never loses a second or double-bills an hour.
' Every transition persists state cells, then saves the workbook.

Public Sub PingCompile()
End Sub

Public Sub StartWork()
    Dim clientName As String, taskName As String
    clientName = Trim$(CStr(StateRange("dbClient").Value))
    taskName = Trim$(CStr(StateRange("dbTask").Value))

    If clientName = "" Then
        Notify "Pick a client first (dropdown on the Dashboard)."
        Exit Sub
    End If
    If Not ClientExists(clientName) Then
        Notify "Client '" & clientName & "' is not on the Clients sheet. Add it there first."
        Exit Sub
    End If

    Dim tNow As Date
    tNow = Now

    If CStr(GetState("stTimerStatus")) = "RUNNING" Then
        If clientName = CStr(GetState("stCurrentClient")) And _
           taskName = CStr(GetState("stCurrentTask")) Then
            Notify "This session is already running."
            Exit Sub
        End If
        Dim resp As VbMsgBoxResult
        If IsSilent() Then
            resp = vbYes
        Else
            resp = MsgBox("A session is running:" & vbCrLf & _
                          "  " & GetState("stCurrentClient") & " - " & GetState("stCurrentTask") & vbCrLf & vbCrLf & _
                          "Log it and start '" & clientName & "' now (no gap)?", _
                          vbYesNo + vbQuestion, "Switch task?")
        End If
        If resp <> vbYes Then Exit Sub
        StopInternal tNow          ' close the old session at the exact switch moment
    End If

    SetState "stStartTime", tNow
    SetState "stCurrentClient", clientName
    SetState "stCurrentTask", taskName
    SetState "stTimerStatus", "RUNNING"

    modUI.RefreshStatus
    modUI.StartTick
    ThisWorkbook.Save
End Sub

Public Sub StopAndLog()
    If CStr(GetState("stTimerStatus")) <> "RUNNING" Then
        Notify "No session is running."
        Exit Sub
    End If

    Dim endedAt As Date
    endedAt = Now
    Dim clientName As String, loggedHours As Double
    clientName = CStr(GetState("stCurrentClient"))
    loggedHours = (endedAt - CDate(GetState("stStartTime"))) * 24

    StopInternal endedAt

    modUI.StopTick
    modUI.RefreshStatus
    ThisWorkbook.Save

    Notify "Logged " & Format$(loggedHours, "0.00") & " h for " & clientName & "."
End Sub

' Appends the current session to the log ending at endAt, then resets
' state to IDLE. Callers handle tick/status/save so a switch can chain
' straight into a new StartWork without flicker.
Private Sub StopInternal(ByVal endAt As Date)
    AppendLogRow CDate(GetState("stStartTime")), endAt, _
                 CStr(GetState("stCurrentClient")), CStr(GetState("stCurrentTask"))
    SetState "stTimerStatus", "IDLE"
    SetState "stStartTime", ""
    SetState "stCurrentClient", ""
    SetState "stCurrentTask", ""
End Sub

Private Sub AppendLogRow(ByVal startedAt As Date, ByVal endedAt As Date, _
                         ByVal clientName As String, ByVal taskName As String)
    Dim lo As ListObject
    Set lo = wshTimeLog.ListObjects("tblTimeLog")

    Dim target As Range
    If lo.ListRows.Count >= 1 Then
        If Application.WorksheetFunction.CountA(lo.ListRows(lo.ListRows.Count).Range) = 0 Then
            Set target = lo.ListRows(lo.ListRows.Count).Range
        End If
    End If
    If target Is Nothing Then Set target = lo.ListRows.Add.Range

    ' Values before formulas: the Date formula reads [@Start].
    target.Cells(1, 2).Value = clientName
    target.Cells(1, 3).Value = taskName
    target.Cells(1, 4).Value = startedAt
    target.Cells(1, 5).Value = endedAt
    ' Excel overrides a time-only format with "dd/mm/yyyy hh:mm" when a
    ' full datetime is written, which renders as ##### - put it back.
    target.Cells(1, 4).NumberFormat = "hh:mm"
    target.Cells(1, 5).NumberFormat = "hh:mm"
    target.Cells(1, 1).Formula = "=INT([@Start])"
    target.Cells(1, 6).Formula = "=ROUND(([@End]-[@Start])*24,2)"
    target.Cells(1, 7).Formula = "=IFERROR(INDEX(tblClients[Rate],MATCH([@Client],tblClients[Client],0)),0)"
    target.Cells(1, 8).Formula = "=ROUND([@Hours]*[@Rate],2)"
End Sub

Private Function ClientExists(ByVal clientName As String) As Boolean
    Dim lo As ListObject
    Set lo = wshClients.ListObjects("tblClients")
    If lo.DataBodyRange Is Nothing Then Exit Function
    ClientExists = Not IsError(Application.Match(clientName, lo.ListColumns("Client").DataBodyRange, 0))
End Function
